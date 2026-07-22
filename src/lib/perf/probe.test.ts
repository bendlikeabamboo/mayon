import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { _resetProbe, _startProbe } from './probe';
import { setPerfSink } from './mark';

if (typeof requestAnimationFrame === 'undefined') {
	globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
		setTimeout(() => cb(Date.now()), 16) as unknown as number;
	globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

describe('probe', () => {
	beforeEach(() => {
		_resetProbe();
		setPerfSink(null);
	});

	afterEach(() => {
		_resetProbe();
		setPerfSink(null);
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it('does not auto-start without the flag (module-level init is inert)', async () => {
		const mockObsCtor = vi.fn();
		const mockRaf = vi.spyOn(globalThis, 'requestAnimationFrame');
		const mockSetInterval = vi.spyOn(globalThis, 'setInterval');
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		vi.stubGlobal('window', { addEventListener: vi.fn() });
		vi.stubGlobal('PerformanceObserver', mockObsCtor);

		_startProbe();

		expect(mockObsCtor).not.toHaveBeenCalled();
		expect(mockRaf).toHaveBeenCalled();
		expect(mockSetInterval).toHaveBeenCalled();
		expect(consoleSpy).not.toHaveBeenCalled();
	});

	it('emits 7-section summary JSON when observers are supported', async () => {
		const mockWindow: Record<string, unknown> = { addEventListener: vi.fn() };
		vi.stubGlobal('window', mockWindow);

		let nowMs = 0;
		const perfNow = vi.fn(() => nowMs);
		vi.stubGlobal('performance', { now: perfNow });

		const mockObsCtor = vi.fn().mockImplementation((_opts: unknown) => ({
			observe: vi.fn(),
			disconnect: vi.fn()
		}));
		vi.stubGlobal(
			'PerformanceObserver',
			Object.assign(mockObsCtor, {
				supportedEntryTypes: ['longtask', 'layout-shift', 'event']
			})
		);

		vi.stubGlobal('localStorage', {
			getItem: (k: string) => (k === 'mayon_perf_scenario' ? 'idle-scroll' : null)
		});

		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		vi.useFakeTimers();

		_startProbe();

		expect(mockObsCtor).toHaveBeenCalledTimes(3);
		expect(consoleSpy).not.toHaveBeenCalled();

		nowMs = 3000;
		perfNow.mockReturnValue(nowMs);

		vi.advanceTimersByTime(3000);

		expect(consoleSpy).toHaveBeenCalled();
		const logArg = consoleSpy.mock.calls[0]![0] as string;
		expect(logArg).toContain('[mayon-perf]');

		const jsonStr = logArg.split('\n').slice(1).join('\n');
		const obj = JSON.parse(jsonStr);

		expect(obj).toHaveProperty('fps');
		expect(obj.fps).toHaveProperty('n');
		expect(obj.fps).toHaveProperty('avgMs');
		expect(obj.fps).toHaveProperty('p50');
		expect(obj.fps).toHaveProperty('p95');
		expect(obj.fps).toHaveProperty('p99');
		expect(obj.fps).toHaveProperty('max');
		expect(obj.fps).toHaveProperty('dropped');
		expect(obj).toHaveProperty('scenario');
		expect(obj.scenario).toBe('idle-scroll');
	});
});
