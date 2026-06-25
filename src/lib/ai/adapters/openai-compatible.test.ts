import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOpenAICompatibleAdapter } from './openai-compatible';
import { RateLimitError } from '../types';
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

describe('createOpenAICompatibleAdapter', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		// Default: no network. Individual tests override fetch.
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('streams concatenated content deltas', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			cannedResponse(openaiSse(['Hel', 'lo', ' world']))
		);
		const provider = createOpenAICompatibleAdapter(config, { getKey: async () => 'k' });
		const text = await collectTokens(provider.chatStream([{ role: 'user', content: 'hi' }]));
		expect(text).toBe('Hello world');
	});

	it('posts to <baseUrl>/chat/completions with bearer auth and stream body', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			cannedResponse(openaiSse(['ok']))
		);
		const provider = createOpenAICompatibleAdapter(config, { getKey: async () => 'secret' });
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

	it('throws MissingKeyError when no key is configured', async () => {
		const provider = createOpenAICompatibleAdapter(config, { getKey: async () => null });
		await expect(
			collectTokens(provider.chatStream([{ role: 'user', content: 'hi' }]))
		).rejects.toThrow(/No API key/);
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it('maps a 429 response to RateLimitError', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			cannedResponse('rate limited', { status: 429, headers: { 'retry-after': '12' } })
		);
		const provider = createOpenAICompatibleAdapter(config, { getKey: async () => 'k' });
		const err = await collectTokens(provider.chatStream([{ role: 'user', content: 'hi' }])).catch(
			(e) => e
		);
		expect(err).toBeInstanceOf(RateLimitError);
		expect((err as RateLimitError).retryAfter).toBe(12);
	});

	it('reads the key lazily per request (key added later still applies)', async () => {
		let key: string | null = null;
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () =>
			cannedResponse(openaiSse(['x']))
		);
		const provider = createOpenAICompatibleAdapter(config, { getKey: async () => key });

		// First call: no key yet → MissingKeyError.
		await expect(
			collectTokens(provider.chatStream([{ role: 'user', content: 'hi' }]))
		).rejects.toThrow(/No API key/);

		// Key added afterward → works without rebuilding the adapter.
		key = 'late-key';
		const text = await collectTokens(provider.chatStream([{ role: 'user', content: 'hi' }]));
		expect(text).toBe('x');
		const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer late-key');
	});
});
