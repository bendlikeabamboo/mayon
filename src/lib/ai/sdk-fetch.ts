import { classifyFetchError, httpStatusToError } from './errors';
import { sameHost } from './llm-target';
import { createKeyStore } from './keystore/client';
import { MissingKeyError } from './types';
import { getLlmFetch } from '#lib/services/llm-proxy-fetch.js';

export interface KeychainFetchAuth {
	header: string;
	keyId: string;
	scheme?: string;
	/**
	 * Keyless providers (e.g. local runtimes, keyless gateways): proceed without
	 * the auth header when no key is stored instead of throwing
	 * `MissingKeyError`. A key saved later is still attached.
	 */
	optionalKey?: boolean;
	/**
	 * Declared provider API host (hostname of the provider `baseUrl`, 032): the
	 * key is attached — and a missing key is an error — only when the request
	 * targets this host, so model-supplied URLs (e.g. image links) can never
	 * carry the credential to another origin. Unset keeps the legacy
	 * attach-everywhere behavior.
	 */
	authHost?: string;
}

export function createKeychainFetch(auth: KeychainFetchAuth): typeof globalThis.fetch {
	return createBrowserKeychainFetch(auth);
}

function createBrowserKeychainFetch(auth: KeychainFetchAuth): typeof globalThis.fetch {
	const store = createKeyStore();
	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const headers = new Headers(init?.headers);
		// Credential gate (032): read the key store / throw / attach only when the
		// request targets the declared provider host — a foreign-host fetch stays
		// credential-free and never fails on a missing key.
		const isAuthTarget = !auth.authHost || sameHost(new URL(url).hostname, auth.authHost);
		if (isAuthTarget) {
			const key = await store.get(auth.keyId);
			if (!key && !auth.optionalKey) throw new MissingKeyError(undefined, auth.keyId);
			if (key) headers.set(auth.header, auth.scheme ? `${auth.scheme} ${key}` : key);
		}

		let res: Response;
		try {
			res = await getLlmFetch(url, auth.authHost)(url, {
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
