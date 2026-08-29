import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissingKeyError, type ProviderConfig } from './types';

vi.mock('$lib/services/status.svelte', () => ({
	serverStatus: {
		has: vi.fn().mockReturnValue(false),
		connected: false,
		caps: [],
		version: null,
		error: null,
		markConnected: vi.fn(),
		markDisconnected: vi.fn()
	}
}));

const keys = vi.hoisted(() => ({ current: {} as Record<string, string> }));

vi.mock('./keystore/browser', () => ({
	createBrowserKeyStore: () => ({
		get: async (id: string) => keys.current[id] ?? null,
		has: async (id: string) => id in keys.current,
		set: async (id: string, key: string) => {
			keys.current[id] = key;
		},
		delete: async (id: string) => {
			delete keys.current[id];
		}
	})
}));

import { createCopilotFetch } from './copilot-fetch';
import { invalidateCopilotSession } from './copilot-session';
import { RateLimitError } from './types';
import { serverStatus } from '$lib/services/status.svelte';

const config: ProviderConfig = {
	id: 'cop-1',
	kind: 'github-copilot',
	name: 'GitHub Copilot',
	baseUrl: 'https://api.githubcopilot.com',
	defaultModel: 'gpt-5',
	models: ['gpt-5']
};

const sessionDescriptor = {
	token: 'tid=test;exp=999;',
	expiresAt: Date.now() + 10 * 60 * 1000,
	endpoint: 'https://api.githubcopilot.com',
	refreshInSeconds: 1500
};

interface RecordedCall {
	url: string;
	init: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function urlOf(input: RequestInfo | URL): string {
	return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

describe('createCopilotFetch', () => {
	const originalFetch = globalThis.fetch;
	let inferenceCalls: RecordedCall[];
	let tokenCalls: unknown[];

	function mockDispatch(): void {
		inferenceCalls = [];
		tokenCalls = [];
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = urlOf(input);
				if (url === '/api/llm/copilot/token') {
					tokenCalls.push(JSON.parse((init?.body as string) ?? '{}'));
					return jsonResponse(sessionDescriptor);
				}
				if (url === '/api/llm/proxy') {
					const envelope = JSON.parse((init?.body as string) ?? '{}');
					inferenceCalls.push({ url: envelope.url as string, init: envelope });
					return jsonResponse({});
				}
				inferenceCalls.push({
					url,
					init: { ...init, headers: Object.fromEntries(new Headers(init?.headers)) }
				});
				return jsonResponse({});
			}
		);
	}

	beforeEach(() => {
		invalidateCopilotSession(config.id);
		globalThis.fetch = vi.fn();
		keys.current = { [config.id]: 'ghu_test_grant' };
		mockDispatch();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('injects the mandatory Copilot header set on the inference request', async () => {
		const fetchFn = createCopilotFetch(config);
		await fetchFn('https://api.githubcopilot.com/chat/completions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		});

		expect(inferenceCalls).toHaveLength(1);
		const headers = new Headers(inferenceCalls[0].init.headers as HeadersInit);
		expect(headers.get('Authorization')).toBe(`Bearer ${sessionDescriptor.token}`);
		expect(headers.get('Copilot-Integration-Id')).toBe('vscode-chat');
		expect(headers.get('Editor-Version')).toBe('vscode/1.98.0');
		expect(headers.get('Editor-Plugin-Version')).toBe('copilot-chat/0.35.0');
		expect(headers.get('User-Agent')).toBe('GitHubCopilotChat/0.35.0');
		expect(headers.get('x-github-api-version')).toBe('2025-05-01');
	});

	it('rewrites the target origin to the session endpoint preserving path+query', async () => {
		const business = { ...sessionDescriptor, endpoint: 'https://api.business.githubcopilot.com' };
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = urlOf(input);
				if (url === '/api/llm/copilot/token') return jsonResponse(business);
				inferenceCalls.push({
					url,
					init: { ...init, headers: Object.fromEntries(new Headers(init?.headers)) }
				});
				return jsonResponse({});
			}
		);

		const fetchFn = createCopilotFetch(config);
		await fetchFn('https://api.githubcopilot.com/chat/completions?api-version=1', {
			method: 'POST',
			body: '{}'
		});

		expect(inferenceCalls[0].url).toBe(
			'https://api.business.githubcopilot.com/chat/completions?api-version=1'
		);
	});

	it('falls back to config.baseUrl when the descriptor has no endpoint', async () => {
		const endpointless = { ...sessionDescriptor, endpoint: '' };
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = urlOf(input);
				if (url === '/api/llm/copilot/token') return jsonResponse(endpointless);
				inferenceCalls.push({
					url,
					init: { ...init, headers: Object.fromEntries(new Headers(init?.headers)) }
				});
				return jsonResponse({});
			}
		);

		const fetchFn = createCopilotFetch(config);
		await fetchFn('https://api.githubcopilot.com/chat/completions', { method: 'POST', body: '{}' });

		expect(inferenceCalls[0].url).toBe('https://api.githubcopilot.com/chat/completions');
	});

