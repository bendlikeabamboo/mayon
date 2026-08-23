import { describe, expect, it, vi } from 'vitest';

vi.mock('ai', () => {
	class MockAPICallError extends Error {
		statusCode: number;
		responseBody?: string;
		responseHeaders?: Record<string, string>;
		constructor(
			message: string,
			options: {
				statusCode: number;
				responseBody?: string;
				responseHeaders?: Record<string, string>;
			}
		) {
			super(message);
			this.statusCode = options.statusCode;
			this.responseBody = options.responseBody;
			this.responseHeaders = options.responseHeaders;
		}
	}
	return {
		APICallError: MockAPICallError,
		generateObject: vi.fn(),
		generateText: vi.fn(),
		streamText: vi.fn()
	};
});

import { APICallError } from 'ai';
import { mapSdkError } from './sdk-errors';
import {
	CorsBlockedError,
	RateLimitError,
	ProviderHttpError,
	NetworkError,
	MissingKeyError
} from './types';

function makeApiCallError(
	statusCode: number,
	opts?: { responseBody?: string; responseHeaders?: Record<string, string> }
): APICallError {
	return new (APICallError as unknown as new (...args: unknown[]) => APICallError)('api error', {
		statusCode,
		...opts
	});
}

describe('mapSdkError', () => {
	it('maps APICallError 429 to RateLimitError', () => {
		const result = mapSdkError(makeApiCallError(429));
		expect(result).toBeInstanceOf(RateLimitError);
		expect((result as RateLimitError).retryAfter).toBeUndefined();
	});

	it('maps APICallError 429 with retry-after header to RateLimitError with retryAfter', () => {
		const result = mapSdkError(makeApiCallError(429, { responseHeaders: { 'retry-after': '30' } }));
		expect(result).toBeInstanceOf(RateLimitError);
		expect((result as RateLimitError).retryAfter).toBe(30);
	});

	it('maps APICallError 429 with non-numeric retry-after to RateLimitError without retryAfter', () => {
		const result = mapSdkError(
			makeApiCallError(429, { responseHeaders: { 'retry-after': 'soon' } })
		);
		expect(result).toBeInstanceOf(RateLimitError);
		expect((result as RateLimitError).retryAfter).toBeUndefined();
	});

	it('maps APICallError with non-429 statusCode to ProviderHttpError', () => {
		const result = mapSdkError(makeApiCallError(500, { responseBody: 'server error' }));
		expect(result).toBeInstanceOf(ProviderHttpError);
		expect((result as ProviderHttpError).status).toBe(500);
		expect((result as ProviderHttpError).body).toBe('server error');
	});

	it('maps APICallError 400 to ProviderHttpError with status 400', () => {
		const result = mapSdkError(makeApiCallError(400));
		expect(result).toBeInstanceOf(ProviderHttpError);
		expect((result as ProviderHttpError).status).toBe(400);
		expect((result as ProviderHttpError).body).toBeUndefined();
	});

	it('maps APICallError with statusCode 0 to ProviderHttpError', () => {
		const result = mapSdkError(makeApiCallError(0));
		expect(result).toBeInstanceOf(ProviderHttpError);
		expect((result as ProviderHttpError).status).toBe(0);
	});

	it('maps TypeError to CorsBlockedError', () => {
		const result = mapSdkError(new TypeError('Failed to fetch'));
		expect(result).toBeInstanceOf(CorsBlockedError);
	});

	it('passes through AbortError unchanged', () => {
		const err = new DOMException('Aborted', 'AbortError');
		const result = mapSdkError(err);
		expect(result).toBe(err);
	});

	it('passes typed provider errors through unchanged (custom-fetch seam throws)', () => {
		// A ProviderHttpError thrown by our custom fetch inside the SDK must keep
		// its classification; re-wrapping as NetworkError mislabels provider 4xx
		// responses as "Network error / check your connection".
		const httpErr = new ProviderHttpError(
			'Tool result is missing for tool call call_0.',
			400,
			'{...}'
		);
		expect(mapSdkError(httpErr)).toBe(httpErr);

		const rateErr = new RateLimitError(undefined, 30);
		expect(mapSdkError(rateErr)).toBe(rateErr);

		const corsErr = new CorsBlockedError();
		expect(mapSdkError(corsErr)).toBe(corsErr);

		const netErr = new NetworkError('offline');
		expect(mapSdkError(netErr)).toBe(netErr);

		const keyErr = new MissingKeyError();
		expect(mapSdkError(keyErr)).toBe(keyErr);
	});

	it('maps generic Error to NetworkError', () => {
		const err = new Error('something broke');
		const result = mapSdkError(err);
		expect(result).toBeInstanceOf(NetworkError);
		expect((result as NetworkError).cause).toBe(err);
		expect((result as NetworkError).message).toBe('something broke');
	});

	it('maps unknown type to NetworkError', () => {
		const result = mapSdkError('just a string');
		expect(result).toBeInstanceOf(NetworkError);
		expect((result as NetworkError).message).toBe('just a string');
	});

	it('maps null to NetworkError', () => {
		const result = mapSdkError(null);
		expect(result).toBeInstanceOf(NetworkError);
	});

	it('maps undefined to NetworkError', () => {
		const result = mapSdkError(undefined);
		expect(result).toBeInstanceOf(NetworkError);
	});
});
