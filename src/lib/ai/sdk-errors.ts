import { APICallError } from 'ai';
import { CorsBlockedError, RateLimitError, ProviderHttpError, NetworkError } from './types';

export function mapSdkError(err: unknown): Error {
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