	it('throws MissingKeyError carrying the provider id when no grant is stored', async () => {
		keys.current = {};

		const fetchFn = createCopilotFetch(config);
		const err = await fetchFn('https://api.githubcopilot.com/chat/completions', {
			method: 'POST'
		}).catch((e) => e);

		expect(err).toBeInstanceOf(MissingKeyError);
		expect((err as MissingKeyError).providerId).toBe(config.id);
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it('maps an inference 429 onto RateLimitError with the Retry-After hint', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
			async (input: RequestInfo | URL) => {
				if (urlOf(input) === '/api/llm/copilot/token') return jsonResponse(sessionDescriptor);
				return new Response('rate limited', { status: 429, headers: { 'retry-after': '42' } });
			}
		);

		const fetchFn = createCopilotFetch(config);
		const err = await fetchFn('https://api.githubcopilot.com/chat/completions', {
			method: 'POST',
			body: '{}'
		}).catch((e) => e);

		expect(err).toBeInstanceOf(RateLimitError);
		expect((err as RateLimitError).retryAfter).toBe(42);
	});

	it('maps an inference 429 without Retry-After onto RateLimitError with no retryAfter', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
			async (input: RequestInfo | URL) => {
				if (urlOf(input) === '/api/llm/copilot/token') return jsonResponse(sessionDescriptor);
				return new Response('rate limited', { status: 429 });
			}
		);

		const fetchFn = createCopilotFetch(config);
		const err = await fetchFn('https://api.githubcopilot.com/chat/completions', {
			method: 'POST',
			body: '{}'
		}).catch((e) => e);

		expect(err).toBeInstanceOf(RateLimitError);
		expect((err as RateLimitError).retryAfter).toBeUndefined();
	});

	it('exchanges the grant once and reuses the cached session across requests', async () => {
		const fetchFn = createCopilotFetch(config);
		await fetchFn('https://api.githubcopilot.com/chat/completions', { method: 'POST', body: '{}' });
		await fetchFn('https://api.githubcopilot.com/chat/completions', { method: 'POST', body: '{}' });

		expect(tokenCalls).toHaveLength(1);
		expect(tokenCalls[0]).toEqual({ githubToken: 'ghu_test_grant' });
		expect(inferenceCalls).toHaveLength(2);
	});

	it('delegates to the proxy-aware fetch when the llm-proxy cap is present', async () => {
		vi.mocked(serverStatus.has).mockReturnValue(true);

		const fetchFn = createCopilotFetch(config);
		await fetchFn('https://api.githubcopilot.com/chat/completions', {
			method: 'POST',
			body: '{}'
		});

		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
		const [proxyUrl, proxyInit] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
		expect(proxyUrl).toBe('/api/llm/proxy');
		const envelope = JSON.parse((proxyInit as RequestInit).body as string);
		expect(envelope.url).toBe('https://api.githubcopilot.com/chat/completions');
		expect(envelope.method).toBe('POST');
		const sentHeaders = new Headers(envelope.headers as HeadersInit);
		expect(sentHeaders.get('Authorization')).toBe(`Bearer ${sessionDescriptor.token}`);
		expect(sentHeaders.get('Copilot-Integration-Id')).toBe('vscode-chat');
	});
});
