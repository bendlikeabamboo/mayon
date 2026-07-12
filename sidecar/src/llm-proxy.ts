import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import type { LlmProxyRequest } from '@mayon/shared';

const HOP_BY_HOP = new Set([
	'content-encoding',
	'content-length',
	'transfer-encoding',
	'connection',
	'keep-alive'
]);

export function registerLlmProxy(app: FastifyInstance): void {
	app.post('/api/llm/proxy', async (req, reply) => {
		let body: LlmProxyRequest;
		try {
			body = req.body as LlmProxyRequest;
		} catch {
			reply.code(400).send({ error: 'invalid request body' });
			return;
		}

		if (!body.url || typeof body.url !== 'string') {
			reply.code(400).send({ error: 'missing or invalid url' });
			return;
		}

		let parsed: URL;
		try {
			parsed = new URL(body.url);
		} catch {
			reply.code(400).send({ error: 'invalid url' });
			return;
		}

		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			reply.code(400).send({ error: 'url must be http(s)' });
			return;
		}

		const controller = new AbortController();
		req.raw.on('close', () => {
			controller.abort();
		});

		let upstream: Response;
		try {
			upstream = await fetch(body.url, {
				method: body.method ?? 'GET',
				headers: body.headers,
				body: body.body,
				signal: controller.signal,
				cache: 'no-store'
			});
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			reply.raw.writeHead(502, { 'content-type': 'application/json' });
			reply.raw.end(JSON.stringify({ error: 'upstream fetch failed', detail }));
			return;
		}

		const forwardedHeaders: Record<string, string> = {};
		const upstreamHeaders = Object.fromEntries(upstream.headers.entries());
		for (const [key, value] of Object.entries(upstreamHeaders)) {
			if (!HOP_BY_HOP.has(key.toLowerCase())) {
				forwardedHeaders[key] = value;
			}
		}

		forwardedHeaders['x-accel-buffering'] = 'no';

		reply.hijack();
		reply.raw.writeHead(upstream.status, forwardedHeaders);

		if (upstream.body) {
			const nodeStream = Readable.fromWeb(upstream.body as import('stream/web').ReadableStream);
			nodeStream.on('error', () => {
				reply.raw.destroy();
			});
			nodeStream.pipe(reply.raw);
		} else {
			reply.raw.end();
		}
	});
}
