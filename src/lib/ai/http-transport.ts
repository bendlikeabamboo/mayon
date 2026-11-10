/**
 * The streaming HTTP transport seam. Adapters hand off a URL + non-secret
 * headers + body + an `auth` descriptor; the transport owns the fetch handshake
 * and resolves the secret into the request header itself.
 *
 * Browser only: fetch with secrets read from the `BrowserKeyStore`
 * (IndexedDB; the env-backed headless store when IndexedDB is absent).
 */
import { classifyFetchError, httpStatusToError } from './errors';
import { sameHost } from './llm-target';
import { createKeyStore } from './keystore/client';
import type { BrowserKeyStore } from './keystore/browser';
import { MissingKeyError } from './types';
import { getLlmFetch } from '#lib/services/llm-proxy-fetch.js';

export interface HttpStreamRequest {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	/** Transport resolves the secret into this header. */
	auth?: { header: string; keyId: string; scheme?: string };
	/**
	 * Declared provider API host (032): the credential is attached — and a
	 * missing key is an error — only when the request targets this host, and
	 * the declaration rides to the relay so it can enforce the same rule
	 * server-side. Unset keeps the legacy attach-everywhere behavior.
	 */
	authHost?: string;
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
			// Credential gate (032): resolve the secret / throw / attach only when
			// the request targets the declared provider host — a foreign-host
			// fetch stays credential-free and never fails on a missing key.
			const isAuthTarget = !req.authHost || sameHost(new URL(req.url).hostname, req.authHost);
			if (req.auth && isAuthTarget) {
				const key = await store.get(req.auth.keyId);
				if (!key) throw new MissingKeyError(undefined, req.auth.keyId);
				headers[req.auth.header] = req.auth.scheme ? `${req.auth.scheme} ${key}` : key;
			}

			let res: Response;
			try {
				res = await getLlmFetch(req.url, req.authHost)(req.url, {
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
 * Lazy singleton transport. Browser → `createFetchTransport` over the runtime
 * `BrowserKeyStore` (IndexedDB in the browser; the env-backed headless store
 * without IndexedDB). `setHttpTransport` overrides it (tests inject a
 * fake transport; pass `null` to reset to the runtime default).
 */
export function getHttpTransport(): HttpStreamTransport {
	if (cached) return cached;
	cached = createFetchTransport(createKeyStore());
	return cached;
}

/** Override the cached transport (pass `null` to reset to the runtime default). */
export function setHttpTransport(t: HttpStreamTransport | null): void {
	cached = t;
}
