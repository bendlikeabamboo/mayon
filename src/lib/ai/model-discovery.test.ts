import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFetchTransport, setHttpTransport } from './http-transport';
import type { BrowserKeyStore } from './keystore/browser';
import { discoverModels, parseModelIds, readAll } from './model-discovery';
import { ProviderHttpError, type ProviderConfig } from './types';

const config: ProviderConfig = {
	id: 'or-1',
	kind: 'openai-compatible',
	name: 'OpenRouter',
	baseUrl: 'https://openrouter.ai/api/v1',
	defaultModel: 'openai/gpt-4o-mini',
	models: ['openai/gpt-4o-mini'],
	discoverable: true
};

/** Build a 200 Response carrying a byte body stream. */
function jsonBody(body: string): Response {
	return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

/** In-memory fake keystore so the fetch transport can resolve `auth`. */
function makeFakeStore(seed: Record<string, string> = {}): BrowserKeyStore {
	const map: Record<string, string> = { ...seed };
	return {
		get: async (id) => map[id] ?? null,
		has: async (id) => id in map,
		set: async (id, key) => {
			map[id] = key;
		},
		delete: async (id) => {
			delete map[id];
		}
	};
}

describe('parseModelIds', () => {
	it('reads the OpenAI shape { data: [{ id }] }', () => {
		expect(parseModelIds(JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }] }))).toEqual(['a', 'b']);
	});

	it('tolerates a bare array of { id } objects', () => {
		expect(parseModelIds(JSON.stringify([{ id: 'x' }, { id: 'y' }]))).toEqual(['x', 'y']);
	});

	it('tolerates a bare array of strings', () => {
		expect(parseModelIds(JSON.stringify(['m1', 'm2']))).toEqual(['m1', 'm2']);
	});

	it('de-duplicates and sorts', () => {
		expect(
			parseModelIds(JSON.stringify({ data: [{ id: 'c' }, { id: 'a' }, { id: 'c' }] }))
		).toEqual(['a', 'c']);
	});

	it('ignores entries without a string id', () => {
		expect(
			parseModelIds(JSON.stringify({ data: [{ id: 'ok' }, { name: 'no-id' }, { id: 42 }] }))
		).toEqual(['ok']);
	});

	it('returns [] for unparseable bodies', () => {
		expect(parseModelIds('not json')).toEqual([]);
	});

	it('returns [] for unrecognized shapes', () => {
		expect(parseModelIds(JSON.stringify({ objects: [] }))).toEqual([]);
	});
});

describe('readAll', () => {
	it('drains a chunked stream into a single UTF-8 string', async () => {
		const enc = new TextEncoder();
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(enc.encode('hel'));
				controller.enqueue(enc.encode('lo'));
				controller.close();
			}
		});
		expect(await readAll(stream)).toBe('hello');
	});
});

describe('discoverModels', () => {
	const originalFetch = globalThis.fetch;
	let fakeKeyStore: BrowserKeyStore;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
		fakeKeyStore = makeFakeStore();
		setHttpTransport(createFetchTransport(fakeKeyStore));
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		setHttpTransport(null);
		vi.restoreAllMocks();
	});

	it('GETs <baseUrl>/models and returns sorted ids', async () => {
		await fakeKeyStore.set(config.id, 'secret');
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			jsonBody(
				JSON.stringify({
					data: [{ id: 'openai/gpt-4o' }, { id: 'openai/gpt-4o-mini' }]
				})
			)
		);

		const ids = await discoverModels(config, { hasKey: (id) => fakeKeyStore.has(id) });

		expect(ids).toEqual(['openai/gpt-4o', 'openai/gpt-4o-mini']);
		expect(globalThis.fetch).toHaveBeenCalledOnce();
		const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toBe('https://openrouter.ai/api/v1/models');
		expect((init as RequestInit).method).toBe('GET');
		expect((init as RequestInit).body).toBeUndefined();
	});

	it('attaches bearer auth when a key is configured', async () => {
		await fakeKeyStore.set(config.id, 'sk-or');
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			jsonBody(JSON.stringify({ data: [{ id: 'm' }] }))
		);
		await discoverModels(config, { hasKey: (id) => fakeKeyStore.has(id) });
		const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-or');
	});

	it('omits auth entirely when no key is configured (public catalogs)', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			jsonBody(JSON.stringify({ data: [{ id: 'm' }] }))
		);
		await discoverModels(config, { hasKey: () => Promise.resolve(false) });
		const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
	});

	it('surfaces a non-2xx response as a ProviderHttpError', async () => {
		await fakeKeyStore.set(config.id, 'k');
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response('nope', { status: 401 })
		);
		await expect(
			discoverModels(config, { hasKey: (id) => fakeKeyStore.has(id) })
		).rejects.toBeInstanceOf(ProviderHttpError);
	});

	it('tolerates a trailing slash on the base URL', async () => {
		await fakeKeyStore.set(config.id, 'k');
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			jsonBody(JSON.stringify({ data: [] }))
		);
		const slashy = { ...config, baseUrl: 'https://openrouter.ai/api/v1/' };
		await discoverModels(slashy, { hasKey: (id) => fakeKeyStore.has(id) });
		const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(url).toBe('https://openrouter.ai/api/v1/models');
	});
});
