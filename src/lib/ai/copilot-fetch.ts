/**
 * Session-aware fetch for the `github-copilot` provider kind. Per request it
 * reads the GitHub grant from the KeyStore (`MissingKeyError` when absent —
 * the pre-auth state), ensures a session descriptor via `copilot-session`,
 * injects the mandatory Copilot header set, retargets the request at the
 * authoritative endpoint host from the session, and delegates to `getLlmFetch`
 * so proxy routing, SSE pass-through, abort propagation, and typed-error
 * classification behave exactly like every other provider's fetch seam.
 */
import { getCopilotSession } from './copilot-session';
import { classifyFetchError, httpStatusToError } from './errors';
import { createBrowserKeyStore } from './keystore/browser';
import { MissingKeyError, type ProviderConfig } from './types';
import { getLlmFetch } from '$lib/services/llm-proxy-fetch';

/** Mandatory Copilot header set (single source of truth — shared with model discovery). */
export const COPILOT_HEADERS: Record<string, string> = {
	'Copilot-Integration-Id': 'vscode-chat',
	'Editor-Version': 'vscode/1.98.0',
	'Editor-Plugin-Version': 'copilot-chat/0.35.0',
	'User-Agent': 'GitHubCopilotChat/0.35.0',
	'x-github-api-version': '2025-05-01'
};

export function createCopilotFetch(config: ProviderConfig): typeof globalThis.fetch {
	const store = createBrowserKeyStore();
	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const grant = await store.get(config.id);
		if (!grant) throw new MissingKeyError(undefined, config.id);
		const session = await getCopilotSession(config.id, grant, init?.signal ?? undefined);

		const headers = new Headers(init?.headers);
		headers.set('Authorization', `Bearer ${session.token}`);
		for (const [header, value] of Object.entries(COPILOT_HEADERS)) {
			headers.set(header, value);
		}

		const target = resolveTarget(url, session.endpoint, config.baseUrl);
		let res: Response;
		try {
			res = await getLlmFetch()(target, { ...init, headers, cache: 'no-store' });
		} catch (err) {
			throw classifyFetchError(err, target);
		}
		if (!res.ok) throw await httpStatusToError(res);
		return res;
	};
}

/** Retarget `url` at the endpoint host (or `baseUrl` fallback), keeping path+query. */
function resolveTarget(url: string, endpoint: string, baseUrl: string): string {
	const source = new URL(url);
	const target = new URL(endpoint || baseUrl);
	target.pathname = source.pathname;
	target.search = source.search;
	return target.href;
}
