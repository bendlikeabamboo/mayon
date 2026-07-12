import { classifyFetchError, httpStatusToError } from './errors';
import { createBrowserKeyStore } from './keystore/browser';
import { MissingKeyError } from './types';
import { getLlmFetch } from '$lib/sidecar/llm-proxy-fetch';

export interface KeychainFetchAuth {
	header: string;
	keyId: string;
	scheme?: string;
}

export function createKeychainFetch(auth: KeychainFetchAuth): typeof globalThis.fetch {
	return createBrowserKeychainFetch(auth);
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
			res = await getLlmFetch()(url, {
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
