import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopilotAuthRequiredError, CopilotSubscriptionError, NetworkError } from './types';
import { getCopilotSession, invalidateCopilotSession } from './copilot-session';

const TOKEN_URL = '/api/llm/copilot/token';

function tokenResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

/** A descriptor that goes stale `expiresInMs` from now. */
function descriptor(expiresInMs = 10 * 60 * 1000) {
	return {
		token: 'tid=abc;exp=123;sku=copilot_chat',
		expiresAt: Date.now() + expiresInMs,
		endpoint: 'https://api.githubcopilot.com',
		refreshInSeconds: 1500
	};
}

describe('getCopilotSession', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		invalidateCopilotSession('p1');
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('POSTs the grant to /api/llm/copilot/token and returns the descriptor', async () => {
		const want = descriptor();
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(tokenResponse(want));

		const got = await getCopilotSession('p1', 'ghu_test');

		expect(got).toEqual(want);
		expect(globalThis.fetch).toHaveBeenCalledOnce();
		const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toBe(TOKEN_URL);
		expect((init as RequestInit).method).toBe('POST');
		expect(JSON.parse((init as RequestInit).body as string)).toEqual({ githubToken: 'ghu_test' });
	});

	it('reuses the cached descriptor for a second call (one fetch)', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(tokenResponse(descriptor()));

		const first = await getCopilotSession('p1', 'ghu_test');
		const second = await getCopilotSession('p1', 'ghu_test');

		expect(second).toEqual(first);
		expect(globalThis.fetch).toHaveBeenCalledOnce();
	});

	it('re-fetches when the cached descriptor is stale (inside the staleness buffer)', async () => {
		const stale = descriptor(30 * 1000);
		const fresh = descriptor();
		(globalThis.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(tokenResponse(stale))
			.mockResolvedValueOnce(tokenResponse(fresh));

		await getCopilotSession('p1', 'ghu_test');
		const second = await getCopilotSession('p1', 'ghu_test');

		expect(second).toEqual(fresh);
		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
	});

	it('re-fetches when the descriptor is 119s from expiry (120s staleness buffer)', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(tokenResponse(descriptor(119 * 1000)))
			.mockResolvedValueOnce(tokenResponse(descriptor()));

		await getCopilotSession('p1', 'ghu_test');
		await getCopilotSession('p1', 'ghu_test');

		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
	});

	it('reuses the descriptor when it is 121s from expiry (outside the buffer)', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			tokenResponse(descriptor(121 * 1000))
		);

		const first = await getCopilotSession('p1', 'ghu_test');
		const second = await getCopilotSession('p1', 'ghu_test');

		expect(second).toEqual(first);
		expect(globalThis.fetch).toHaveBeenCalledOnce();
	});

	it('maps 401 grant_invalid to CopilotAuthRequiredError carrying the provider id', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			tokenResponse({ error: 'grant_invalid' }, 401)
		);

		const err = await getCopilotSession('p1', 'ghu_test').catch((e) => e);

		expect(err).toBeInstanceOf(CopilotAuthRequiredError);
		expect(err.providerId).toBe('p1');
	});

	it('maps 403 not_entitled to CopilotSubscriptionError', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			tokenResponse({ error: 'not_entitled' }, 403)
		);

		await expect(getCopilotSession('p1', 'ghu_test')).rejects.toBeInstanceOf(
			CopilotSubscriptionError
		);
	});

	it('maps 404 unknown_flow to CopilotAuthRequiredError (re-auth is the recovery)', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			tokenResponse({ error: 'unknown_flow' }, 404)
		);

		const err = await getCopilotSession('p1', 'ghu_test').catch((e) => e);

		expect(err).toBeInstanceOf(CopilotAuthRequiredError);
		expect(err.providerId).toBe('p1');
	});

	it('maps 502 upstream to NetworkError', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			tokenResponse({ error: 'upstream', message: 'github unreachable' }, 502)
		);

		await expect(getCopilotSession('p1', 'ghu_test')).rejects.toBeInstanceOf(NetworkError);
	});

	it('maps a network-level failure to NetworkError', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError('offline'));

		await expect(getCopilotSession('p1', 'ghu_test')).rejects.toBeInstanceOf(NetworkError);
	});

	it('drops the cached entry after grant_invalid (next call re-fetches)', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(tokenResponse(descriptor(30 * 1000)))
			.mockResolvedValueOnce(tokenResponse({ error: 'grant_invalid' }, 401))
			.mockResolvedValueOnce(tokenResponse(descriptor()));

		await getCopilotSession('p1', 'ghu_test');
		await expect(getCopilotSession('p1', 'ghu_test')).rejects.toBeInstanceOf(
			CopilotAuthRequiredError
		);
		await getCopilotSession('p1', 'ghu_test');

		expect(globalThis.fetch).toHaveBeenCalledTimes(3);
	});
});

describe('invalidateCopilotSession', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		invalidateCopilotSession('p1');
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('clears the cache entry so the next call fetches again', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(tokenResponse(descriptor()))
			.mockResolvedValueOnce(tokenResponse(descriptor()));

		await getCopilotSession('p1', 'ghu_test');
		invalidateCopilotSession('p1');
		await getCopilotSession('p1', 'ghu_test');

		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
	});

	it('is a no-op for an unknown provider id', () => {
		expect(() => invalidateCopilotSession('nope')).not.toThrow();
	});
});
