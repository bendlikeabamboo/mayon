import { sidecarStatus } from './status.svelte';

function createProxyFetch(): typeof globalThis.fetch {
	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const proxyBody: {
			url: string;
			method: string;
			headers: Record<string, string>;
			body?: string;
		} = {
			url,
			method: init?.method ?? 'GET',
			headers: Object.fromEntries(new Headers(init?.headers))
		};

		if (typeof init?.body === 'string') {
			proxyBody.body = init.body;
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

export function getLlmFetch(): typeof globalThis.fetch {
	if (sidecarStatus.has('llm-proxy')) {
		return createProxyFetch();
	}
	return globalThis.fetch;
}
