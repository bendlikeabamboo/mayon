import { serverStatus } from './status.svelte';
import { isLoopbackUrl } from '#lib/ai/llm-target.js';

function createProxyFetch(authHost?: string): typeof globalThis.fetch {
	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const proxyBody: {
			url: string;
			method: string;
			headers: Record<string, string>;
			body?: string;
			authHost?: string;
		} = {
			url,
			method: init?.method ?? 'GET',
			headers: Object.fromEntries(new Headers(init?.headers))
		};

		if (typeof init?.body === 'string') {
			proxyBody.body = init.body;
		}

		// Declared credential host (032): copied verbatim so the relay can decide
		// which headers stay; absent keeps the keyless/legacy shape.
		if (authHost !== undefined) {
			proxyBody.authHost = authHost;
		}

		const proxyRes = await fetch('/api/llm/proxy', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(proxyBody),
			signal: init?.signal
		});

		return new Response(proxyRes.body, {
			status: proxyRes.status,
			headers: proxyRes.headers
		});
	};
}

/**
 * Fetch for LLM traffic: proxied through the server (`llm-proxy` cap) unless
 * `url` targets loopback, which the server cannot reach — those go direct.
 * `authHost` (032) declares the credential-bearing host; when proxying it is
 * forwarded verbatim in the relay request body so the server can enforce the
 * credential-forwarding rule, and it is ignored on the browser-direct path.
 */
export function getLlmFetch(url: string, authHost?: string): typeof globalThis.fetch {
	if (serverStatus.has('llm-proxy') && !isLoopbackUrl(url)) {
		return createProxyFetch(authHost);
	}
	return globalThis.fetch;
}
