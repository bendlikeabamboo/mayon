import type { AuthIdentityDTO, AuthMode, AuthSessionDTO, AuthSessionResponse } from '@mayon/shared';
import { fetchAuthSession, logoutRequest } from './client';

export const SETUP_DISMISS_KEY = 'mayon_setup_dismissed';

class AuthState {
	mode = $state<AuthMode>('open');
	setupRequired = $state(false);
	authenticated = $state(false);
	identity = $state<AuthIdentityDTO | null>(null);
	session = $state<AuthSessionDTO | null>(null);
	loaded = $state(false);

	apply(response: AuthSessionResponse) {
		this.mode = response.mode;
		this.setupRequired = response.setupRequired;
		this.authenticated = response.authenticated;
		this.identity = response.identity;
		this.session = response.session;
		this.loaded = true;
	}

	resetSession() {
		this.authenticated = false;
		this.identity = null;
		this.session = null;
	}
}

export const authState = new AuthState();

export async function refreshAuth(): Promise<AuthSessionResponse> {
	const response = await fetchAuthSession();
	authState.apply(response);
	return response;
}

export async function logout(): Promise<void> {
	try {
		await logoutRequest();
	} finally {
		authState.resetSession();
	}
}

export function isSetupDismissed(): boolean {
	try {
		return localStorage.getItem(SETUP_DISMISS_KEY) === '1';
	} catch {
		return false;
	}
}

export function dismissSetup(): void {
	localStorage.setItem(SETUP_DISMISS_KEY, '1');
}
