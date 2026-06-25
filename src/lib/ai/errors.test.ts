import { describe, expect, it } from 'vitest';
import { formatProviderError, DESKTOP_FALLBACK_HINT } from './errors';
import {
	CorsBlockedError,
	MissingKeyError,
	NetworkError,
	ProviderHttpError,
	RateLimitError
} from './types';

describe('formatProviderError', () => {
	it('maps MissingKeyError with a settings hint', () => {
		const out = formatProviderError(new MissingKeyError());
		expect(out.title).toBe('Missing API key');
		expect(out.hint).toMatch(/Settings/);
	});

	it('maps RateLimitError, including a retry-after hint when present', () => {
		const out = formatProviderError(new RateLimitError(undefined, 30));
		expect(out.title).toBe('Rate limited');
		expect(out.hint).toMatch(/30s/);
	});

	it('maps CorsBlockedError with the desktop-fallback hint', () => {
		const out = formatProviderError(new CorsBlockedError());
		expect(out.title).toBe('Blocked by the browser');
		expect(out.hint).toBe(DESKTOP_FALLBACK_HINT);
	});

	it('maps ProviderHttpError with status + body, and a retry hint on 5xx', () => {
		const out4 = formatProviderError(new ProviderHttpError('bad', 400, 'bad request body'));
		expect(out4.title).toBe('Provider error (400)');
		expect(out4.message).toBe('bad request body');
		expect(out4.hint).toBeUndefined();

		const out5 = formatProviderError(new ProviderHttpError('boom', 503, 'unavailable'));
		expect(out5.hint).toMatch(/retry/);
	});

	it('maps NetworkError with a reachability hint', () => {
		const out = formatProviderError(new NetworkError());
		expect(out.title).toBe('Network error');
		expect(out.hint).toMatch(/connection|reachable/);
	});

	it('maps AbortError to a "Stopped" message (not an error block)', () => {
		const out = formatProviderError(new DOMException('cancelled', 'AbortError'));
		expect(out.title).toBe('Stopped');
		expect(out.message).toMatch(/cancel/);
	});

	it('maps unknown errors to a generic payload without leaking a raw stack', () => {
		const out = formatProviderError(new Error('boom'));
		expect(out.title).toBe('Something went wrong');
		expect(out.message).toBe('boom');

		const outStr = formatProviderError('weird');
		expect(outStr.message).toBe('weird');
	});
});
