import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { promises as dnsPromises, type LookupAddress } from 'node:dns';
import { buildApp } from './server';
import { MAX_PROXY_RESPONSE_BYTES } from './llm-proxy';
import type Fastify from 'fastify';

/** Public address the default DNS stub resolves every hostname to (032). */
const PUBLIC_V4: LookupAddress[] = [{ address: '93.184.216.34', family: 4 }];

describe('POST /api/llm/proxy', () => {
	let app: Fastify.Instance;
	const _originalFetch = globalThis.fetch;

	beforeAll(async () => {
		app = buildApp(':memory:');
		await app.listen({ port: 0, host: '0.0.0.0' });
	});

	afterAll(async () => {
		await app.close();
	});

	beforeEach(() => {
		// Default DNS stub (032 target-safety): the relay resolves every
		// non-literal target before fetching; pin the test hostnames to a
		// public address so the happy-path cases keep exercising the pipe.
		vi.spyOn(dnsPromises, 'lookup').mockResolvedValue(PUBLIC_V4);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('streams a 200 response with correct status, content-type, and body', async () => {
		const upstreamBody = 'data: hello\ndata: world\n';
		const upstream = new Response(upstreamBody, {
			headers: { 'content-type': 'text/event-stream' }
		});
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream));

		const res = await app.inject({
			method: 'POST',
			url: '/api/llm/proxy',
			payload: {
				url: 'https://api.example.test/v1/chat',
				method: 'POST',
				headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
				body: '{"messages":[]}'
			}
		});

		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toBe('text/event-stream');
		expect(res.headers['x-accel-buffering']).toBe('no');
		expect(res.body).toBe(upstreamBody);
		expect(res.headers['content-encoding']).toBeUndefined();
		expect(res.headers['content-length']).toBeUndefined();
	});

	it('forwards a 429 response with retry-after verbatim', async () => {
		const upstream = new Response('rate limited', {
			status: 429,
			headers: { 'content-type': 'application/json', 'retry-after': '10' }
		});
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream));

		const res = await app.inject({
			method: 'POST',
			url: '/api/llm/proxy',
			payload: {
				url: 'https://api.example.test/v1/chat',
				method: 'POST',
				headers: { authorization: 'Bearer test-key' },
				body: '{"messages":[]}'
			}
		});

		expect(res.statusCode).toBe(429);
		expect(res.headers['retry-after']).toBe('10');
	});

	it('strips hop-by-hop headers from upstream (content-encoding, content-length)', async () => {
		const upstream = new Response('ok', {
			headers: {
				'content-type': 'application/json',
				'content-encoding': 'gzip',
				'content-length': '42',
				'keep-alive': 'timeout=60'
			}
		});
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream));

		const res = await app.inject({
			method: 'POST',
			url: '/api/llm/proxy',
			payload: {
				url: 'https://api.example.test/v1/models',
				method: 'GET',
				headers: {}
			}
		});

		expect(res.statusCode).toBe(200);
		expect(res.headers['content-encoding']).toBeUndefined();
		expect(res.headers['content-length']).toBeUndefined();
	});

	it('returns 502 when upstream fetch fails', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('upstream unreachable')));

		const res = await app.inject({
			method: 'POST',
			url: '/api/llm/proxy',
			payload: {
				url: 'https://api.example.test/v1/chat',
				method: 'POST',
				headers: {},
				body: '{"messages":[]}'
			}
		});

		expect(res.statusCode).toBe(502);
		const json = res.json();
		expect(json.error).toBe('upstream fetch failed');
		expect(json.detail).toBeDefined();
	});

	it('returns 400 for missing url', async () => {
		const res = await app.inject({
			method: 'POST',
			url: '/api/llm/proxy',
			payload: {
				method: 'POST',
				headers: {},
				body: '{}'
			}
		});

		expect(res.statusCode).toBe(400);
	});

	it('returns 400 for non-http(s) url', async () => {
		const res = await app.inject({
			method: 'POST',
			url: '/api/llm/proxy',
			payload: {
				url: 'ftp://evil.com/file',
				method: 'POST',
				headers: {}
			}
		});

		expect(res.statusCode).toBe(400);
	});

	it('returns 400 for invalid url', async () => {
		const res = await app.inject({
			method: 'POST',
			url: '/api/llm/proxy',
			payload: {
				url: 'not-a-url',
				method: 'POST',
				headers: {}
			}
		});

		expect(res.statusCode).toBe(400);
	});

	it('always sets X-Accel-Buffering: no', async () => {
		const upstream = new Response('stream', {
			headers: { 'content-type': 'text/event-stream' }
		});
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream));

		const res = await app.inject({
			method: 'POST',
			url: '/api/llm/proxy',
			payload: {
				url: 'https://api.example.test/v1/chat',
				method: 'POST',
				headers: { authorization: 'Bearer k' },
				body: '{}'
			}
		});

		expect(res.headers['x-accel-buffering']).toBe('no');
	});

	it('passes an opaque body larger than the old 1 MiB default through to upstream', async () => {
		const bigBody = JSON.stringify({
			messages: [{ role: 'user', content: 'x'.repeat(1024 * 1024 + 64 * 1024) }]
		});
		expect(bigBody.length).toBeGreaterThan(1024 * 1024);
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				new Response('streamed-ok', { headers: { 'content-type': 'text/event-stream' } })
			);
		vi.stubGlobal('fetch', fetchMock);

		const res = await app.inject({
			method: 'POST',
			url: '/api/llm/proxy',
			payload: {
				url: 'https://api.example.test/v1/chat',
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: bigBody
			}
		});

		expect(res.statusCode).toBe(200);
		expect(res.body).toBe('streamed-ok');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [upstreamUrl, upstreamInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(upstreamUrl).toBe('https://api.example.test/v1/chat');
		expect(upstreamInit.body).toBe(bigBody);
	});

	describe('credential-forwarding rule (032)', () => {
		async function sendAndCapture(
			payload: Record<string, unknown>
		): Promise<[Response, RequestInit, Awaited<ReturnType<typeof app.inject>>]> {
			const fetchMock = vi
				.fn()
				.mockResolvedValue(new Response('ok', { headers: { 'content-type': 'text/plain' } }));
			vi.stubGlobal('fetch', fetchMock);
			const res = await app.inject({ method: 'POST', url: '/api/llm/proxy', payload });
			const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
			return [fetchMock.mock.results[0].value as Response, init, res];
		}

		it('strips credential headers when authHost is absent', async () => {
			const [, init, res] = await sendAndCapture({
				url: 'https://api.example.test/v1/chat',
				method: 'POST',
				headers: {
					authorization: 'Bearer sk-test',
					'x-api-key': 'raw-key',
					'x-goog-api-key': 'goog-key',
					'content-type': 'application/json'
				}
			});
			expect(res.statusCode).toBe(200);
			const headers = init.headers as Record<string, string>;
			expect(headers['authorization']).toBeUndefined();
			expect(headers['x-api-key']).toBeUndefined();
			expect(headers['x-goog-api-key']).toBeUndefined();
			expect(headers['content-type']).toBe('application/json');
		});

		it('strips credential headers when authHost mismatches the target host', async () => {
			const [, init, res] = await sendAndCapture({
				url: 'https://other.example/x',
				method: 'GET',
				headers: {
					authorization: 'Bearer sk-test',
					'x-api-key': 'raw-key',
					authHost: 'api.provider.test'
				}
			});
			expect(res.statusCode).toBe(200);
			const headers = init.headers as Record<string, string>;
			expect(headers['authorization']).toBeUndefined();
			expect(headers['x-api-key']).toBeUndefined();
		});

		it('strips credential headers case-insensitively (mixed-case names)', async () => {
			const [, init, res] = await sendAndCapture({
				url: 'https://api.example.test/v1/chat',
				method: 'GET',
				headers: {
					Authorization: 'Bearer sk-test',
					'X-API-KEY': 'raw-key',
					'X-Goog-Api-Key': 'goog-key'
				}
			});
			expect(res.statusCode).toBe(200);
			const headers = init.headers as Record<string, string>;
			expect(headers['Authorization']).toBeUndefined();
			expect(headers['X-API-KEY']).toBeUndefined();
			expect(headers['X-Goog-Api-Key']).toBeUndefined();
		});

		it('forwards credential headers unchanged when authHost matches (normalized)', async () => {
			const [, init, res] = await sendAndCapture({
				url: 'https://api.provider.test/v1/chat',
				method: 'POST',
				headers: {
					authorization: 'Bearer sk-test',
					'content-type': 'application/json'
				},
				// Verbatim mixed-case + trailing dot — must normalize to a match.
				authHost: 'API.Provider.TEST.'
			});
			expect(res.statusCode).toBe(200);
			const headers = init.headers as Record<string, string>;
			expect(headers['authorization']).toBe('Bearer sk-test');
			expect(headers['content-type']).toBe('application/json');
		});
	});

	describe('target safety (032)', () => {
		it('returns 403 without an upstream fetch for an IP-literal loopback target', async () => {
			const fetchMock = vi.fn().mockResolvedValue(new Response('never'));
			vi.stubGlobal('fetch', fetchMock);

			const res = await app.inject({
				method: 'POST',
				url: '/api/llm/proxy',
				payload: { url: 'http://127.0.0.1:4319/api/health', headers: {} }
			});

			expect(res.statusCode).toBe(403);
			expect(res.json()).toEqual({ error: 'blocked target', detail: 'loopback' });
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('returns 403 when any resolved address is private', async () => {
			vi.spyOn(dnsPromises, 'lookup').mockResolvedValue([{ address: '192.168.1.1', family: 4 }]);
			const fetchMock = vi.fn().mockResolvedValue(new Response('never'));
			vi.stubGlobal('fetch', fetchMock);

			const res = await app.inject({
				method: 'POST',
				url: '/api/llm/proxy',
				payload: { url: 'https://intranet.example/x', headers: {} }
			});

			expect(res.statusCode).toBe(403);
			expect(res.json()).toEqual({ error: 'blocked target', detail: 'private' });
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('returns 403 when any resolved address is private alongside a public one', async () => {
			vi.spyOn(dnsPromises, 'lookup').mockResolvedValue([
				{ address: '93.184.216.34', family: 4 },
				{ address: '192.168.1.1', family: 4 }
			]);
			const fetchMock = vi.fn().mockResolvedValue(new Response('never'));
			vi.stubGlobal('fetch', fetchMock);

			const res = await app.inject({
				method: 'POST',
				url: '/api/llm/proxy',
				payload: { url: 'https://mixed.example/x', headers: {} }
			});

			expect(res.statusCode).toBe(403);
			expect(res.json()).toEqual({ error: 'blocked target', detail: 'private' });
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('returns 502 (fail-closed) when the hostname cannot be resolved', async () => {
			vi.spyOn(dnsPromises, 'lookup').mockRejectedValue(
				Object.assign(new Error('getaddrinfo ENOTFOUND missing.invalid'), { code: 'ENOTFOUND' })
			);
			const fetchMock = vi.fn().mockResolvedValue(new Response('never'));
			vi.stubGlobal('fetch', fetchMock);

			const res = await app.inject({
				method: 'POST',
				url: '/api/llm/proxy',
				payload: { url: 'https://missing.invalid/x', headers: {} }
			});

			expect(res.statusCode).toBe(502);
			const json = res.json();
			expect(json.error).toBe('upstream fetch failed');
			expect(json.detail).toBeDefined();
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('invokes the upstream fetch with redirect: error', async () => {
			const fetchMock = vi
				.fn()
				.mockResolvedValue(new Response('ok', { headers: { 'content-type': 'text/plain' } }));
			vi.stubGlobal('fetch', fetchMock);

			const res = await app.inject({
				method: 'POST',
				url: '/api/llm/proxy',
				payload: { url: 'https://api.example.test/v1/chat', headers: {} }
			});

			expect(res.statusCode).toBe(200);
			const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
			expect(init.redirect).toBe('error');
		});

		it('pins MAX_PROXY_RESPONSE_BYTES at 64 MiB', () => {
			expect(MAX_PROXY_RESPONSE_BYTES).toBe(64 * 1024 * 1024);
		});

		it('cuts the stream off mid-body past MAX_PROXY_RESPONSE_BYTES', async () => {
			// Mirror the 64 MiB cap locally (instead of deriving the emission plan
			// from the imported constant) so a pre-implementation run cannot spin
			// an unbounded stream; the pin test above ties the export to 64 MiB.
			const CAP = 64 * 1024 * 1024;
			const CHUNK = 1024 * 1024;
			const stopAfter = CAP + 4 * CHUNK;
			let emitted = 0;
			// One MiB allocated once; re-emitted as fresh views over the same
			// buffer — the stub never holds more than a few MiB.
			const shared = new Uint8Array(CHUNK);
			const stream = new ReadableStream<Uint8Array>({
				pull(controller) {
					if (emitted >= stopAfter) {
						controller.close();
						return;
					}
					controller.enqueue(new Uint8Array(shared.buffer));
					emitted += CHUNK;
				}
			});
			const fetchMock = vi
				.fn()
				.mockResolvedValue(
					new Response(stream, { headers: { 'content-type': 'application/octet-stream' } })
				);
			vi.stubGlobal('fetch', fetchMock);

			// The relay destroys the hijacked reply mid-body; inject observes that
			// as the network error light-my-request synthesizes on raw destroy.
			// The outcome is reduced to a short string first — a pre-implementation
			// run resolves with a ~68 MiB body and printing it inside the assertion
			// diff would blow the capped test scope.
			const outcome = await app
				.inject({
					method: 'POST',
					url: '/api/llm/proxy',
					payload: { url: 'https://api.example.test/huge', headers: {} }
				})
				.then(
					() => 'completed',
					(err: unknown) => (err instanceof Error ? err.message : String(err))
				);
			expect(outcome).toMatch(/response destroyed before completion/);
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});
	});
});
