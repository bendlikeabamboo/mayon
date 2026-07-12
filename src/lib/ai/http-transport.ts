/**
 * The streaming HTTP transport seam. Adapters hand off a URL + non-secret
 * headers + body + an `auth` descriptor; the transport owns the fetch handshake
 * and resolves the secret into the request header itself.
 *
 * Browser only: fetch with secrets read from the `BrowserKeyStore` (IndexedDB).
 */
import { classifyFetchError, httpStatusToError } from './errors';
import { createBrowserKeyStore, type BrowserKeyStore } from './keystore/browser';
import { MissingKeyError } from './types';
import { getLlmFetch } from '$lib/server/llm-proxy-fetch';

export interface HttpStreamRequest {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	/** Transport resolves the secret into this header. */
	auth?: { header: string; keyId: string; scheme?: string };
}

export interface HttpStreamTransport {
	request(req: HttpStreamRequest, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>>;
}

/**
 * Browser transport: `fetch` with the secret read from the `BrowserKeyStore`
 * (which can `get` a key back) into `auth.header` (scheme-prefixed when given).
 * Errors stay typed via the shared `classifyFetchError` / `httpStatusToError`.
 */
export function createFetchTransport(store: BrowserKeyStore): HttpStreamTransport {
	return {
		async request(req, signal) {
			const headers: Record<string, string> = { ...(req.headers ?? {}) };
			if (req.auth) {
				const key = await store.get(req.auth.keyId);
				if (!key) throw new MissingKeyError(undefined, req.auth.keyId);
				headers[req.auth.header] = req.auth.scheme ? `${req.auth.scheme} ${key}` : key;
			}

			let res: Response;
			try {
				res = await getLlmFetch()(req.url, {
					method: req.method ?? 'POST',
					headers,
					body: req.body,
					signal,
					cache: 'no-store'
				});
			} catch (err) {
				throw classifyFetchError(err, req.url);
			}

			if (!res.ok || !res.body) {
				throw await httpStatusToError(res);
			}
			return res.body;
		}
	};
}

let cached: HttpStreamTransport | null = null;

/**
 * Lazy singleton transport. Browser → `createFetchTransport` over the
 * IndexedDB `BrowserKeyStore`. `setHttpTransport` overrides it (tests inject a
 * fake transport; pass `null` to reset to the runtime default).
 */
export function getHttpTransport(): HttpStreamTransport {
	if (cached) return cached;
	cached = createFetchTransport(createBrowserKeyStore());
	return cached;
}

/** Override the cached transport (pass `null` to reset to the runtime default). */
export function setHttpTransport(t: HttpStreamTransport | null): void {
	cached = t;
}
