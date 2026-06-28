import { isTauri } from '$lib/db';
import { classifyFetchError, httpStatusToError } from './errors';
import { createBrowserKeyStore } from './keystore/browser';
import { getHttpTransport } from './http-transport';
import { MissingKeyError } from './types';

export interface KeychainFetchAuth {
	header: string;
	keyId: string;
	scheme?: string;
}

export function createKeychainFetch(auth: KeychainFetchAuth): typeof globalThis.fetch {
	if (!isTauri()) {
		return createBrowserKeychainFetch(auth);
	}
	return createDesktopKeychainFetch(auth);
}

function createBrowserKeychainFetch(auth: KeychainFetchAuth): typeof globalThis.fetch {
	const store = createBrowserKeyStore();
	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const headers = new Headers(init?.headers);
		const key = await store.get(auth.keyId);
		if (!key) throw new MissingKeyError(undefined, auth.keyId);
		headers.set(auth.header, auth.scheme ? `${auth.scheme} ${key}` : key);

		let res: Response;
		try {
			res = await fetch(url, {
				...init,
				headers,
				cache: 'no-store'
			});
		} catch (err) {
			throw classifyFetchError(err, url);
		}

		if (!res.ok) {
			throw await httpStatusToError(res);
		}
		return res;
	};
}

function createDesktopKeychainFetch(auth: KeychainFetchAuth): typeof globalThis.fetch {
	const transport = getHttpTransport();
	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const bodyStr = typeof init?.body === 'string' ? init.body : undefined;

		const responseStream = await transport.request(
			{
				url,
				method: init?.method as string | undefined,
				headers: headersToRecord(init?.headers),
				body: bodyStr,
				auth
			},
			init?.signal instanceof AbortSignal ? init.signal : undefined
		);

		const chunks: Uint8Array[] = [];
		const reader = responseStream.getReader();
		let status = 200;
		let errorMessage = '';

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
			}
		} catch (err) {
			if (err instanceof Error) {
				if (
					err.name === 'RateLimitError' ||
					err.name === 'ProviderHttpError' ||
					err.name === 'NetworkError'
				) {
					throw err;
				}
				if (err.name === 'AbortError') throw err;
				status = 502;
				errorMessage = err.message;
			} else {
				status = 502;
				errorMessage = String(err);
			}
		} finally {
			try {
				reader.releaseLock();
			} catch {
				/* already released */
			}
		}

		const fullBody = concatChunks(chunks);
		const text = new TextDecoder().decode(fullBody);

		if (errorMessage) {
			return new Response(errorMessage, {
				status,
				headers: { 'Content-Type': 'text/plain' }
			});
		}

		return new Response(text, {
			status: 200,
			headers: { 'Content-Type': 'application/octet-stream' }
		});
	};
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> | undefined {
	if (!headers) return undefined;
	if (headers instanceof Headers) {
		const out: Record<string, string> = {};
		headers.forEach((v, k) => {
			out[k] = v;
		});
		return out;
	}
	if (Array.isArray(headers)) {
		const out: Record<string, string> = {};
		for (const [k, v] of headers) out[k] = v;
		return out;
	}
	return headers as Record<string, string>;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
	if (chunks.length === 0) return new Uint8Array(0);
	let total = 0;
	for (const c of chunks) total += c.length;
	const result = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		result.set(c, offset);
		offset += c.length;
	}
	return result;
}
