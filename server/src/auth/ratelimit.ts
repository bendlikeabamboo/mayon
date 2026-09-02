import type { AuthStore } from './store';

export const DEFAULT_RATE_WINDOW_MS = 600_000;
export const DEFAULT_LADDER_BASE = 2;

const LADDER_START_FAILURES = 4;
const DELAY_CAP_SECONDS = 60;
const LOCKOUT_FAILURES = 10;

export type RateLimitVerdict = { ok: true; delayMs: number } | { ok: false; retryAfterMs: number };

export interface RateLimiterOptions {
	windowMs?: number;
	ladderBase?: number;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
}

export interface RateLimiter {
	check(source: string): Promise<RateLimitVerdict>;
	delayMsFor(failures: number): number;
	sleep(ms: number): Promise<void>;
}

export function createRateLimiter(store: AuthStore, opts: RateLimiterOptions = {}): RateLimiter {
	const windowMs = opts.windowMs ?? DEFAULT_RATE_WINDOW_MS;
	const ladderBase = opts.ladderBase ?? DEFAULT_LADDER_BASE;
	const now = opts.now ?? Date.now;
	const sleep = opts.sleep ?? defaultSleep;

	function delayMsFor(failures: number): number {
		if (failures <= LADDER_START_FAILURES) {
			return 0;
		}
		const seconds = Math.min(ladderBase ** (failures - LADDER_START_FAILURES), DELAY_CAP_SECONDS);
		return seconds * 1000;
	}

	return {
		delayMsFor,
		sleep,
		async check(source) {
			const since = now() - windowMs;
			const failures = await store.countRecentFailures(source, since);
			const ordinal = failures + 1;
			if (ordinal >= LOCKOUT_FAILURES) {
				const oldest = await store.oldestRecentFailureAt(source, since);
				const retryAfterMs = oldest === null ? windowMs : Math.max(1, oldest + windowMs - now());
				return { ok: false, retryAfterMs };
			}
			return { ok: true, delayMs: delayMsFor(ordinal) };
		}
	};
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
