import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from './server';
import type Fastify from 'fastify';

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
});
