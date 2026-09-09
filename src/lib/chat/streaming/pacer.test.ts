import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPacer, DEFAULT_PACER_CONFIG, type Pacer } from './pacer';

function isSafeBoundary(raw: string, index: number): boolean {
	if (index <= 0 || index >= raw.length) return true;
	const word = /[A-Za-z0-9]/;
	return !word.test(raw[index - 1]!) || !word.test(raw[index]!);
}

function makePacer(config = {}): Pacer {
	return createPacer(isSafeBoundary, config);
}

const TICK = 80;
function step(pacer: Pacer, raw: string, ms = TICK): number {
	vi.advanceTimersByTime(ms);
	return pacer.tick(raw);
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('PacerConfig timing bands', () => {
	it('pins the initial constants within the contract bands', () => {
		expect(DEFAULT_PACER_CONFIG.tickMs).toBe(80);
		expect(DEFAULT_PACER_CONFIG.baseCps).toBeGreaterThanOrEqual(60);
		expect(DEFAULT_PACER_CONFIG.baseCps).toBeLessThanOrEqual(120);
		expect(DEFAULT_PACER_CONFIG.catchupPerSec).toBeGreaterThanOrEqual(2);
		expect(DEFAULT_PACER_CONFIG.catchupPerSec).toBeLessThanOrEqual(5);
		expect(DEFAULT_PACER_CONFIG.snapLookback).toBeGreaterThanOrEqual(8);
		expect(DEFAULT_PACER_CONFIG.snapLookback).toBeLessThanOrEqual(16);
		expect(DEFAULT_PACER_CONFIG.drainRampMs).toBeGreaterThanOrEqual(80);
		expect(DEFAULT_PACER_CONFIG.drainRampMs).toBeLessThanOrEqual(200);
		expect(DEFAULT_PACER_CONFIG.drainBudgetMs).toBeGreaterThanOrEqual(700);
		expect(DEFAULT_PACER_CONFIG.drainBudgetMs).toBeLessThanOrEqual(1200);
	});
});

describe('mode transitions', () => {
	it('walks idle → streaming → draining → flushed', () => {
		const pacer = makePacer();
		expect(pacer.mode).toBe('idle');
		const raw = 'Hello world ';
		pacer.onArrived(raw);
		expect(pacer.mode).toBe('streaming');
		step(pacer, raw);
		pacer.onStreamEnd();
		expect(pacer.mode).toBe('draining');
		for (let i = 0; i < 20 && pacer.mode !== 'flushed'; i++) step(pacer, raw);
		expect(pacer.mode).toBe('flushed');
	});

	it('finalize lands on the tick after the buffer empties at stream end', () => {
		const raw = 'done ';
		const pacer = makePacer();
		pacer.onArrived(raw);
		step(pacer, raw);
		pacer.onStreamEnd();
		expect(pacer.mode).toBe('draining');
		expect(step(pacer, raw)).toBe(raw.length);
		expect(pacer.mode).toBe('flushed');
	});

	it('reset discards all state and starts clean', () => {
		const pacer = makePacer();
		const raw = 'some text ';
		pacer.onArrived(raw);
		step(pacer, raw);
		pacer.onAbort();
		pacer.reset();
		expect(pacer.mode).toBe('idle');
		expect(pacer.tick('new ')).toBe(4);
		pacer.onArrived('new ');
		expect(pacer.mode).toBe('streaming');
	});
});

describe('word safety', () => {
	it('never releases a prefix ending mid-word and stays monotonic', () => {
		const raw = 'The quick brown fox jumps over the lazy dogs today';
		const pacer = makePacer();
		pacer.onArrived(raw);
		let released = 0;
		for (let i = 0; i < 40 && released < raw.length; i++) {
			const next = step(pacer, raw);
			expect(next).toBeGreaterThanOrEqual(released);
			const midWord =
				next < raw.length && /[A-Za-z0-9]/.test(raw[next - 1]!) && /[A-Za-z0-9]/.test(raw[next]!);
			expect(midWord).toBe(false);
			released = next;
		}
		expect(released).toBe(raw.length);
	});

	it('snaps back to a boundary and holds through words longer than the lookback window', () => {
		const raw = 'Aa ' + 'b'.repeat(30) + ' rest';
		const pacer = makePacer();
		pacer.onArrived(raw);
		expect(step(pacer, raw)).toBe(3);
		expect(step(pacer, raw)).toBe(3);
	});
});

describe('adaptive catch-up', () => {
	it('drains a large all-at-once backlog without dumping and within the lag window', () => {
		const raw = 'word '.repeat(200);
		const pacer = makePacer();
		pacer.onArrived(raw);
		let released = step(pacer, raw);
		expect(raw.length - released).toBeGreaterThan(0);
		for (let i = 0; i < 6; i++) released = step(pacer, raw);
		expect(raw.length - released).toBeLessThanOrEqual(300);
		for (let i = 0; i < 24 && released < raw.length; i++) released = step(pacer, raw);
		expect(released).toBe(raw.length);
		expect(pacer.mode).toBe('streaming');
	});

	it('holds nothing back when arrival trickles slower than the base rate', () => {
		const pacer = makePacer();
		let raw = '';
		for (const w of ['one ', 'two ', 'three ', 'four ']) {
			raw += w;
			pacer.onArrived(raw);
			expect(step(pacer, raw)).toBe(raw.length);
		}
	});
});

describe('eased drain', () => {
	it('ramps out the backlog within ~1s without a single-tick dump', () => {
		const raw = 'word '.repeat(60);
		const pacer = makePacer();
		pacer.onArrived(raw);
		step(pacer, raw);
		pacer.onStreamEnd();
		expect(pacer.mode).toBe('draining');
		const first = step(pacer, raw);
		expect(first).toBeLessThan(raw.length);
		let released = first;
		let ticks = 1;
		while (pacer.mode !== 'flushed' && ticks < 30) {
			released = step(pacer, raw);
			ticks++;
		}
		expect(pacer.mode).toBe('flushed');
		expect(released).toBe(raw.length);
		expect(ticks).toBeGreaterThan(2);
		expect(ticks * TICK).toBeLessThanOrEqual(1000);
	});
});

describe('abort fast-path', () => {
	it('flushes everything on abort from streaming, draining, and idle', () => {
		const streaming = makePacer();
		const partial = 'partial text ';
		streaming.onArrived(partial);
		step(streaming, partial);
		streaming.onAbort();
		expect(streaming.mode).toBe('flushed');
		expect(streaming.tick(partial)).toBe(partial.length);

		const draining = makePacer();
		const long = 'word '.repeat(50);
		draining.onArrived(long);
		step(draining, long);
		draining.onStreamEnd();
		draining.onAbort();
		expect(draining.tick(long)).toBe(long.length);

		const idle = makePacer();
		idle.onAbort();
		expect(idle.tick('abc def ')).toBe(8);
	});
});

describe('reset/shrink tolerance', () => {
	it('resets the release position when the raw buffer shrinks (critic clear)', () => {
		const pacer = makePacer();
		const raw = 'hello world ';
		pacer.onArrived(raw);
		expect(step(pacer, raw)).toBeGreaterThan(0);
		pacer.onArrived('');
		expect(() => step(pacer, '')).not.toThrow();
		expect(pacer.tick('')).toBe(0);
		expect(pacer.mode).toBe('streaming');
		const fresh = 'fresh start ';
		pacer.onArrived(fresh);
		const released = step(pacer, fresh);
		expect(released).toBeGreaterThan(0);
		expect(released).toBeLessThanOrEqual(fresh.length);
	});
});

describe('empty and whitespace deltas', () => {
	it('does not stutter and leaves the mode untouched', () => {
		const pacer = makePacer();
		pacer.onArrived('');
		expect(pacer.tick('')).toBe(0);
		expect(pacer.mode).toBe('idle');
		pacer.onArrived('word ');
		step(pacer, 'word ');
		pacer.onArrived('   ');
		const grown = step(pacer, 'word    ');
		expect(grown).toBeGreaterThan(5);
		expect(grown).toBeLessThanOrEqual(8);
		expect(step(pacer, 'word    ')).toBe(8);
		expect(pacer.mode).toBe('streaming');
	});
});

describe('injectable clock', () => {
	it('honors a custom now() source', () => {
		let t = 1000;
		const pacer = createPacer(isSafeBoundary, { now: () => t });
		const raw = 'aaaa bbbb ';
		pacer.onArrived(raw);
		t += 80;
		expect(pacer.tick(raw)).toBe(5);
	});
});
