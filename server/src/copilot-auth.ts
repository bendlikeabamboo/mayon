import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import type { CopilotTokenResponse } from '@mayon/shared';

const GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const GITHUB_SCOPE = 'read:user';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const DEFAULT_COPILOT_ENDPOINT = 'https://api.githubcopilot.com';
const DEFAULT_REFRESH_SECONDS = 1500;

interface CopilotAuthFlow {
	flowId: string;
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	expiresAt: number;
	interval: number;
	status: 'pending' | 'complete' | 'expired' | 'denied' | 'gone';
}

const flows = new Map<string, CopilotAuthFlow>();
const sessionCache = new Map<string, CachedSession>();
const inFlight = new Map<string, Promise<CopilotTokenResponse>>();

interface CachedSession {
	response: CopilotTokenResponse;
	/** Ephemeral sessions are reused until this instant (ms epoch). */
	freshUntil: number;
}

/** Eager-refresh buffer: re-exchange this many seconds before `expiresAt`. */
const SESSION_REFRESH_BUFFER_SECONDS = 120;

class CopilotExchangeError extends Error {
	constructor(
		public readonly status: number,
		public readonly body: { error: string; message?: string }
	) {
		super(body.message ?? body.error);
	}
}

function upstreamMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function sessionCacheKey(githubToken: string): string {
	return createHash('sha256').update(githubToken).digest('hex');
}

async function exchangeSession(githubToken: string): Promise<CopilotTokenResponse> {
	let upstream: Response;
	try {
		upstream = await fetch(COPILOT_TOKEN_URL, {
			method: 'GET',
			headers: {
				authorization: `Bearer ${githubToken}`,
				accept: 'application/json',
				'Copilot-Integration-Id': 'vscode-chat',
				'Editor-Version': 'vscode/1.98.0',
				'x-github-api-version': '2025-05-01'
			}
		});
	} catch (err) {
		throw new CopilotExchangeError(502, {
			error: 'upstream',
			message: upstreamMessage(err)
		});
	}

	if (upstream.status === 401) {
		throw new CopilotExchangeError(401, { error: 'grant_invalid' });
	}
	if (upstream.status === 403) {
		throw new CopilotExchangeError(403, { error: 'not_entitled' });
	}
	if (upstream.status === 404) {
		throw new CopilotExchangeError(502, {
			error: 'upstream',
			message: 'Copilot token exchange rejected the client (upstream 404)'
		});
	}
	if (!upstream.ok) {
		throw new CopilotExchangeError(502, {
			error: 'upstream',
			message: `Copilot token exchange failed (upstream ${upstream.status})`
		});
	}

	const data = (await upstream.json()) as {
		token?: unknown;
		expires_at?: unknown;
		refresh_in?: unknown;
		endpoints?: { api?: unknown };
	};
	if (typeof data.token !== 'string' || data.token.length === 0) {
		throw new CopilotExchangeError(502, {
			error: 'upstream',
			message: 'Copilot token exchange response was malformed'
		});
	}

	const refreshInSeconds =
		typeof data.refresh_in === 'number' && data.refresh_in > 0
			? data.refresh_in
			: DEFAULT_REFRESH_SECONDS;
	const expiresAt =
		typeof data.expires_at === 'number' && data.expires_at > 0
			? data.expires_at
			: Math.floor(Date.now() / 1000) + refreshInSeconds;
	return {
		token: data.token,
		expiresAt,
		endpoint:
			typeof data.endpoints?.api === 'string' && data.endpoints.api.length > 0
				? data.endpoints.api
				: DEFAULT_COPILOT_ENDPOINT,
		refreshInSeconds
	};
}

function purgeExpiredFlows(): void {
	const nowSeconds = Math.floor(Date.now() / 1000);
	for (const [flowId, flow] of flows) {
		if (flow.expiresAt <= nowSeconds) {
			flows.delete(flowId);
		}
	}
}

async function postForm(url: string, params: URLSearchParams): Promise<Response | null> {
	try {
		return await fetch(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				accept: 'application/json'
			},
			body: params
		});
	} catch {
		return null;
	}
}

