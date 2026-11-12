import { test as base, type Route } from '@playwright/test';

/**
 * Third-party hosts that are never part of an app-critical path. They are
 * aborted rather than failed so tests stay deterministic without masking app
 * behavior (research R9). Anything external that is neither allowlisted nor
 * classified below fails loudly.
 */
const THIRD_PARTY_HOSTS =
	/(^|\.)(google-analytics\.com|googletagmanager\.com|doubleclick\.net|segment\.io|segment\.com|posthog\.com|plausible\.io|sentry\.io|hotjar\.com|clarity\.ms|fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|esm\.sh)$/i;

/** Asset types that may be dropped when they point at an external origin. */
const THIRD_PARTY_ASSET_TYPES = new Set(['font', 'image', 'media', 'stylesheet', 'script']);

/** Container-internal origins the app or its fixtures legitimately use. */
const ALLOWED_HOSTS = new Set(['mock-llm', 'server']);

/** Loopback origins: the app base URL and in-process test servers. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isAllowed(url: URL, appOrigin: string | undefined): boolean {
	if (url.protocol === 'data:' || url.protocol === 'blob:' || url.protocol === 'about:') {
		return true;
	}
	if (appOrigin !== undefined && url.origin === appOrigin) return true;
	if (ALLOWED_HOSTS.has(url.hostname)) return true;
	return LOOPBACK_HOSTS.has(url.hostname);
}

async function enforcePolicy(route: Route, appOrigin: string | undefined): Promise<void> {
	const request = route.request();
	const url = new URL(request.url());

	if (isAllowed(url, appOrigin)) {
		await route.continue();
		return;
	}

	if (THIRD_PARTY_HOSTS.test(url.hostname) || THIRD_PARTY_ASSET_TYPES.has(request.resourceType())) {
		await route.abort('blockedbyclient');
		return;
	}

	throw new Error(
		`e2e network policy: unclassified external request to ${url.origin}${url.pathname} (${request.method()}, ${request.resourceType()}). Add it to the allowlist or classify it as a third-party asset in tests/e2e/fixtures/network.ts.`
	);
}

/**
 * Auto-fixture: every spec that imports the session fixture (and therefore
 * this chain) gets the same network policy. MSW serves API routes in-process
 * before this policy applies in Tier 2; here same-origin `/api/*` is allowed.
 */
export const test = base.extend<{ networkPolicy: void }>({
	networkPolicy: [
		async ({ context, baseURL }, use) => {
			const appOrigin = baseURL ? new URL(baseURL).origin : undefined;
			await context.route('**/*', (route) => enforcePolicy(route, appOrigin));
			await use();
		},
		{ auto: true }
	]
});

export { expect } from '@playwright/test';
