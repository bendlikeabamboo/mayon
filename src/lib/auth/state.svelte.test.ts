// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authState, dismissSetup, isSetupDismissed, logout, refreshAuth } from './state.svelte';

function stubSession(payload: unknown) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }))
	);
}

beforeEach(() => {
	vi.unstubAllGlobals();
	localStorage.clear();
	authState.mode = 'open';
	authState.setupRequired = false;
	authState.authenticated = false;
	authState.identity = null;
	authState.session = null;
	authState.loaded = false;
});

describe('refreshAuth', () => {
	it('populates auth state from POST /api/auth/session', async () => {
		stubSession({
			mode: 'locked',
			setupRequired: false,
			authenticated: true,
			identity: { label: 'owner', role: 'owner' },
			session: { expiresAt: 1756740000000 }
		});

		await refreshAuth();

		expect(authState.mode).toBe('locked');
		expect(authState.setupRequired).toBe(false);
		expect(authState.authenticated).toBe(true);
		expect(authState.identity).toEqual({ label: 'owner', role: 'owner' });
		expect(authState.session).toEqual({ expiresAt: 1756740000000 });
		expect(authState.loaded).toBe(true);
	});

	it('flags a fresh open deployment as offering setup', async () => {
		stubSession({
			mode: 'open',
			setupRequired: true,
			authenticated: false,
			identity: null,
			session: null
		});

		await refreshAuth();

		expect(authState.mode).toBe('open');
		expect(authState.setupRequired).toBe(true);
		expect(authState.loaded).toBe(true);
	});

	it('rejects and leaves state unloaded when the server is unreachable', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('network down');
			})
		);

		await expect(refreshAuth()).rejects.toThrow();
		expect(authState.loaded).toBe(false);
	});
});

describe('logout', () => {
	it('posts /api/auth/logout and resets session fields but keeps the mode', async () => {
		const mock = vi.fn(async () => new Response(null, { status: 204 }));
		vi.stubGlobal('fetch', mock);
		authState.mode = 'locked';
		authState.authenticated = true;
		authState.identity = { label: 'owner', role: 'owner' };
		authState.session = { expiresAt: 1756740000000 };

		await logout();

		expect(mock).toHaveBeenCalledWith('/api/auth/logout', expect.anything());
		expect(authState.authenticated).toBe(false);
		expect(authState.identity).toBeNull();
		expect(authState.session).toBeNull();
		expect(authState.mode).toBe('locked');
	});
});

describe('setup dismissal', () => {
	it('persists the skip flag in localStorage', () => {
		expect(isSetupDismissed()).toBe(false);
		dismissSetup();
		expect(localStorage.getItem('mayon_setup_dismissed')).toBe('1');
		expect(isSetupDismissed()).toBe(true);
	});
});
