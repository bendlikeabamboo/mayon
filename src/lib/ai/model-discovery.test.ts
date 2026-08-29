import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateCopilotSession } from './copilot-session';
import { createFetchTransport, setHttpTransport } from './http-transport';
import type { BrowserKeyStore } from './keystore/browser';
import { discoverModels, parseModelIds, readAll } from './model-discovery';
import { MissingKeyError, ProviderHttpError, type ProviderConfig } from './types';

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

const config: ProviderConfig = {
	id: 'or-1',
	kind: 'openai-compatible',
	name: 'OpenRouter',
	baseUrl: 'https://openrouter.ai/api/v1',
	defaultModel: 'openai/gpt-4o-mini',
	models: ['openai/gpt-4o-mini'],
	discoverable: true
};

/** Build a 200 Response carrying a byte body stream. */
function jsonBody(body: string): Response {
	return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

/** In-memory fake keystore so the fetch transport can resolve `auth`. */
function makeFakeStore(seed: Record<string, string> = {}): BrowserKeyStore {
	const map: Record<string, string> = { ...seed };
	return {
		get: async (id) => map[id] ?? null,
		has: async (id) => id in map,
		set: async (id, key) => {
			map[id] = key;
		},
		delete: async (id) => {
			delete map[id];
		}
	};
}

const copilotConfig: ProviderConfig = {
	id: 'cop-1',
	kind: 'github-copilot',
	name: 'GitHub Copilot',
	baseUrl: 'https://api.githubcopilot.com',
	defaultModel: 'gpt-5',
	models: ['gpt-5'],
	discoverable: true
};

const sessionDescriptor = {
	token: 'tid=test;exp=999;',
	expiresAt: Date.now() + 10 * 60 * 1000,
	endpoint: 'https://api.business.githubcopilot.com',
	refreshInSeconds: 1500
};

interface RecordedCall {
	url: string;
	init: RequestInit;
}

/** Dispatch-style fetch mock: answers the Copilot token exchange and records
 *  the `/models` call (mirrors copilot-fetch.test.ts). */
function mockCopilotDispatch(modelsBody: string): {
	tokenCalls: Array<{ url: string; method: string | undefined; body: unknown }>;
	modelCalls: RecordedCall[];
} {
	const tokenCalls: Array<{ url: string; method: string | undefined; body: unknown }> = [];
	const modelCalls: RecordedCall[] = [];
	(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			if (url === '/api/llm/copilot/token') {
				tokenCalls.push({
					url,
					method: init?.method,
					body: JSON.parse((init?.body as string) ?? '{}')
				});
				return jsonBody(JSON.stringify(sessionDescriptor));
			}
			modelCalls.push({
				url,
				init: { ...init, headers: Object.fromEntries(new Headers(init?.headers)) }
			});
			return jsonBody(modelsBody);
		}
	);
	return { tokenCalls, modelCalls };
}

describe('parseModelIds', () => {
	it('reads the OpenAI shape { data: [{ id }] }', () => {
		expect(parseModelIds(JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }] }))).toEqual(['a', 'b']);
	});

	it('tolerates a bare array of { id } objects', () => {
		expect(parseModelIds(JSON.stringify([{ id: 'x' }, { id: 'y' }]))).toEqual(['x', 'y']);
	});

	it('tolerates a bare array of strings', () => {
		expect(parseModelIds(JSON.stringify(['m1', 'm2']))).toEqual(['m1', 'm2']);
	});

	it('de-duplicates and sorts', () => {
		expect(
			parseModelIds(JSON.stringify({ data: [{ id: 'c' }, { id: 'a' }, { id: 'c' }] }))
		).toEqual(['a', 'c']);
	});

	it('ignores entries without a string id', () => {
		expect(
			parseModelIds(JSON.stringify({ data: [{ id: 'ok' }, { name: 'no-id' }, { id: 42 }] }))
		).toEqual(['ok']);
	});

	it('returns [] for unparseable bodies', () => {
		expect(parseModelIds('not json')).toEqual([]);
	});

	it('returns [] for unrecognized shapes', () => {
		expect(parseModelIds(JSON.stringify({ objects: [] }))).toEqual([]);
	});

	it('keeps entries with a non-embedding type in { data } shape', () => {
		expect(
			parseModelIds(
				JSON.stringify({
					data: [
						{ id: 'c', type: 'chat' },
						{ id: 'l', type: 'language' }
					]
				})
			)
		).toEqual(['c', 'l']);
	});

	it('keeps entries with a non-embedding type in a bare array', () => {
		expect(parseModelIds(JSON.stringify([{ id: 'c', type: 'chat' }]))).toEqual(['c']);
	});

	it('keeps entries with an absent type field alongside typed ones', () => {
		expect(
			parseModelIds(JSON.stringify({ data: [{ id: 'plain' }, { id: 'typed', type: 'chat' }] }))
		).toEqual(['plain', 'typed']);
	});

	it('excludes entries with type "embedding" in the { data } shape', () => {
		expect(
			parseModelIds(
				JSON.stringify({ data: [{ id: 'chat-1' }, { id: 'embed-1', type: 'embedding' }] })
			)
		).toEqual(['chat-1']);
	});

	it('excludes entries with type "embedding" in a bare array', () => {
		expect(
			parseModelIds(JSON.stringify([{ id: 'chat-1' }, { id: 'embed-1', type: 'embedding' }]))
		).toEqual(['chat-1']);
	});
});

describe('readAll', () => {
	it('drains a chunked stream into a single UTF-8 string', async () => {
		const enc = new TextEncoder();
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(enc.encode('hel'));
				controller.enqueue(enc.encode('lo'));
				controller.close();
			}
		});
		expect(await readAll(stream)).toBe('hello');
	});
});

