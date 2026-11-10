import {
	test as setup,
	expect,
	request as apiRequest,
	type APIRequestContext
} from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { AUTH_STATE_PATH } from './auth-state';
import { seedMockProvider } from './fixtures/seed';

const DEFAULT_BASE_URL = 'http://127.0.0.1:5173';
const SETUP_DISMISS_KEY = 'mayon_setup_dismissed';
const FORCE_RECAPTURE = process.env.MAYON_TEST_UPDATE_STATE === '1';

interface AuthSessionLike {
	mode: 'open' | 'locked';
	setupRequired: boolean;
	authenticated: boolean;
}

interface StorageStateLike {
	cookies?: Array<{ name: string }>;
	origins?: Array<{
		origin: string;
		localStorage?: Array<{ name: string; value: string } | [string, string]>;
	}>;
}

function endpoint(baseURL: string, path: string): string {
	return new URL(path, baseURL).toString();
}

function describeError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

async function assertServerReachable(request: APIRequestContext, baseURL: string): Promise<void> {
	let res;
	try {
		res = await request.get(endpoint(baseURL, '/api/health'), { timeout: 10_000 });
	} catch (err) {
		throw new Error(
			`e2e setup: server unreachable at ${baseURL} (${describeError(err)}). Start the dev stack first.`,
			{ cause: err }
		);
	}
	if (!res.ok()) {
		throw new Error(
			`e2e setup: /api/health returned ${res.status()} at ${baseURL} — the server is not ready.`
		);
	}
}

async function readAuthSession(
	request: APIRequestContext,
	baseURL: string
): Promise<AuthSessionLike> {
	const res = await request.post(endpoint(baseURL, '/api/auth/session'));
	if (!res.ok()) {
		throw new Error(`e2e setup: /api/auth/session returned ${res.status()} ${await res.text()}`);
	}
	return (await res.json()) as AuthSessionLike;
}

/**
 * A locked server needs the one-time login handshake before any DB write.
 * Credentials come from the environment; a missing pair fails loudly instead
 * of letting the seed silently 401.
 */
async function authenticateIfLocked(
	request: APIRequestContext,
	baseURL: string
): Promise<AuthSessionLike> {
	const session = await readAuthSession(request, baseURL);
	if (session.mode !== 'locked' || session.authenticated) return session;

	const password = process.env.MAYON_E2E_PASSWORD;
	const code = process.env.MAYON_E2E_CODE;
	const label = process.env.MAYON_E2E_LABEL;
	if (!password || !code) {
		throw new Error(
			'e2e setup: the server is locked and no session is available. Set MAYON_E2E_PASSWORD and MAYON_E2E_CODE (and optionally MAYON_E2E_LABEL) or run the stack in open mode.'
		);
	}

	const login = await request.post(endpoint(baseURL, '/api/auth/login'), {
		data: { password, code, ...(label ? { label } : {}) }
	});
	if (!login.ok()) {
		throw new Error(`e2e setup: login failed (${login.status()}) ${await login.text()}`);
	}
	const result = (await login.json()) as { status?: string };
	if (result.status === 'mfa_enrollment_required') {
		throw new Error(
			'e2e setup: this account still needs authenticator enrollment; enroll it before running the e2e suite.'
		);
	}

	const authenticated = await readAuthSession(request, baseURL);
	if (authenticated.mode === 'locked' && !authenticated.authenticated) {
		throw new Error('e2e setup: login reported success but the session is still unauthenticated.');
	}
	return authenticated;
}

async function readStorageState(file: string): Promise<StorageStateLike | null> {
	try {
		return JSON.parse(await readFile(file, 'utf8')) as StorageStateLike;
	} catch {
		return null;
	}
}

function hasSetupDismissal(state: StorageStateLike | null): boolean {
	return (
		state?.origins?.some((origin) =>
			origin.localStorage?.some((entry) => {
				const [key, value] = Array.isArray(entry) ? entry : [entry.name, entry.value];
				return key === SETUP_DISMISS_KEY && value === '1';
			})
		) ?? false
	);
}

/** The cached state is reusable when it carries the dismissal and a valid session. */
async function stateIsReusable(statePath: string, baseURL: string): Promise<boolean> {
	const state = await readStorageState(statePath);
	if (!hasSetupDismissal(state)) return false;

	const api = await apiRequest.newContext({ baseURL, storageState: statePath });
	try {
		const session = await readAuthSession(api, baseURL);
		return session.mode !== 'locked' || session.authenticated;
	} catch {
		return false;
	} finally {
		await api.dispose();
	}
}

async function seedWithStoredState(statePath: string, baseURL: string): Promise<void> {
	const api = await apiRequest.newContext({ baseURL, storageState: statePath });
	try {
		await assertServerReachable(api, baseURL);
		await authenticateIfLocked(api, baseURL);
		await seedMockProvider(api, baseURL);
	} finally {
		await api.dispose();
	}
}

setup('capture shared session state', async ({ page, context, baseURL }) => {
	const url = baseURL ?? DEFAULT_BASE_URL;
	const stateExists = existsSync(AUTH_STATE_PATH);
	const reusable = !FORCE_RECAPTURE && stateExists && (await stateIsReusable(AUTH_STATE_PATH, url));

	if (reusable) {
		// Still seed on every invocation so a fresh database gets the shared
		// provider even when the cached browser state is valid.
		await seedWithStoredState(AUTH_STATE_PATH, url);
		return;
	}

	// Capture path: use page.request so the login handshake's cookies land in
	// the browser context that is saved below.
	await assertServerReachable(page.request, url);
	await authenticateIfLocked(page.request, url);
	await seedMockProvider(page.request, url);

	await page.goto(endpoint(url, '/chat'));
	const skipSetup = page.getByRole('button', { name: 'Skip' });
	const appShell = page.getByRole('button', { name: 'New chat' });
	try {
		await expect(skipSetup.or(appShell)).toBeVisible({ timeout: 15_000 });
	} catch (err) {
		throw new Error(
			`e2e setup: /chat never reached the setup gate or app shell (${describeError(err)}).`,
			{ cause: err }
		);
	}
	if (await skipSetup.isVisible()) {
		await skipSetup.click();
	}
	await expect(appShell).toBeVisible({ timeout: 15_000 });

	await mkdir(path.dirname(AUTH_STATE_PATH), { recursive: true });
	await context.storageState({ path: AUTH_STATE_PATH });
});
