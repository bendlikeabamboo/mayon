import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testProviderConnection } from './connection-test';
import { SERVER_REQUIRED_HINT } from './errors';
import { setHttpTransport, type HttpStreamTransport } from './http-transport';
import {
	CorsBlockedError,
	NetworkError,
	ProviderHttpError,
	RateLimitError,
	type ProviderConfig
} from './types';

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
	id: 'lm-1',
	kind: 'openai-compatible',
	name: 'LM Studio',
	baseUrl: 'http://localhost:1234/v1',
	defaultModel: '',
	models: [],
	requiresKey: false,
	discoverable: true,
	group: 'local'
};

const vllmConfig: ProviderConfig = {
	...config,
	id: 'vllm-1',
	name: 'vLLM',
	baseUrl: 'http://localhost:8000/v1'
};

const remoteConfig: ProviderConfig = {
	...config,
	id: 'remote-1',
	name: 'Remote gateway',
	baseUrl: 'https://api.example.test/v1'
};

const unknownLocalConfig: ProviderConfig = {
	...config,
	id: 'odd-1',
	name: 'Self-hosted',
	baseUrl: 'http://127.0.0.1:9999/v1'
};

/** Minimal `location` shape read by the insecure-target check. */
type LocationLike = { href: string; origin: string; protocol: string };

const g = globalThis as unknown as { location?: LocationLike };

/** A transport that fails any request; proves callers short-circuit before it. */
function explodingTransport(): HttpStreamTransport {
	return {
		request: async () => {
			throw new Error('transport must not be called');
		}
	};
}

