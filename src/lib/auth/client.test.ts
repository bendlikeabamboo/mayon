import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	AuthApiError,
	confirmSetup,
	enroll,
	fetchAuthSession,
	logoutRequest,
	startSetup
} from './client';

function stubFetch(handler: (path: string, init?: RequestInit) => Promise<Response>) {
	const mock = vi.fn(handler);
	vi.stubGlobal('fetch', mock);
	return mock;
}

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('auth client', () => {
	it('fetchAuthSession posts to /api/auth/session and parses the payload', async () => {
		const payload = {
			mode: 'open',
			setupRequired: true,
			authenticated: false,
			identity: null,
			session: null
		};
		const mock = stubFetch(async () => jsonResponse(payload));

		await expect(fetchAuthSession()).resolves.toEqual(payload);
		expect(mock).toHaveBeenCalledWith('/api/auth/session', expect.anything());
		const init = mock.mock.calls[0][1] as RequestInit;
		expect(init.method).toBe('POST');
		expect(init.body).toBe('{}');
	});

	it('startSetup posts label and password', async () => {
		const mock = stubFetch(async () => jsonResponse({ otpauthUri: 'otpauth://totp/x' }));

		await expect(startSetup({ label: 'owner', password: 'hunter2hunter2' })).resolves.toEqual({
			otpauthUri: 'otpauth://totp/x'
		});
		const init = mock.mock.calls[0][1] as RequestInit;
		expect(JSON.parse(init.body as string)).toEqual({
			label: 'owner',
			password: 'hunter2hunter2'
		});
	});

	it('confirmSetup maps a 400 {error} body to an AuthApiError', async () => {
		stubFetch(async () => jsonResponse({ error: 'invalid code' }, 400));

		const err = await confirmSetup('000000').catch((e: unknown) => e);
		expect(err).toBeInstanceOf(AuthApiError);
		const authErr = err as AuthApiError;
		expect(authErr.status).toBe(400);
		expect(authErr.code).toBe('invalid code');
		expect(authErr.message).toBe('invalid code');
	});

	it('startSetup surfaces the 409 setup-closed error', async () => {
		stubFetch(async () => jsonResponse({ error: 'setup closed' }, 409));

		const err = await startSetup({ label: 'a', password: 'longenough1' }).catch((e: unknown) => e);
		expect((err as AuthApiError).status).toBe(409);
		expect((err as AuthApiError).code).toBe('setup closed');
	});

	it('logoutRequest tolerates the 204 no-body response', async () => {
		const mock = stubFetch(async () => new Response(null, { status: 204 }));

		await expect(logoutRequest()).resolves.toBeUndefined();
		expect(mock).toHaveBeenCalledWith('/api/auth/logout', expect.anything());
	});

	it('enroll posts the code and parses the session result', async () => {
		const payload = {
			authenticated: true,
			identity: { label: 'alice', role: 'invitee' },
			session: { expiresAt: 1756828800000 }
		};
		const mock = stubFetch(async () => jsonResponse(payload));

		await expect(enroll('123456')).resolves.toEqual(payload);
		expect(mock).toHaveBeenCalledWith('/api/auth/enroll', expect.anything());
		const init = mock.mock.calls[0][1] as RequestInit;
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body as string)).toEqual({ code: '123456' });
	});

	it('enroll maps a 400 {error} body to a retryable AuthApiError', async () => {
		stubFetch(async () => jsonResponse({ error: 'invalid code' }, 400));

		const err = await enroll('000000').catch((e: unknown) => e);
		expect(err).toBeInstanceOf(AuthApiError);
		const authErr = err as AuthApiError;
		expect(authErr.status).toBe(400);
		expect(authErr.code).toBe('invalid code');
	});

	it('enroll maps a 401 {error} body to the expired error', async () => {
		stubFetch(async () => jsonResponse({ error: 'enrollment expired' }, 401));

		const err = await enroll('123456').catch((e: unknown) => e);
		expect(err).toBeInstanceOf(AuthApiError);
		const authErr = err as AuthApiError;
		expect(authErr.status).toBe(401);
		expect(authErr.code).toBe('enrollment expired');
	});
});
