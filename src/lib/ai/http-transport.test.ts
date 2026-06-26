import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFetchTransport } from './http-transport';
import type { BrowserKeyStore } from './keystore/browser';
import {
	CorsBlockedError,
	MissingKeyError,
	NetworkError,
	ProviderHttpError,
	RateLimitError
} from './types';

/** Minimal `location` shape read by `classifyFetchError`'s cross-origin check. */
type LocationLike = { href: string; origin: string };

const g = globalThis as unknown as { location?: LocationLike };

/** Build a 200 (or override) `Response` carrying a byte body stream. */
function cannedResponse(body: string, init?: { status?: number; headers?: HeadersInit }): Response {
	return new Response(body, {
		status: init?.status ?? 200,
		headers: { 'content-type': 'text/event-stream', ...(init?.headers ?? {}) }
	});
}

/** Decode a returned ReadableStream fully into a string. */
async function collectStream(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let out = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			out += decoder.decode(value, { stream: true });
		}
		out += decoder.decode();
	} finally {
		reader.releaseLock();
	}
	return out;
}

/**
 * In-memory fake keystore (browser shape, incl. `get`) so the fetch transport
 * can resolve `auth` without IndexedDB. Typed against `BrowserKeyStore` — no `any`.
 */
function makeFakeStore(seed: Record<string, string> = {}): BrowserKeyStore {
	const map: Record<string, string> = { ...seed };
	const store: BrowserKeyStore = {
		get: async (id) => map[id] ?? null,
		has: async (id) => id in map,
		set: async (id, key) => {
			map[id] = key;
		},
		delete: async (id) => {
			delete map[id];
		}
	};
	return store;
}

describe('createFetchTransport', () => {
	const originalFetch = globalThis.fetch;
	const originalLocation = g.location;

	beforeEach(() => {
		// Default: no network. Individual tests configure the mock fetch.
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		g.location = originalLocation;
		vi.restoreAllMocks();
	});

	it('injects a scheme-prefixed secret from the keystore into the auth header', async () => {
		const transport = createFetchTransport(makeFakeStore({ p1: 'secret' }));
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(cannedResponse('hello world'));

		const stream = await transport.request({
			url: 'https://api.example.test/v1/chat',
			auth: { header: 'Authorization', scheme: 'Bearer', keyId: 'p1' }
		});

		const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const headers = (init as RequestInit).headers as Record<string, string>;
		expect(headers['Authorization']).toBe('Bearer secret');
		expect(await collectStream(stream)).toBe('hello world');
	});

	it('injects the raw secret (no scheme) into the named header', async () => {
		const transport = createFetchTransport(makeFakeStore({ p1: 'raw' }));
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(cannedResponse('ok'));

		await transport.request({
			url: 'https://api.example.test/v1/chat',
			auth: { header: 'x-api-key', keyId: 'p1' }
		});

		const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const headers = (init as RequestInit).headers as Record<string, string>;
		expect(headers['x-api-key']).toBe('raw');
	});

	it('rejects with MissingKeyError and never calls fetch when the key is absent', async () => {
		const transport = createFetchTransport(makeFakeStore());

		await expect(
			transport.request({
				url: 'https://api.example.test/v1/chat',
				auth: { header: 'Authorization', scheme: 'Bearer', keyId: 'p1' }
			})
		).rejects.toBeInstanceOf(MissingKeyError);

		expect(globalThis.fetch as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
	});

	it('passes the provided headers through unchanged when auth is absent', async () => {
		const transport = createFetchTransport(makeFakeStore());
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(cannedResponse('plain'));

		const stream = await transport.request({
			url: 'https://api.example.test/v1/chat',
			headers: { 'x-custom': 'keep' }
		});

		const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const headers = (init as RequestInit).headers as Record<string, string>;
		expect(headers['x-custom']).toBe('keep');
		expect(headers['Authorization']).toBeUndefined();
		expect(await collectStream(stream)).toBe('plain');
	});

	it('maps a 429 response (with Retry-After) to a RateLimitError', async () => {
		const transport = createFetchTransport(makeFakeStore({ p1: 'k' }));
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			cannedResponse('slow down', { status: 429, headers: { 'retry-after': '12' } })
		);

		const err = await transport
			.request({
				url: 'https://api.example.test/v1/chat',
				auth: { header: 'Authorization', scheme: 'Bearer', keyId: 'p1' }
			})
			.catch((e) => e);

		expect(err).toBeInstanceOf(RateLimitError);
		expect((err as RateLimitError).retryAfter).toBe(12);
	});

	it('maps a 500 response to a ProviderHttpError echoing the body', async () => {
		const transport = createFetchTransport(makeFakeStore({ p1: 'k' }));
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			cannedResponse('internal boom', { status: 500 })
		);

		const err = await transport
			.request({
				url: 'https://api.example.test/v1/chat',
				auth: { header: 'Authorization', scheme: 'Bearer', keyId: 'p1' }
			})
			.catch((e) => e);

		expect(err).toBeInstanceOf(ProviderHttpError);
		expect((err as ProviderHttpError).status).toBe(500);
		expect((err as ProviderHttpError).body).toBe('internal boom');
	});

	it('maps a cross-origin TypeError to CorsBlockedError', async () => {
		// Force a known page origin so `classifyFetchError` treats the target as
		// cross-origin (a TypeError in the browser signals a CORS block there).
		g.location = { href: 'http://localhost:5173/', origin: 'http://localhost:5173' };
		const transport = createFetchTransport(makeFakeStore());
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
			new TypeError('Failed to fetch')
		);

		await expect(
			transport.request({ url: 'https://api.example.test/v1/chat' })
		).rejects.toBeInstanceOf(CorsBlockedError);
	});

	it('maps a same-origin TypeError to NetworkError', async () => {
		// Node test env exposes no `location`, so `isCrossOrigin()` returns false
		// → a TypeError is classified as a plain network failure.
		const transport = createFetchTransport(makeFakeStore());
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
			new TypeError('Failed to fetch')
		);

		await expect(transport.request({ url: 'http://localhost:9999/api' })).rejects.toBeInstanceOf(
			NetworkError
		);
	});
});
