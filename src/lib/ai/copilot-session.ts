/**
 * Browser-side in-memory cache of Copilot session descriptors, keyed by
 * provider id. A descriptor is minted by the companion server via
 * `POST /api/llm/copilot/token` (the grant itself comes from the KeyStore and
 * never leaves the origin except to that same-origin endpoint). Descriptors
 * are refreshed when stale and dropped when the server reports the grant is
 * no longer valid — re-auth (the device flow) is the recovery.
 *
 * Memory-only by design: a page reload re-mints once from the still-valid
 * grant (server-side memo makes that cheap).
 */
import type {
	CopilotErrorResponse,
	CopilotTokenRequest,
	CopilotTokenResponse
} from '@mayon/shared';
import { classifyFetchError } from './errors';
import { CopilotAuthRequiredError, CopilotSubscriptionError, NetworkError } from './types';

const TOKEN_ENDPOINT = '/api/llm/copilot/token';

/** Re-mint the descriptor this far before `expiresAt` (data-model.md CopilotSession). */
const STALE_BUFFER_MS = 120_000;

export interface CopilotSessionDescriptor {
	token: string;
	expiresAt: number;
	endpoint: string;
	refreshInSeconds: number;
}

const sessions = new Map<string, CopilotSessionDescriptor>();

/**
 * Return a fresh session descriptor for `providerId`, using the cache when it
 * still has `STALE_BUFFER_MS` of life left. Throws the typed provider errors
 * from the D4 error families on exchange failure.
 */
export async function getCopilotSession(
	providerId: string,
	githubToken: string,
	signal?: AbortSignal
): Promise<CopilotSessionDescriptor> {
	const cached = sessions.get(providerId);
	if (cached && Date.now() < cached.expiresAt - STALE_BUFFER_MS) return cached;

	let res: Response;
	try {
		res = await fetch(TOKEN_ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ githubToken } satisfies CopilotTokenRequest),
			signal
		});
	} catch (err) {
		throw classifyFetchError(err, TOKEN_ENDPOINT);
	}

	if (!res.ok) {
		const code = await readErrorCode(res);
		sessions.delete(providerId);
		if (code === 'not_entitled' || res.status === 403) throw new CopilotSubscriptionError();
		if (code === 'grant_invalid' || code === 'unknown_flow') {
			throw new CopilotAuthRequiredError(undefined, providerId);
		}
		if (res.status === 401 || res.status === 404) {
			throw new CopilotAuthRequiredError(undefined, providerId);
		}
		throw new NetworkError('Could not refresh the Copilot session token.');
	}

	const data = (await res.json()) as CopilotTokenResponse;
	const descriptor: CopilotSessionDescriptor = {
		token: data.token,
		expiresAt: data.expiresAt,
		endpoint: data.endpoint,
		refreshInSeconds: data.refreshInSeconds
	};
	sessions.set(providerId, descriptor);
	return descriptor;
}

/** Forget the cached descriptor for `providerId` (no-op if absent). */
export function invalidateCopilotSession(providerId: string): void {
	sessions.delete(providerId);
}

async function readErrorCode(res: Response): Promise<string | null> {
	try {
		const body = (await res.json()) as CopilotErrorResponse;
		return typeof body?.error === 'string' ? body.error : null;
	} catch {
		return null;
	}
}
