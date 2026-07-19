import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectServer, waitForServerPg } from './detect';

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

describe('waitForServerPg', () => {
	it('returns health when pg cap arrives on attempt N < attempts', async () => {
		let callCount = 0;
		globalThis.fetch = vi.fn().mockImplementation(() => {
			callCount++;
			if (callCount < 2) {
				return Promise.resolve(
					new Response(JSON.stringify({ ok: true, version: '0.0.1', caps: [] }), { status: 200 })
				);
			}
			return Promise.resolve(
				new Response(JSON.stringify({ ok: true, version: '0.0.1', caps: ['pg'] }), { status: 200 })
			);
		});
		const result = await waitForServerPg({ attempts: 5, delayMs: 1 });
		expect(result).toEqual({ ok: true, version: '0.0.1', caps: ['pg'] });
		expect(callCount).toBe(2);
	});

	it('returns null when responses never include pg within attempts', async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ ok: true, version: '0.0.1', caps: [] }), { status: 200 })
			);
		const result = await waitForServerPg({ attempts: 2, delayMs: 1 });
		expect(result).toBeNull();
	});

	it('returns null when fetch always rejects (server down)', async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
		const result = await waitForServerPg({ attempts: 2, delayMs: 1 });
		expect(result).toBeNull();
	});
});
