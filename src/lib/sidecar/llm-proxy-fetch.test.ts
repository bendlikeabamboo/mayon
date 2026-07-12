import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/sidecar/status.svelte', () => ({
	sidecarStatus: {
		has: vi.fn().mockReturnValue(false),
		connected: false,
		caps: [],
		version: null,
		error: null,
		markConnected: vi.fn(),
		markDisconnected: vi.fn()
	}
}));

import { getLlmFetch } from '$lib/sidecar/llm-proxy-fetch';
import { sidecarStatus } from '$lib/sidecar/status.svelte';

describe('getLlmFetch', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('returns globalThis.fetch directly when llm-proxy cap is absent', async () => {
		vi.mocked(sidecarStatus.has).mockReturnValue(false);

		const fetchFn = getLlmFetch();
		expect(fetchFn).toBe(globalThis.fetch);

		const fakeRes = new Response('ok', { status: 200 });
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(fakeRes);

		const res = await fetchFn('https://api.example.test/v1/chat', {
			method: 'POST',
			headers: { authorization: 'Bearer mykey', 'content-type': 'application/json' },
			body: '{"messages":[]}'
		});

		expect(globalThis.fetch).toHaveBeenCalledOnce();
		const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toBe('https://api.example.test/v1/chat');
		expect(res.status).toBe(200);
	});

	it('proxies through /api/llm/proxy when llm-proxy cap is present', async () => {
		vi.mocked(sidecarStatus.has).mockReturnValue(true);

		const fakeRes = new Response('streamed', {
			status: 200,
			headers: { 'content-type': 'text/event-stream' }
		});
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(fakeRes);

		const fetchFn = getLlmFetch();
		const res = await fetchFn('https://api.example.test/v1/chat', {
			method: 'POST',
			headers: { authorization: 'Bearer secret123', 'content-type': 'application/json' },
			body: '{"messages":[{"role":"user","content":"hi"}]}'
		});

		expect(globalThis.fetch).toHaveBeenCalledOnce();
		const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toBe('/api/llm/proxy');
		expect((init as RequestInit).method).toBe('POST');
		expect(((init as RequestInit).headers as Record<string, string>)['content-type']).toBe(
			'application/json'
		);

		const sentBody = JSON.parse((init as RequestInit).body as string);
		expect(sentBody.url).toBe('https://api.example.test/v1/chat');
		expect(sentBody.method).toBe('POST');
		expect(sentBody.headers['authorization']).toBe('Bearer secret123');
		expect(sentBody.body).toBe('{"messages":[{"role":"user","content":"hi"}]}');

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/event-stream');
	});

	it('handles GET requests (no body) through the proxy', async () => {
		vi.mocked(sidecarStatus.has).mockReturnValue(true);

		const fakeRes = new Response('[]', { status: 200 });
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(fakeRes);

		const fetchFn = getLlmFetch();
		await fetchFn('https://api.example.test/v1/models', {
			method: 'GET',
			headers: { authorization: 'Bearer k' }
		});

		const sentBody = JSON.parse(
			((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit)
				.body as string
		);
		expect(sentBody.url).toBe('https://api.example.test/v1/models');
		expect(sentBody.method).toBe('GET');
		expect(sentBody.body).toBeUndefined();
	});

	it('omits body from proxy request when init.body is not a string', async () => {
		vi.mocked(sidecarStatus.has).mockReturnValue(true);

		const fakeRes = new Response('ok', { status: 200 });
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(fakeRes);

		const fetchFn = getLlmFetch();
		await fetchFn('https://api.example.test/v1/chat', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: new Blob(['{}']) as unknown as string
		});

		const sentBody = JSON.parse(
			((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit)
				.body as string
		);
		expect(sentBody.body).toBeUndefined();
	});
});
