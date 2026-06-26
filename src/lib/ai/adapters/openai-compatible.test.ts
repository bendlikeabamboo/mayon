import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFetchTransport, setHttpTransport } from '../http-transport';
import type { BrowserKeyStore } from '../keystore/browser';
import { createOpenAICompatibleAdapter } from './openai-compatible';
import { MissingKeyError, RateLimitError } from '../types';
import type { ProviderConfig } from '../types';

const config: ProviderConfig = {
	id: 'zai-1',
	kind: 'openai-compatible',
	name: 'Z.AI',
	baseUrl: 'https://api.z.ai/api/coding/paas/v4',
	defaultModel: 'glm-5.2',
	models: ['glm-5.2']
};

function cannedResponse(body: string, init?: { status?: number; headers?: HeadersInit }): Response {
	return new Response(body, {
		status: init?.status ?? 200,
		headers: { 'content-type': 'text/event-stream', ...(init?.headers ?? {}) }
	});
}

/** Encode an OpenAI-style SSE body from a list of content deltas. */
function openaiSse(deltas: string[], done = true): string {
	let out = '';
	for (const d of deltas) {
		out += `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`;
	}
	if (done) out += 'data: [DONE]\n\n';
	return out;
}

async function collectTokens(
	iter: AsyncIterable<{ text?: string; delta?: string }>
): Promise<string> {
	let out = '';
	for await (const t of iter) out += t.text ?? t.delta ?? '';
	return out;
}

/**
 * In-memory fake keystore (browser shape, incl. `get`) so the real fetch
 * transport can resolve `auth` without IndexedDB. Typed against `BrowserKeyStore`
 * — no `any`.
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

describe('createOpenAICompatibleAdapter', () => {
	const originalFetch = globalThis.fetch;
	let fakeKeyStore: BrowserKeyStore;

	beforeEach(() => {
		// Default: no network. Individual tests override fetch.
		globalThis.fetch = vi.fn();
		// Wire the adapter's `streamSse` to a transport that resolves the key from
		// the in-memory fake keystore (mirrors the browser path end-to-end).
		fakeKeyStore = makeFakeStore();
		setHttpTransport(createFetchTransport(fakeKeyStore));
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		setHttpTransport(null);
		vi.restoreAllMocks();
	});

	it('streams concatenated content deltas', async () => {
		await fakeKeyStore.set(config.id, 'secret');
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			cannedResponse(openaiSse(['Hel', 'lo', ' world']))
		);
		const provider = createOpenAICompatibleAdapter(config, {
			hasKey: () => fakeKeyStore.has(config.id)
		});
		const text = await collectTokens(provider.chatStream([{ role: 'user', content: 'hi' }]));
		expect(text).toBe('Hello world');
	});

	it('posts to <baseUrl>/chat/completions with bearer auth and stream body', async () => {
		await fakeKeyStore.set(config.id, 'secret');
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			cannedResponse(openaiSse(['ok']))
		);
		const provider = createOpenAICompatibleAdapter(config, {
			hasKey: () => fakeKeyStore.has(config.id)
		});
		await collectTokens(provider.chatStream([{ role: 'user', content: 'hi' }]));

		expect(globalThis.fetch).toHaveBeenCalledOnce();
		const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toBe('https://api.z.ai/api/coding/paas/v4/chat/completions');
		const headers = (init as RequestInit).headers as Record<string, string>;
		expect(headers['Authorization']).toBe('Bearer secret');
		const body = JSON.parse((init as RequestInit).body as string);
		expect(body).toMatchObject({ model: 'glm-5.2', stream: true });
		expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
	});

	it('includes thinking: { type: "disabled" } when reasoning is disabled', async () => {
		await fakeKeyStore.set(config.id, 'secret');
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			cannedResponse(openaiSse(['ok']))
		);
		const provider = createOpenAICompatibleAdapter(config, {
			hasKey: () => fakeKeyStore.has(config.id)
		});
		await collectTokens(
			provider.chatStream([{ role: 'user', content: 'hi' }], { reasoning: 'disabled' })
		);
		const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
		const body = JSON.parse(init.body as string);
		expect(body.thinking).toEqual({ type: 'disabled' });
	});

	it('includes thinking: { type: "enabled" } when reasoning is enabled', async () => {
		await fakeKeyStore.set(config.id, 'secret');
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			cannedResponse(openaiSse(['ok']))
		);
		const provider = createOpenAICompatibleAdapter(config, {
			hasKey: () => fakeKeyStore.has(config.id)
		});
		await collectTokens(
			provider.chatStream([{ role: 'user', content: 'hi' }], { reasoning: 'enabled' })
		);
		const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
		const body = JSON.parse(init.body as string);
		expect(body.thinking).toEqual({ type: 'enabled' });
	});

	it('omits thinking on the default (auto) reasoning mode', async () => {
		await fakeKeyStore.set(config.id, 'secret');
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			cannedResponse(openaiSse(['ok']))
		);
		const provider = createOpenAICompatibleAdapter(config, {
			hasKey: () => fakeKeyStore.has(config.id)
		});
		await collectTokens(provider.chatStream([{ role: 'user', content: 'hi' }]));
		const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
		const body = JSON.parse(init.body as string);
		expect(body.thinking).toBeUndefined();
	});

	it('throws MissingKeyError when no key is configured', async () => {
		// Keystore left empty.
		const provider = createOpenAICompatibleAdapter(config, {
			hasKey: () => fakeKeyStore.has(config.id)
		});
		const err = await collectTokens(provider.chatStream([{ role: 'user', content: 'hi' }])).catch(
			(e) => e
		);
		expect(err).toBeInstanceOf(MissingKeyError);
		expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
	});

	it('maps a 429 response to RateLimitError', async () => {
		await fakeKeyStore.set(config.id, 'k');
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			cannedResponse('rate limited', { status: 429, headers: { 'retry-after': '12' } })
		);
		const provider = createOpenAICompatibleAdapter(config, {
			hasKey: () => fakeKeyStore.has(config.id)
		});
		const err = await collectTokens(provider.chatStream([{ role: 'user', content: 'hi' }])).catch(
			(e) => e
		);
		expect(err).toBeInstanceOf(RateLimitError);
		expect((err as RateLimitError).retryAfter).toBe(12);
	});

	it('reads the key lazily per request (key added later still applies)', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () =>
			cannedResponse(openaiSse(['x']))
		);
		const provider = createOpenAICompatibleAdapter(config, {
			hasKey: () => fakeKeyStore.has(config.id)
		});

		// First call: no key yet → MissingKeyError (transport never reached).
		const firstErr = await collectTokens(
			provider.chatStream([{ role: 'user', content: 'hi' }])
		).catch((e) => e);
		expect(firstErr).toBeInstanceOf(MissingKeyError);

		// Key added afterward → works without rebuilding the adapter.
		await fakeKeyStore.set(config.id, 'late-key');
		const text = await collectTokens(provider.chatStream([{ role: 'user', content: 'hi' }]));
		expect(text).toBe('x');
		expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
		const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer late-key');
	});
});
