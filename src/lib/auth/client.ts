import type {
	AuthSessionResponse,
	AuthSessionResult,
	LoginRequest,
	LoginResponse,
	SetupRequest,
	SetupResponse
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

async function postJson<T>(path: string, body: unknown = {}): Promise<T> {
	const res = await fetch(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
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
