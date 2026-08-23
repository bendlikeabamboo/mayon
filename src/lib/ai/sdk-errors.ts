import { APICallError } from 'ai';
import {
	CorsBlockedError,
	RateLimitError,
	ProviderHttpError,
	NetworkError,
	MissingKeyError
} from './types';

export function mapSdkError(err: unknown): Error {
	// Our typed provider errors (thrown by the custom-fetch seam inside the SDK)
	// pass through unchanged so their classification — and the user-facing
	// title/hint from formatProviderError — survives the SDK boundary. Without
	// this, a ProviderHttpError(400) from the fetch seam would be re-wrapped as
	// NetworkError and mislabeled "Network error / check your connection".
	if (
		err instanceof ProviderHttpError ||
		err instanceof RateLimitError ||
		err instanceof CorsBlockedError ||
		err instanceof NetworkError ||
		err instanceof MissingKeyError
	) {
		return err;
	}

	if (err instanceof APICallError) {
		if (err.statusCode === 429) {
			const retryAfter = err.responseHeaders?.['retry-after'];
			const seconds = retryAfter ? Number(retryAfter) : undefined;
			return new RateLimitError(
				undefined,
				seconds != null && Number.isFinite(seconds) ? Math.round(seconds) : undefined
			);
		}
		return new ProviderHttpError(
			err.message || `Provider returned HTTP ${err.statusCode}`,
			err.statusCode ?? 0,
			err.responseBody ?? undefined
		);
	}

	if (err instanceof TypeError) {
		return new CorsBlockedError(undefined, undefined);
	}

	if (err instanceof Error && err.name === 'AbortError') return err;

	if (err instanceof Error) return new NetworkError(err.message, err);

	return new NetworkError(String(err));
}
