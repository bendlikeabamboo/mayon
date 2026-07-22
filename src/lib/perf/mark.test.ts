import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mark, incRender, setPerfSink, type PerfSink } from './mark';

describe('mark', () => {
	beforeEach(() => {
		setPerfSink(null);
	});

	afterEach(() => {
		setPerfSink(null);
	});

	it('returns fn value unchanged when no sink', () => {
		expect(mark('test', () => 42)).toBe(42);
	});

	it('does not call performance.now when no sink', () => {
		const spy = vi.spyOn(performance, 'now').mockImplementation(() => {
			throw new Error('should not be called');
		});
		try {
			expect(mark('test', () => 'ok')).toBe('ok');
		} finally {
			spy.mockRestore();
		}
	});

	it('returns fn value and calls sink.mark when sink is set', () => {
		const sink: PerfSink = {
			mark: vi.fn(),
			incRender: vi.fn()
		};
		setPerfSink(sink);

		const spy = vi.spyOn(performance, 'now').mockReturnValue(0);
		try {
			expect(mark('foo', () => 'result')).toBe('result');
			expect(sink.mark).toHaveBeenCalledOnce();
			expect(sink.mark).toHaveBeenCalledWith('foo', expect.any(Number));
			const ms = (sink.mark as ReturnType<typeof vi.fn>).mock.calls[0]![1] as number;
			expect(ms).toBeGreaterThanOrEqual(0);
		} finally {
			spy.mockRestore();
		}
	});
});

describe('incRender', () => {
	beforeEach(() => {
		setPerfSink(null);
	});

	afterEach(() => {
		setPerfSink(null);
	});

	it('is a no-op when no sink', () => {
		incRender('anything');
	});

	it('calls sink.incRender when sink is set', () => {
		const sink: PerfSink = {
			mark: vi.fn(),
			incRender: vi.fn()
		};
		setPerfSink(sink);
		incRender('MessageRow');
		expect(sink.incRender).toHaveBeenCalledOnce();
		expect(sink.incRender).toHaveBeenCalledWith('MessageRow');
	});
});
