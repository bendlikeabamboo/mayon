import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectServer } from './detect';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.useRealTimers();
});

describe('detectServer', () => {
	it('returns HealthResponse on 200 with ok:true', async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ ok: true, version: '0.0.1', caps: [] }), { status: 200 })
			);
		const result = await detectServer();
		expect(result).toEqual({ ok: true, version: '0.0.1', caps: [] });
	});

	it('returns null on 500', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(new Response('err', { status: 500 }));
		expect(await detectServer()).toBeNull();
	});

	it('returns null on 404', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
		expect(await detectServer()).toBeNull();
	});

	it('returns null on network error', async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
		expect(await detectServer()).toBeNull();
	});

	it('returns null on timeout', async () => {
		vi.useFakeTimers();
		globalThis.fetch = vi.fn().mockImplementation(
			() =>
				new Promise<never>((_resolve, reject) => {
					vi.advanceTimersByTime(2000);
					reject(new DOMException('The operation was aborted', 'AbortError'));
				})
		);
		const p = detectServer();
		vi.advanceTimersByTime(2000);
		expect(await p).toBeNull();
	});

	it('never throws', async () => {
		const errors: unknown[] = [];
		globalThis.fetch = vi.fn().mockImplementation(() => {
			throw new Error('unexpected sync throw');
		});
		try {
			await detectServer();
		} catch (e) {
			errors.push(e);
		}
		expect(errors).toHaveLength(0);
	});
});