describe('discoverModels', () => {
	const originalFetch = globalThis.fetch;
	let fakeKeyStore: BrowserKeyStore;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
		fakeKeyStore = makeFakeStore();
		setHttpTransport(createFetchTransport(fakeKeyStore));
		invalidateCopilotSession(copilotConfig.id);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		setHttpTransport(null);
		vi.restoreAllMocks();
	});

	it('GETs <baseUrl>/models and returns sorted ids', async () => {
		await fakeKeyStore.set(config.id, 'secret');
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			jsonBody(
				JSON.stringify({
					data: [{ id: 'openai/gpt-4o' }, { id: 'openai/gpt-4o-mini' }]
				})
			)
		);

		const ids = await discoverModels(config, { hasKey: (id) => fakeKeyStore.has(id) });

		expect(ids).toEqual(['openai/gpt-4o', 'openai/gpt-4o-mini']);
		expect(globalThis.fetch).toHaveBeenCalledOnce();
		const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toBe('https://openrouter.ai/api/v1/models');
		expect((init as RequestInit).method).toBe('GET');
		expect((init as RequestInit).body).toBeUndefined();
	});

	it('attaches bearer auth when a key is configured', async () => {
		await fakeKeyStore.set(config.id, 'sk-or');
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			jsonBody(JSON.stringify({ data: [{ id: 'm' }] }))
		);
		await discoverModels(config, { hasKey: (id) => fakeKeyStore.has(id) });
		const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-or');
	});

	it('omits auth entirely when no key is configured (public catalogs)', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			jsonBody(JSON.stringify({ data: [{ id: 'm' }] }))
		);
		await discoverModels(config, { hasKey: () => Promise.resolve(false) });
		const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
	});

	it('surfaces a non-2xx response as a ProviderHttpError', async () => {
		await fakeKeyStore.set(config.id, 'k');
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response('nope', { status: 401 })
		);
		await expect(
			discoverModels(config, { hasKey: (id) => fakeKeyStore.has(id) })
		).rejects.toBeInstanceOf(ProviderHttpError);
	});

	it('tolerates a trailing slash on the base URL', async () => {
		await fakeKeyStore.set(config.id, 'k');
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			jsonBody(JSON.stringify({ data: [] }))
		);
		const slashy = { ...config, baseUrl: 'https://openrouter.ai/api/v1/' };
		await discoverModels(slashy, { hasKey: (id) => fakeKeyStore.has(id) });
		const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(url).toBe('https://openrouter.ai/api/v1/models');
	});

	describe('github-copilot discovery', () => {
		it('resolves a session first and sends the Copilot header set to the session endpoint', async () => {
			keys.current = { [copilotConfig.id]: 'ghu_grant' };
			const { tokenCalls, modelCalls } = mockCopilotDispatch(
				JSON.stringify({
					data: [{ id: 'gpt-5', object: 'model', capabilities: { type: 'chat' } }]
				})
			);

			const ids = await discoverModels(copilotConfig, { hasKey: (id) => fakeKeyStore.has(id) });

			expect(ids).toEqual(['gpt-5']);
			expect(tokenCalls).toEqual([
				{ url: '/api/llm/copilot/token', method: 'POST', body: { githubToken: 'ghu_grant' } }
			]);
			expect(modelCalls).toHaveLength(1);
			expect(modelCalls[0].url).toBe('https://api.business.githubcopilot.com/models');
			const headers = new Headers(modelCalls[0].init.headers as HeadersInit);
			expect(headers.get('Authorization')).toBe(`Bearer ${sessionDescriptor.token}`);
			expect(headers.get('Copilot-Integration-Id')).toBe('vscode-chat');
			expect(headers.get('Editor-Version')).toBe('vscode/1.98.0');
			expect(headers.get('Editor-Plugin-Version')).toBe('copilot-chat/0.35.0');
			expect(headers.get('x-github-api-version')).toBe('2025-05-01');
		});

		it('keeps only chat-capable, policy-enabled model entries and ignores model_picker_enabled', async () => {
			keys.current = { [copilotConfig.id]: 'ghu_grant' };
			mockCopilotDispatch(
				JSON.stringify({
					data: [
						{
							id: 'gpt-5',
							object: 'model',
							capabilities: { type: 'chat' },
							policy: { state: 'enabled' },
							model_picker_enabled: false
						},
						{ id: 'claude-sonnet-4', object: 'model', capabilities: { type: 'chat' } },
						{ id: 'gpt-5', object: 'model', capabilities: { type: 'chat' } },
						{
							id: 'blocked',
							object: 'model',
							capabilities: { type: 'chat' },
							policy: { state: 'disabled' }
						},
						{ id: 'embed-1', object: 'model', capabilities: { type: 'embedding' } },
						{ id: 'legacy-embed', type: 'embedding' },
						{ id: 'router', object: 'model_listing', capabilities: { type: 'chat' } },
						'bare-string'
					]
				})
			);

			const ids = await discoverModels(copilotConfig, { hasKey: (id) => fakeKeyStore.has(id) });

			expect(ids).toEqual(['claude-sonnet-4', 'gpt-5']);
		});

		it('throws MissingKeyError before any request when no grant is stored', async () => {
			keys.current = {};
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
				jsonBody(JSON.stringify({ data: [] }))
			);

			await expect(
				discoverModels(copilotConfig, { hasKey: (id) => fakeKeyStore.has(id) })
			).rejects.toBeInstanceOf(MissingKeyError);
			expect(globalThis.fetch).not.toHaveBeenCalled();
		});
	});
});
