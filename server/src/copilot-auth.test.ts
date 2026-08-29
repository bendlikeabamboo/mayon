import { afterEach, afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from './server';
import type Fastify from 'fastify';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
const GITHUB_USER_URL = 'https://api.github.com/user';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function lowerHeaders(headers: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries((headers ?? {}) as Record<string, string>)) {
		out[key.toLowerCase()] = value;
	}
	return out;
}

describe('copilot auth endpoints', () => {
	let app: Fastify.Instance;

	beforeAll(async () => {
		app = buildApp(':memory:');
		await app.listen({ port: 0, host: '0.0.0.0' });
	});

	afterAll(async () => {
		await app.close();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	async function startFlow(): Promise<string> {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonResponse({
					device_code: `dc_${Math.random().toString(36).slice(2)}`,
					user_code: 'XXXX-XXXX',
					verification_uri: 'https://github.com/login/device',
					expires_in: 900,
					interval: 5
				})
			)
		);
		const res = await app.inject({
			method: 'POST',
			url: '/api/llm/copilot/auth/start',
			payload: {}
		});
		expect(res.statusCode).toBe(200);
		return res.json().flowId;
	}

	async function poll(flowId: string) {
		return app.inject({
			method: 'POST',
			url: '/api/llm/copilot/auth/poll',
			payload: { flowId }
		});
	}

	async function exchange(githubToken: string) {
		return app.inject({
			method: 'POST',
			url: '/api/llm/copilot/token',
			payload: { githubToken }
		});
	}

	describe('POST /api/llm/copilot/auth/start', () => {
		it('creates a flow and never exposes device_code', async () => {
			const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
				expect(String(url)).toBe(DEVICE_CODE_URL);
				expect(init?.method).toBe('POST');
				const headers = lowerHeaders(init?.headers);
				expect(headers['accept']).toBe('application/json');
				const params = new URLSearchParams(String(init?.body));
				expect(params.get('client_id')).toBe('Iv1.b507a08c87ecfe98');
				expect(params.get('scope')).toBe('read:user');
				return jsonResponse({
					device_code: 'secret-device-code-123',
					user_code: 'ABCD-1234',
					verification_uri: 'https://github.com/login/device',
					expires_in: 900,
					interval: 5
				});
			});
			vi.stubGlobal('fetch', fetchMock);

			const res = await app.inject({
				method: 'POST',
				url: '/api/llm/copilot/auth/start',
				payload: {}
			});

			expect(res.statusCode).toBe(200);
			const json = res.json();
			expect(typeof json.flowId).toBe('string');
			expect(json.userCode).toBe('ABCD-1234');
			expect(json.verificationUri).toBe('https://github.com/login/device');
			expect(json.interval).toBe(5);
			expect(json.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
			expect(res.body).not.toContain('device_code');
			expect(res.body).not.toContain('secret-device-code-123');
		});

		it('returns 502 upstream when GitHub is unreachable', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => {
					throw new Error('github down');
				})
			);

			const res = await app.inject({
				method: 'POST',
				url: '/api/llm/copilot/auth/start',
				payload: {}
			});

			expect(res.statusCode).toBe(502);
			const json = res.json();
			expect(json.error).toBe('upstream');
			expect(json.message).toBeDefined();
		});
	});

	describe('POST /api/llm/copilot/auth/poll', () => {
		it('returns pending while GitHub reports authorization_pending', async () => {
			const flowId = await startFlow();
			const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
				expect(String(url)).toBe(ACCESS_TOKEN_URL);
				const headers = lowerHeaders(init?.headers);
				expect(headers['accept']).toBe('application/json');
				const params = new URLSearchParams(String(init?.body));
				expect(params.get('client_id')).toBe('Iv1.b507a08c87ecfe98');
				expect(params.get('device_code')).toBeTruthy();
				expect(params.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
				return jsonResponse({ error: 'authorization_pending' });
			});
			vi.stubGlobal('fetch', fetchMock);

			const res = await poll(flowId);

			expect(res.statusCode).toBe(200);
			expect(res.json()).toEqual({ status: 'pending' });
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it('returns slowDownAfter when GitHub says slow_down', async () => {
			const flowId = await startFlow();
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => jsonResponse({ error: 'slow_down' }))
			);

			const res = await poll(flowId);

			expect(res.statusCode).toBe(200);
			expect(res.json()).toEqual({ status: 'pending', slowDownAfter: 10 });
		});

		it('returns complete exactly once with the grant and login, then drops the flow', async () => {
			const flowId = await startFlow();
			const fetchMock = vi.fn(async (url: string | URL) => {
				if (String(url) === ACCESS_TOKEN_URL) {
					return jsonResponse({ access_token: 'ghu_complete_token', token_type: 'bearer' });
				}
				if (String(url) === GITHUB_USER_URL) {
					return jsonResponse({ login: 'octocat' });
				}
				throw new Error(`unexpected upstream url: ${String(url)}`);
			});
			vi.stubGlobal('fetch', fetchMock);

			const res = await poll(flowId);

			expect(res.statusCode).toBe(200);
			expect(res.json()).toEqual({
				status: 'complete',
				githubToken: 'ghu_complete_token',
				user: { login: 'octocat' }
			});

			const res2 = await poll(flowId);
			expect(res2.statusCode).toBe(404);
			expect(res2.json()).toEqual({ error: 'unknown_flow' });
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it('returns expired on expired_token and drops the flow', async () => {
			const flowId = await startFlow();
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => jsonResponse({ error: 'expired_token' }))
			);

			const res = await poll(flowId);

			expect(res.statusCode).toBe(200);
			expect(res.json()).toEqual({ status: 'expired' });
			const res2 = await poll(flowId);
			expect(res2.statusCode).toBe(404);
		});

		it('returns denied on access_denied and drops the flow', async () => {
			const flowId = await startFlow();
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => jsonResponse({ error: 'access_denied' }))
			);

			const res = await poll(flowId);

			expect(res.statusCode).toBe(200);
			expect(res.json()).toEqual({ status: 'denied' });
			const res2 = await poll(flowId);
			expect(res2.statusCode).toBe(404);
		});

		it('returns 404 unknown_flow for an unknown flowId', async () => {
			const res = await poll('no-such-flow');

			expect(res.statusCode).toBe(404);
			expect(res.json()).toEqual({ error: 'unknown_flow' });
		});

		it('returns 400 for a malformed body', async () => {
			const res = await app.inject({
				method: 'POST',
				url: '/api/llm/copilot/auth/poll',
				payload: {}
			});

			expect(res.statusCode).toBe(400);
		});
	});

	describe('POST /api/llm/copilot/token', () => {
		it('exchanges a grant, sends the editor header set, and memoizes per grant', async () => {
			const expiresAt = Math.floor(Date.now() / 1000) + 1500;
			const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
				expect(String(url)).toBe(COPILOT_TOKEN_URL);
				const headers = lowerHeaders(init?.headers);
				expect(headers['authorization']).toBe('Bearer ghu_memo_grant');
				expect(headers['accept']).toBe('application/json');
				expect(headers['copilot-integration-id']).toBe('vscode-chat');
				expect(headers['editor-version']).toBe('vscode/1.98.0');
				expect(headers['x-github-api-version']).toBe('2025-05-01');
				return jsonResponse({
					token: 'tid=abc;exp=…;sku=…',
					expires_at: expiresAt,
					refresh_in: 1500,
					endpoints: { api: 'https://api.business.githubcopilot.com' },
					sku: 'copilot_business'
				});
			});
			vi.stubGlobal('fetch', fetchMock);

			const res1 = await exchange('ghu_memo_grant');

			expect(res1.statusCode).toBe(200);
			expect(res1.json()).toEqual({
				token: 'tid=abc;exp=…;sku=…',
				expiresAt,
				endpoint: 'https://api.business.githubcopilot.com',
				refreshInSeconds: 1500
			});

			const res2 = await exchange('ghu_memo_grant');

			expect(res2.statusCode).toBe(200);
			expect(res2.json()).toEqual(res1.json());
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it('eagerly refreshes when the cached session is within 120s of expiry', async () => {
			const soon = Math.floor(Date.now() / 1000) + 90;
			const later = Math.floor(Date.now() / 1000) + 1800;
			const fetchMock = vi.fn(async () => jsonResponse({ token: 'tid=eager', expires_at: soon }));
			vi.stubGlobal('fetch', fetchMock);

			const first = await exchange('ghu_eager_grant');
			expect(first.statusCode).toBe(200);
			expect(first.json().expiresAt).toBe(soon);

			fetchMock.mockImplementation(async () =>
				jsonResponse({ token: 'tid=eager2', expires_at: later })
			);
			const second = await exchange('ghu_eager_grant');

			expect(second.statusCode).toBe(200);
			expect(second.json().token).toBe('tid=eager2');
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it('coalesces concurrent token requests into a single upstream exchange', async () => {
			let releaseUpstream!: (res: Response) => void;
			const gate = new Promise<Response>((resolve) => {
				releaseUpstream = resolve;
			});
			const fetchMock = vi.fn(() => gate);
			vi.stubGlobal('fetch', fetchMock);

			const first = exchange('ghu_flight_grant');
			const second = exchange('ghu_flight_grant');

			// Hold the upstream gate until both requests have reached the token
			// route, so the route's own in-flight handling is what keeps the
			// upstream exchange to a single call.
			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
			await new Promise((resolve) => setTimeout(resolve, 25));
			await new Promise((resolve) => setTimeout(resolve, 25));

			releaseUpstream(
				jsonResponse({
					token: 'tid=fly',
					expires_at: Math.floor(Date.now() / 1000) + 1800
				})
			);

			const [res1, res2] = await Promise.all([first, second]);

			expect(res1.statusCode).toBe(200);
			expect(res2.statusCode).toBe(200);
			expect(res2.json()).toEqual(res1.json());
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it('keys the cache per grant so a different grant exchanges again', async () => {
			const fetchMock = vi.fn(async () =>
				jsonResponse({ token: 'tid=keyed', expires_at: Math.floor(Date.now() / 1000) + 1800 })
			);
			vi.stubGlobal('fetch', fetchMock);

			const resA1 = await exchange('ghu_grant_a');
			const resA2 = await exchange('ghu_grant_a');
			const resB = await exchange('ghu_grant_b');

			expect(resA1.json()).toEqual(resA2.json());
			expect(resB.json().token).toBe('tid=keyed');
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it('falls back to the default endpoint host and refresh interval', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn(async () =>
					jsonResponse({
						token: 'tid=fallback',
						expires_at: Math.floor(Date.now() / 1000) + 1500
					})
				)
			);

			const res = await exchange('ghu_fallback_grant');

			expect(res.statusCode).toBe(200);
			expect(res.json().endpoint).toBe('https://api.githubcopilot.com');
			expect(res.json().refreshInSeconds).toBe(1500);
		});

		it('maps upstream 401 to grant_invalid', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => jsonResponse({ message: 'Bad credentials' }, 401))
			);

			const res = await exchange('ghu_revoked_grant');

			expect(res.statusCode).toBe(401);
			expect(res.json()).toEqual({ error: 'grant_invalid' });
		});

		it('maps upstream 403 to not_entitled', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn(async () =>
					jsonResponse({ message: 'User does not have a Copilot subscription' }, 403)
				)
			);

			const res = await exchange('ghu_unentitled_grant');

			expect(res.statusCode).toBe(403);
			expect(res.json()).toEqual({ error: 'not_entitled' });
		});

		it('maps upstream 404 to 502 upstream (client-id breakage)', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => jsonResponse({ message: 'Not Found' }, 404))
			);

			const res = await exchange('ghu_orphan_grant');

			expect(res.statusCode).toBe(502);
			const json = res.json();
			expect(json.error).toBe('upstream');
			expect(json.message).toBe('Copilot token exchange rejected the client (upstream 404)');
		});

		it('maps network failure to 502 upstream', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => {
					throw new Error('connection refused');
				})
			);

			const res = await exchange('ghu_offline_grant');

			expect(res.statusCode).toBe(502);
			const json = res.json();
			expect(json.error).toBe('upstream');
			expect(json.message).toBeDefined();
		});

		it('returns 400 when the githubToken is missing', async () => {
			const res = await app.inject({
				method: 'POST',
				url: '/api/llm/copilot/token',
				payload: {}
			});

			expect(res.statusCode).toBe(400);
		});
	});
});
