import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import type { LlmProxyRequest } from '@mayon/shared';
import { assertPublicHttpTarget, BlockedTargetError } from './url-target-guard';

/**
 * Headers that carry provider credentials (032 credential-forwarding rule):
 * forwarded only when the client's declared `authHost` matches the target
 * host; otherwise stripped before the upstream fetch.
 */
export const CREDENTIAL_HEADERS: readonly string[] = [
	'authorization',
	'x-api-key',
	'x-goog-api-key'
];

/**
 * Relay response bound (D6): the piped stream is destroyed once it exceeds
 * 64 MiB — the client observes a network error mid-body.
 */
export const MAX_PROXY_RESPONSE_BYTES = 64 * 1024 * 1024;

/**
 * Hostname normalization for the credential rule (D2 semantics, local
 * re-implementation — the server never imports SPA code): lowercase, strip
 * the trailing root dot, strip IPv6 brackets.
 */
function normalizeHostname(host: string): string {
	let normalized = host.trim().toLowerCase();
	if (normalized.startsWith('[') && normalized.endsWith(']')) {
		normalized = normalized.slice(1, -1);
	}
	while (normalized.endsWith('.')) {
		normalized = normalized.slice(0, -1);
	}
	return normalized;
}

/**
 * Credential-forwarding rule (032): credentials ride only to the declared
 * host. `declared` is null when `authHost` is absent/empty → strip silently;
 * the request still proceeds (D3).
 */
function forwardCredentialHeaders(body: LlmProxyRequest, targetHost: string): boolean {
	const declared =
		typeof body.authHost === 'string' && body.authHost.length > 0
			? normalizeHostname(body.authHost)
			: null;
	return declared !== null && declared === targetHost;
}

/**
 * Dev/test exemption for the target-safety rule: exact hostnames the relay
 * lets through without the non-public IP check, from
 * `MAYON_LLM_RELAY_ALLOW_HOSTS` (comma-separated, same normalization as
 * `authHost`). The dev compose file sets it to the mock provider host so the
 * e2e shard stacks can reach it through the relay; every prod artifact leaves
 * it unset (strict deny). Exact hostnames only — never wildcards or subnets —
 * and the exemption skips just the IP-range check, never the credential rule.
 */
export function relayAllowHosts(): Set<string> {
	const raw = process.env.MAYON_LLM_RELAY_ALLOW_HOSTS ?? '';
	return new Set(
		raw
			.split(',')
			.map((host) => normalizeHostname(host))
			.filter((host) => host.length > 0)
	);
}

const HOP_BY_HOP = new Set([
	'content-encoding',
	'content-length',
	'transfer-encoding',
	'connection',
	'keep-alive'
]);

export function registerLlmProxy(app: FastifyInstance): void {
	app.post('/api/llm/proxy', { bodyLimit: 16 * 1024 * 1024 }, async (req, reply) => {
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

		const forwardCredentials = forwardCredentialHeaders(body, normalizeHostname(parsed.hostname));
		const headers: Record<string, string> = {};
		for (const [key, value] of Object.entries(body.headers ?? {})) {
			if (!forwardCredentials && CREDENTIAL_HEADERS.includes(key.toLowerCase())) {
				continue;
			}
			headers[key] = value;
		}

		let upstream: Response;
		try {
			// Target safety (032 / D4): validate the destination against the
			// non-public IP range table before any upstream bytes move; resolver
			// failures fall through to the 502 handler (fail-closed). Exact
			// dev/test hostnames (MAYON_LLM_RELAY_ALLOW_HOSTS) skip the
			// IP-range check only — the credential rule above still applies.
			if (!relayAllowHosts().has(normalizeHostname(parsed.hostname))) {
				await assertPublicHttpTarget(body.url);
			}
			upstream = await fetch(body.url, {
				method: body.method ?? 'GET',
				headers,
				body: body.body,
				cache: 'no-store',
				// D5: never follow redirects — custom auth headers survive
				// cross-origin redirects in undici, so only refusal closes it.
				redirect: 'error'
			});
		} catch (err) {
			if (err instanceof BlockedTargetError) {
				reply.code(403).send({ error: 'blocked target', detail: err.kind });
				return;
			}
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
			const controller = new AbortController();
			reply.raw.on('close', () => {
				controller.abort();
			});
			const nodeStream = Readable.fromWeb(upstream.body as import('stream/web').ReadableStream);
			nodeStream.on('error', () => {
				reply.raw.destroy();
			});
			// D6: count bytes while piping; past the cap destroy the stream (the
			// error handler above then destroys the reply).
			let streamed = 0;
			nodeStream.on('data', (chunk: Buffer) => {
				streamed += chunk.length;
				if (streamed > MAX_PROXY_RESPONSE_BYTES) {
					nodeStream.destroy(new Error('proxy response exceeded MAX_PROXY_RESPONSE_BYTES'));
				}
			});
			nodeStream.pipe(reply.raw);
		} else {
			reply.raw.end();
		}
	});
}