/** Build a 200 Response carrying a byte body stream. */
function jsonBody(body: string): Response {
	return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('testProviderConnection', () => {
	const originalFetch = globalThis.fetch;
	const originalLocation = g.location;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
		keys.current = {};
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		g.location = originalLocation;
		setHttpTransport(null);
		vi.restoreAllMocks();
	});

	it('short-circuits key-missing before any network call', async () => {
		setHttpTransport(explodingTransport());
		const res = await testProviderConnection({ ...config, requiresKey: true });

		expect(res.ok).toBe(false);
		expect(res.failure?.class).toBe('key-missing');
		expect(res.failure?.title).toBeTruthy();
		expect(res.failure?.message).toBeTruthy();
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it('returns discovered models sorted and de-duplicated on success', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () =>
			jsonBody(
				JSON.stringify({
					data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }, { id: 'e', type: 'embedding' }]
				})
			)
		);

		const res = await testProviderConnection(config);

		expect(res).toEqual({ ok: true, models: ['a', 'b'] });
		expect(globalThis.fetch).toHaveBeenCalledOnce();
	});

	it('classifies not-running when the transport fails and the no-cors probe rejects', async () => {
		setHttpTransport({
			request: async () => {
				throw new NetworkError(
					'Network request failed (offline or unreachable).',
					new TypeError('fail')
				);
			}
		});
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
			new TypeError('probe refused')
		);

		const res = await testProviderConnection(config);

		expect(res.ok).toBe(false);
		expect(res.failure?.class).toBe('not-running');
		expect(res.failure?.message).toContain(config.baseUrl);
		const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toBe(config.baseUrl);
		expect((init as RequestInit).mode).toBe('no-cors');
	});

	it('classifies cors-blocked when the transport fails but the no-cors probe resolves', async () => {
		setHttpTransport({
			request: async () => {
				throw new CorsBlockedError();
			}
		});
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response());

		const res = await testProviderConnection(config);

		expect(res.ok).toBe(false);
		expect(res.failure?.class).toBe('cors-blocked');
		expect(res.failure?.title).toBeTruthy();
	});

	it('classifies timeout when the deadline aborts a hanging transport', async () => {
		setHttpTransport({
			request: (_req, signal) =>
				new Promise((_resolve, reject) => {
					signal?.addEventListener('abort', () =>
						reject(signal.reason ?? new DOMException('aborted', 'AbortError'))
					);
				})
		});

		const res = await testProviderConnection(config, { timeoutMs: 25 });

		expect(res.ok).toBe(false);
		expect(res.failure?.class).toBe('timeout');
	});

	it('detects a timeout wrapped by the existing classify path', async () => {
		setHttpTransport({
			request: async () => {
				throw new NetworkError(
					'The operation was aborted due to timeout',
					new DOMException('The operation was aborted due to timeout', 'TimeoutError')
				);
			}
		});

		const res = await testProviderConnection(config, { timeoutMs: 8_000 });

		expect(res.failure?.class).toBe('timeout');
	});

	it('passes an HTTP failure through as class http with status and detail', async () => {
		setHttpTransport({
			request: async () => {
				throw new ProviderHttpError('Provider returned HTTP 500: boom', 500, 'boom');
			}
		});

		const res = await testProviderConnection(config);

		expect(res.ok).toBe(false);
		expect(res.failure?.class).toBe('http');
		expect(res.failure?.status).toBe(500);
		expect(res.failure?.detail).toBe('boom');
	});

	it('classifies a 429 as rate-limited and passes Retry-After through', async () => {
		setHttpTransport({
			request: async () => {
				throw new RateLimitError(undefined, 12);
			}
		});

		const res = await testProviderConnection(config);

		expect(res.ok).toBe(false);
		expect(res.failure?.class).toBe('rate-limited');
		expect(res.failure?.status).toBe(429);
		expect(res.failure?.hint).toContain('12s');
	});

	it('keeps the remote cors-blocked copy with the server hint', async () => {
		setHttpTransport({
			request: async () => {
				throw new CorsBlockedError();
			}
		});
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response());

		const res = await testProviderConnection(remoteConfig);

		expect(res.failure?.class).toBe('cors-blocked');
		expect(res.failure?.message).toBe(
			'The server answered, but the browser blocked the exchange (cross-origin). Enable CORS on the server and test again.'
		);
		expect(res.failure?.hint).toBe(SERVER_REQUIRED_HINT);
	});

	it('coaches LM Studio CORS settings for a loopback target', async () => {
		setHttpTransport({
			request: async () => {
				throw new CorsBlockedError();
			}
		});
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response());

		const res = await testProviderConnection(config);

		expect(res.failure?.class).toBe('cors-blocked');
		expect(res.failure?.hint).toContain('Developer settings');
		expect(res.failure?.hint).toContain('lms server start --cors');
		expect(res.failure?.hint).not.toBe(SERVER_REQUIRED_HINT);
	});

	it('coaches vLLM --allowed-origins for a loopback vLLM target', async () => {
		setHttpTransport({
			request: async () => {
				throw new CorsBlockedError();
			}
		});
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response());

		const res = await testProviderConnection(vllmConfig);

		expect(res.failure?.class).toBe('cors-blocked');
		expect(res.failure?.hint).toContain('--allowed-origins');
	});

	it('falls back to generic local CORS coaching for an unknown local runtime', async () => {
		setHttpTransport({
			request: async () => {
				throw new CorsBlockedError();
			}
		});
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response());

		const res = await testProviderConnection(unknownLocalConfig);

		expect(res.failure?.class).toBe('cors-blocked');
		expect(res.failure?.hint).toBe("Check your runtime's CORS/cross-origin setting.");
	});

	it('classifies insecure-blocked when the page is HTTPS and the target is plain HTTP', async () => {
		g.location = { href: 'https://mayon.test/', origin: 'https://mayon.test', protocol: 'https:' };
		setHttpTransport({
			request: async () => {
				throw new NetworkError('Failed to fetch', new TypeError('Failed to fetch'));
			}
		});

		const res = await testProviderConnection(config);

		expect(res.failure?.class).toBe('insecure-blocked');
		expect(res.failure?.message).toContain('refuses plain-HTTP requests from a secure page');
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it('classifies a 404 as not-found with the /v1 coaching', async () => {
		setHttpTransport({
			request: async () => {
				throw new ProviderHttpError('Provider returned HTTP 404', 404);
			}
		});

		const res = await testProviderConnection(config);

		expect(res.failure?.class).toBe('not-found');
		expect(res.failure?.message).toContain(`${config.baseUrl}/models does not exist`);
		expect(res.failure?.message).toContain('/v1');
	});

	it('classifies 401 and 403 as auth failures', async () => {
		setHttpTransport({
			request: async () => {
				throw new ProviderHttpError('Provider returned HTTP 401', 401);
			}
		});
		expect((await testProviderConnection(config)).failure?.class).toBe('auth');

		setHttpTransport({
			request: async () => {
				throw new ProviderHttpError('Provider returned HTTP 403', 403);
			}
		});
		expect((await testProviderConnection(config)).failure?.class).toBe('auth');
	});
});