export function registerCopilotAuth(app: FastifyInstance): void {
	app.post('/api/llm/copilot/auth/start', async (_req, reply) => {
		purgeExpiredFlows();

		const upstream = await postForm(
			DEVICE_CODE_URL,
			new URLSearchParams({ client_id: GITHUB_CLIENT_ID, scope: GITHUB_SCOPE })
		);
		if (!upstream || !upstream.ok) {
			const detail = upstream
				? `GitHub device-code request failed (upstream ${upstream.status})`
				: 'GitHub device-code request failed';
			reply.code(502).send({ error: 'upstream', message: detail });
			return;
		}

		const data = (await upstream.json()) as {
			device_code?: string;
			user_code?: string;
			verification_uri?: string;
			expires_in?: number;
			interval?: number;
		};
		if (!data.device_code || !data.user_code) {
			reply
				.code(502)
				.send({ error: 'upstream', message: 'GitHub device-code response was malformed' });
			return;
		}

		const flow: CopilotAuthFlow = {
			flowId: randomUUID(),
			deviceCode: data.device_code,
			userCode: data.user_code,
			verificationUri: data.verification_uri ?? 'https://github.com/login/device',
			expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in ?? 900),
			interval: data.interval ?? 5,
			status: 'pending'
		};
		flows.set(flow.flowId, flow);

		reply.send({
			flowId: flow.flowId,
			userCode: flow.userCode,
			verificationUri: flow.verificationUri,
			expiresAt: flow.expiresAt,
			interval: flow.interval
		});
	});

	app.post('/api/llm/copilot/auth/poll', async (req, reply) => {
		const body = req.body as { flowId?: unknown } | null;
		if (!body || typeof body.flowId !== 'string' || body.flowId.length === 0) {
			reply.code(400).send({ error: 'bad_request' });
			return;
		}

		const flow = flows.get(body.flowId);
		if (!flow) {
			reply.code(404).send({ error: 'unknown_flow' });
			return;
		}

		const nowSeconds = Math.floor(Date.now() / 1000);
		if (flow.expiresAt <= nowSeconds) {
			flows.delete(flow.flowId);
			reply.send({ status: 'expired' });
			return;
		}

		const upstream = await postForm(
			ACCESS_TOKEN_URL,
			new URLSearchParams({
				client_id: GITHUB_CLIENT_ID,
				device_code: flow.deviceCode,
				grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
			})
		);
		if (!upstream) {
			reply.send({ status: 'pending' });
			return;
		}

		const data = (await upstream.json()) as {
			error?: string;
			interval?: number;
			access_token?: string;
		};

		switch (data.error) {
			case 'authorization_pending':
				reply.send({ status: 'pending' });
				return;
			case 'slow_down': {
				const slowDownAfter = data.interval ?? flow.interval + 5;
				flow.interval = slowDownAfter;
				reply.send({ status: 'pending', slowDownAfter });
				return;
			}
			case 'expired_token':
				flows.delete(flow.flowId);
				reply.send({ status: 'expired' });
				return;
			case 'access_denied':
				flows.delete(flow.flowId);
				reply.send({ status: 'denied' });
				return;
		}

		if (!data.access_token) {
			reply.send({ status: 'pending' });
			return;
		}

		const githubToken = data.access_token;
		let login: string | undefined;
		try {
			const userRes = await fetch(GITHUB_USER_URL, {
				headers: {
					authorization: `Bearer ${githubToken}`,
					accept: 'application/vnd.github+json'
				}
			});
			if (userRes.ok) {
				const user = (await userRes.json()) as { login?: unknown };
				if (typeof user.login === 'string' && user.login.length > 0) {
					login = user.login;
				}
			}
		} catch {
			login = undefined;
		}

		flows.delete(flow.flowId);
		reply.send({
			status: 'complete',
			githubToken,
			...(login ? { user: { login } } : {})
		});
	});

	app.post('/api/llm/copilot/token', async (req, reply) => {
		const body = req.body as { githubToken?: unknown } | null;
		const githubToken = body?.githubToken;
		if (typeof githubToken !== 'string' || githubToken.length === 0) {
			reply.code(400).send({ error: 'bad_request' });
			return;
		}

		const key = sessionCacheKey(githubToken);
		const cached = sessionCache.get(key);
		if (cached && cached.freshUntil > Date.now()) {
			reply.send(cached.response);
			return;
		}

		let pending = inFlight.get(key);
		if (!pending) {
			pending = exchangeSession(githubToken).finally(() => inFlight.delete(key));
			inFlight.set(key, pending);
		}
		try {
			const response = await pending;
			sessionCache.set(key, {
				response,
				freshUntil: (response.expiresAt - SESSION_REFRESH_BUFFER_SECONDS) * 1000
			});
			reply.send(response);
		} catch (err) {
			if (err instanceof CopilotExchangeError) {
				reply.code(err.status).send(err.body);
				return;
			}
			reply.code(502).send({ error: 'upstream', message: upstreamMessage(err) });
		}
	});
}
