import { describe, expect, it } from 'vitest';
import {
	asImageUnsupported,
	formatProviderError,
	httpStatusToError,
	SERVER_REQUIRED_HINT
} from './errors';
import {
	CopilotAuthRequiredError,
	CopilotSubscriptionError,
	CorsBlockedError,
	ImageUnsupportedError,
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

	it('maps CopilotAuthRequiredError with the reconnect hint', () => {
		const out = formatProviderError(new CopilotAuthRequiredError(undefined, 'copilot-1'));
		expect(out.title).toBe('Reconnect GitHub');
		expect(out.hint).toMatch(/Reconnect from Settings/);
	});

	it('maps CopilotSubscriptionError as a distinct no-reauth message', () => {
		const out = formatProviderError(new CopilotSubscriptionError());
		expect(out.title).toBe('No Copilot subscription');
		expect(out.message).toMatch(/subscription/);
		expect(out.hint).toMatch(/no active Copilot subscription/);
	});

	it('maps RateLimitError, including a retry-after hint when present', () => {
		const out = formatProviderError(new RateLimitError(undefined, 30));
		expect(out.title).toBe('Rate limited');
		expect(out.hint).toMatch(/30s/);
	});

	it('maps RateLimitError without a retry hint to the generic wait hint', () => {
		const out = formatProviderError(new RateLimitError());
		expect(out.title).toBe('Rate limited');
		expect(out.hint).toMatch(/Wait/);
	});

	it('maps CorsBlockedError with the desktop-fallback hint', () => {
		const out = formatProviderError(new CorsBlockedError());
		expect(out.title).toBe('Blocked by the browser');
		expect(out.hint).toBe(SERVER_REQUIRED_HINT);
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

describe('formatProviderError: ImageUnsupportedError', () => {
	it('names the model and points at removing the attachment or switching models', () => {
		const out = formatProviderError(new ImageUnsupportedError(undefined, 'deepseek-chat'));
		expect(out.title).toBe('Images not supported');
		expect(out.message).toMatch(/deepseek-chat doesn't accept images/);
		expect(out.hint).toMatch(/Remove the attachment/);
		expect(out.hint).toMatch(/vision-capable/);
	});

	it('falls back to a generic model mention when no modelId is set', () => {
		const out = formatProviderError(new ImageUnsupportedError());
		expect(out.title).toBe('Images not supported');
		expect(out.message).toMatch(/model doesn't accept images/);
		expect(out.hint).toMatch(/Remove the attachment/);
	});
});

describe('asImageUnsupported', () => {
	it('refines a provider 4xx into ImageUnsupportedError on an image-bearing request', () => {
		const refined = asImageUnsupported(
			new ProviderHttpError('image input rejected', 400, '{"error":"image not supported"}'),
			'deepseek-chat',
			'p1'
		);
		expect(refined).toBeInstanceOf(ImageUnsupportedError);
		const typed = refined as ImageUnsupportedError;
		expect(typed.modelId).toBe('deepseek-chat');
		expect(typed.providerId).toBe('p1');

		const out = formatProviderError(refined);
		expect(out.title).toBe('Images not supported');
		expect(out.message).toMatch(/deepseek-chat doesn't accept images/);
		expect(out.hint).toMatch(/Remove the attachment/);
	});

	it('refines a 4xx without a modelId to the generic message', () => {
		const refined = asImageUnsupported(new ProviderHttpError('bad', 422));
		expect(refined).toBeInstanceOf(ImageUnsupportedError);
		expect(formatProviderError(refined).message).toMatch(/model doesn't accept images/);
	});

	it('leaves 5xx, 429, and non-HTTP errors unchanged', () => {
		const serverErr = new ProviderHttpError('boom', 503, 'unavailable');
		expect(asImageUnsupported(serverErr)).toBe(serverErr);

		const rateErr = new RateLimitError();
		expect(asImageUnsupported(rateErr)).toBe(rateErr);

		const netErr = new NetworkError('offline');
		expect(asImageUnsupported(netErr)).toBe(netErr);
	});

	it('keeps an already-typed ImageUnsupportedError intact', () => {
		const direct = new ImageUnsupportedError(undefined, 'kimi-k3');
		const refined = asImageUnsupported(direct, 'gpt-4o');
		expect(refined).toBe(direct);
		expect((refined as ImageUnsupportedError).modelId).toBe('kimi-k3');
	});

	it('classifies provider 400 on an image-bearing request end-to-end: httpStatusToError → asImageUnsupported → formatProviderError', async () => {
		const res = new Response('{"error":{"message":"image input not supported"}}', { status: 400 });
		const mapped = await httpStatusToError(res);
		expect(mapped).toBeInstanceOf(ProviderHttpError);

		const refined = asImageUnsupported(mapped, 'gpt-3.5-turbo');
		expect(refined).toBeInstanceOf(ImageUnsupportedError);

		const out = formatProviderError(refined);
		expect(out.title).toBe('Images not supported');
		expect(out.message).toMatch(/gpt-3.5-turbo doesn't accept images/);
		expect(out.hint).toMatch(/Remove the attachment/);
	});
});
