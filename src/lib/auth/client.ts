import type {
	AttemptsResponse,
	AuthSessionResponse,
	AuthSessionResult,
	InviteCreateResponse,
	InvitesResponse,
	LoginRequest,
	LoginResponse,
	SetupRequest,
	SetupResponse,
	SessionsResponse
} from '@mayon/shared';

export class AuthApiError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string) {
		super(code);
		this.name = 'AuthApiError';
		this.status = status;
		this.code = code;
	}
}

async function requestJson<T>(
	method: 'GET' | 'POST' | 'DELETE',
	path: string,
	body?: unknown
): Promise<T> {
	const res = await fetch(path, {
		method,
		headers: body === undefined ? undefined : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	if (!res.ok) {
		let code = 'request failed';
		try {
			const parsed = (await res.json()) as { error?: unknown };
			if (parsed && typeof parsed.error === 'string') code = parsed.error;
		} catch {
			// non-JSON error body — keep the generic code
		}
		throw new AuthApiError(res.status, code);
	}
	if (res.status === 204) return undefined as T;
	return (await res.json()) as T;
}

function postJson<T>(path: string, body: unknown = {}): Promise<T> {
	return requestJson<T>('POST', path, body);
}

export function fetchAuthSession(): Promise<AuthSessionResponse> {
	return postJson<AuthSessionResponse>('/api/auth/session');
}

export function startSetup(request: SetupRequest): Promise<SetupResponse> {
	return postJson<SetupResponse>('/api/auth/setup', request);
}

export function confirmSetup(code: string): Promise<AuthSessionResult> {
	return postJson<AuthSessionResult>('/api/auth/setup/confirm', { code });
}

export function login(request: LoginRequest): Promise<LoginResponse> {
	return postJson<LoginResponse>('/api/auth/login', request);
}

export function logoutRequest(): Promise<void> {
	return postJson<void>('/api/auth/logout');
}

export function listInvites(): Promise<InvitesResponse> {
	return requestJson<InvitesResponse>('GET', '/api/auth/invites');
}

export function createInvite(label: string): Promise<InviteCreateResponse> {
	return postJson<InviteCreateResponse>('/api/auth/invites', { label });
}

export function revokeInvite(id: string): Promise<void> {
	return requestJson<void>('DELETE', `/api/auth/invites/${id}`);
}

export function listSessions(): Promise<SessionsResponse> {
	return requestJson<SessionsResponse>('GET', '/api/auth/sessions');
}

export function revokeSessionById(id: string): Promise<void> {
	return requestJson<void>('DELETE', `/api/auth/sessions/${id}`);
}

export function revokeAllSessions(): Promise<void> {
	return postJson<void>('/api/auth/sessions/revoke-all');
}

export function listAttempts(limit = 50): Promise<AttemptsResponse> {
	return requestJson<AttemptsResponse>('GET', `/api/auth/attempts?limit=${limit}`);
}
