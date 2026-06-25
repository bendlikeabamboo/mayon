/**
 * Error mapping for the provider layer. The typed error classes themselves live
 * in `types.ts` (so adapters can throw without an import cycle). This module
 * owns: HTTP-response → typed-error classification, and the user-facing
 * `formatProviderError` formatter.
 *
 * Cross-cutting concern "never silent": every thrown provider error is surfaced
 * to the user through `formatProviderError`.
 */
import {
	CorsBlockedError,
	MissingKeyError,
	NetworkError,
	ProviderHttpError,
	RateLimitError
} from './types';

/** User-facing payload rendered by the UI error block. */
export interface FormattedProviderError {
	title: string;
	message: string;
	hint?: string;
}

/** Desktop-fallback copy reused for CORS / unsafe-browser errors. */
export const DESKTOP_FALLBACK_HINT =
	'Browser calls to this provider may be blocked by CORS. Use the Mayon desktop app, which routes requests through the native shell and avoids CORS entirely.';

/**
 * Map a thrown error to a user-facing payload. Unknown errors get a generic
 * treatment so nothing surfaces as a raw stack trace.
 */
export function formatProviderError(err: unknown): FormattedProviderError {
	if (err instanceof MissingKeyError) {
		return {
			title: 'Missing API key',
			message: err.message,
			hint: 'Add an API key for this provider in Settings.'
		};
	}
	if (err instanceof RateLimitError) {
		return {
			title: 'Rate limited',
			message: err.message,
			hint: err.retryAfter ? `Retry after ~${err.retryAfter}s.` : 'Wait a moment and try again.'
		};
	}
	if (err instanceof CorsBlockedError) {
		return {
			title: 'Blocked by the browser',
			message: err.message,
			hint: DESKTOP_FALLBACK_HINT
		};
	}
	if (err instanceof ProviderHttpError) {
		return {
			title: `Provider error (${err.status})`,
			message: err.body ?? err.message,
			hint: err.status >= 500 ? 'The provider is having trouble; retry shortly.' : undefined
		};
	}
	if (err instanceof NetworkError) {
		return {
			title: 'Network error',
			message: err.message,
			hint: 'Check your connection and that the provider base URL is reachable.'
		};
	}
	if (err instanceof DOMException && err.name === 'AbortError') {
		return { title: 'Stopped', message: 'The stream was cancelled.' };
	}
	return {
		title: 'Something went wrong',
		message: err instanceof Error ? err.message : String(err)
	};
}

/**
 * Classify a `fetch` failure (pre-stream, during the response handshake) into a
 * typed provider error. Adapters call this once they have a `Response` (or a
 * thrown fetch error) so the classification logic stays in one place.
 *
 * - Network-level throw with a TypeError is treated as CORS or offline. In the
 *   browser, a CORS failure surfaces as a TypeError with no response; we can't
 *   always distinguish it from a true offline, so we prefer `CorsBlockedError`
 *   when the URL is cross-origin (the desktop fallback hint applies either way).
 *   Aborted requests are re-thrown as-is (callers swallow AbortError).
 */
export function classifyFetchError(err: unknown, baseUrl: string): Error {
	// Aborted by the user — let it propagate; the UI treats AbortError specially.
	if (err instanceof DOMException && err.name === 'AbortError') return err;

	if (err instanceof TypeError) {
		// Browsers surface CORS + offline both as TypeError. Heuristic: if the
		// target is cross-origin, assume CORS (the actionable hint is the same
		// desktop fallback). Localhost / same-origin → NetworkError.
		if (isCrossOrigin(baseUrl)) {
			return new CorsBlockedError(undefined, undefined);
		}
		return new NetworkError('Network request failed (offline or unreachable).', err);
	}
	if (err instanceof Error) return new NetworkError(err.message, err);
	return new NetworkError(String(err));
}

/** True if `baseUrl` points at a different origin than the current page. */
function isCrossOrigin(baseUrl: string): boolean {
	if (typeof globalThis.location === 'undefined') return false;
	try {
		const target = new URL(baseUrl, globalThis.location.href);
		return target.origin !== globalThis.location.origin;
	} catch {
		return false;
	}
}

/**
 * Build the right typed error from a non-2xx `Response`. Reads the body once
 * (as text) so it can be echoed in the user-facing message. Status 429 →
 * `RateLimitError` (honoring `Retry-After`); other statuses → `ProviderHttpError`.
 */
export async function httpStatusToError(res: Response): Promise<Error> {
	let body = '';
	try {
		body = (await res.text()).trim();
	} catch {
		/* body stays empty */
	}

	if (res.status === 429) {
		const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
		return new RateLimitError(undefined, retryAfter);
	}

	return new ProviderHttpError(
		`Provider returned HTTP ${res.status}${body ? `: ${truncate(body, 500)}` : ''}`,
		res.status,
		body || undefined
	);
}

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) into seconds. */
function parseRetryAfter(value: string | null): number | undefined {
	if (!value) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds);
	const date = Date.parse(value);
	if (Number.isFinite(date)) return Math.max(0, Math.round((date - Date.now()) / 1000));
	return undefined;
}

function truncate(s: string, max: number): string {
	return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

// Re-export the classes so callers can `instanceof` from a single module.
export {
	CorsBlockedError,
	MissingKeyError,
	NetworkError,
	ProviderHttpError,
	RateLimitError
} from './types';
