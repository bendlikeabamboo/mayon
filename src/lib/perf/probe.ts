import { setPerfSink, type PerfSink } from './mark.js';

const SUMMARY_INTERVAL_MS = 3000;

interface FrameAccum {
	deltas: number[];
	last: number;
}
interface MarkAccum {
	[label: string]: { n: number; totalMs: number; maxMs: number };
}
interface RenderAccum {
	[label: string]: { n: number };
}
interface InputAccum {
	[label: string]: { durations: number[] };
}
interface LongtaskAccum {
	'50-100': number;
	'100-250': number;
	'250+': number;
	topAttribution: string;
}
interface ClsAccum {
	score: number;
	entries: number;
}

let started = false;

export function _resetProbe(): void {
	started = false;
	setPerfSink(null);
}

export function _startProbe(): void {
	start();
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = (p / 100) * (sorted.length - 1);
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sorted[lo]!;
	const frac = idx - lo;
	return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

function summary(
	frames: FrameAccum,
	lt: LongtaskAccum,
	cls: ClsAccum,
	input: InputAccum,
	marks: MarkAccum,
	renders: RenderAccum,
	elapsed: number,
	scenario: string | null
): void {
	const deltas = frames.deltas;
	const sorted = [...deltas].sort((a, b) => a - b);
	const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)]! : 0;
	const threshold = median * 1.5;
	const dropped = deltas.filter((d) => d > threshold).length;

	const fpsBlock: Record<string, unknown> = {
		n: deltas.length,
		avgMs: deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0,
		p50: percentile(sorted, 50),
		p95: percentile(sorted, 95),
		p99: percentile(sorted, 99),
		max: sorted.length > 0 ? sorted[sorted.length - 1]! : 0,
		dropped
	};

	const inputBlock: Record<string, unknown> = {};
	for (const [name, acc] of Object.entries(input)) {
		if (acc.durations.length === 0) continue;
		const s = [...acc.durations].sort((a, b) => a - b);
		const entry: Record<string, unknown> = { n: acc.durations.length, p50Ms: percentile(s, 50) };
		if (s.length >= 2) entry.p95Ms = percentile(s, 95);
		inputBlock[name] = entry;
	}

	const marksBlock: Record<string, unknown> = {};
	for (const [label, acc] of Object.entries(marks)) {
		if (acc.n === 0) continue;
		marksBlock[label] = { n: acc.n, totalMs: acc.totalMs, maxMs: acc.maxMs };
	}

	const rendersBlock: Record<string, unknown> = {};
	for (const [label, acc] of Object.entries(renders)) {
		rendersBlock[label] = { n: acc.n };
	}

	const obj: Record<string, unknown> = { fps: fpsBlock };

	if (lt['50-100'] || lt['100-250'] || lt['250+'] || lt.topAttribution) {
		obj.longtask = { ...lt };
	}
	if (cls.entries > 0) {
		obj.cls = cls;
	}
	if (Object.keys(inputBlock).length > 0) {
		obj.inputLatency = inputBlock;
	}
	if (Object.keys(marksBlock).length > 0) {
		obj.marks = marksBlock;
	}
	if (Object.keys(rendersBlock).length > 0) {
		obj.renders = rendersBlock;
	}
	if (scenario) {
		obj.scenario = scenario;
	}

	console.log('[mayon-perf] t=' + elapsed.toFixed(1) + 's\n' + JSON.stringify(obj, null, 1));
}

function supportsEntryType(type: string): boolean {
	return (
		typeof PerformanceObserver !== 'undefined' &&
		PerformanceObserver.supportedEntryTypes?.includes(type) === true
	);
}

function start(): void {
	if (started) return;
	started = true;

	const frames: FrameAccum = { deltas: [], last: 0 };
	const lt: LongtaskAccum = { '50-100': 0, '100-250': 0, '250+': 0, topAttribution: '' };
	const cls: ClsAccum = { score: 0, entries: 0 };
	const input: InputAccum = {};
	const marks: MarkAccum = {};
	const renders: RenderAccum = {};

	const sink: PerfSink = {
		mark(label, ms) {
			if (!marks[label]) marks[label] = { n: 0, totalMs: 0, maxMs: 0 };
			marks[label]!.n++;
			marks[label]!.totalMs += ms;
			if (ms > marks[label]!.maxMs) marks[label]!.maxMs = ms;
		},
		incRender(label) {
			if (!renders[label]) renders[label] = { n: 0 };
			renders[label]!.n++;
		}
	};

	setPerfSink(sink);

	const observers: PerformanceObserver[] = [];
	let rafId = 0;
	const startTime = performance.now();

	try {
		if (supportsEntryType('longtask')) {
			const po = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					const duration = entry.duration;
					if (duration >= 250) {
						lt['250+']++;
					} else if (duration >= 100) {
						lt['100-250']++;
					} else if (duration >= 50) {
						lt['50-100']++;
					}
					const attr = (entry as unknown as { attribution?: { name?: string }[] }).attribution;
					if (attr && attr.length > 0 && attr[0]!.name) {
						lt.topAttribution = attr[0]!.name;
					}
				}
			});
			po.observe({ type: 'longtask', buffered: true });
			observers.push(po);
		}
	} catch {
		/* longtask not supported */
	}

	try {
		if (supportsEntryType('layout-shift')) {
			const po = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					const ls = entry as unknown as { hadRecentInput: boolean; value: number };
					if (!ls.hadRecentInput) {
						cls.score += ls.value;
						cls.entries++;
					}
				}
			});
			po.observe({ type: 'layout-shift', buffered: true });
			observers.push(po);
		}
	} catch {
		/* layout-shift not supported */
	}

	try {
		if (supportsEntryType('event')) {
			const po = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					const ev = entry as unknown as {
						name: string;
						startTime: number;
						processingStart: number;
					};
					if (ev.name !== 'pointermove' && ev.name !== 'wheel') continue;
					if (!input[ev.name]) input[ev.name] = { durations: [] };
					input[ev.name]!.durations.push(ev.processingStart - ev.startTime);
				}
			});
			po.observe({
				type: 'event',
				buffered: true,
				durationThreshold: 16
			} as PerformanceObserverInit);
			observers.push(po);
		}
	} catch {
		/* event not supported */
	}

	function frameLoop(now: number) {
		if (frames.last > 0) {
			frames.deltas.push(now - frames.last);
		}
		frames.last = now;
		rafId = requestAnimationFrame(frameLoop);
	}
	rafId = requestAnimationFrame(frameLoop);

	const intervalId = setInterval(() => {
		const now = performance.now();
		const elapsed = (now - startTime) / 1000;
		summary(frames, lt, cls, input, marks, renders, elapsed, scenario);

		frames.deltas = [];
		frames.last = 0;

		lt['50-100'] = 0;
		lt['100-250'] = 0;
		lt['250+'] = 0;
		lt.topAttribution = '';

		cls.score = 0;
		cls.entries = 0;

		for (const acc of Object.values(input)) {
			acc.durations = [];
		}

		for (const acc of Object.values(marks)) {
			acc.n = 0;
			acc.totalMs = 0;
			acc.maxMs = 0;
		}

		for (const acc of Object.values(renders)) {
			acc.n = 0;
		}
	}, SUMMARY_INTERVAL_MS);

	let scenario: string | null = null;
	try {
		scenario = localStorage.getItem('mayon_perf_scenario');
	} catch {
		/* storage unavailable */
	}

	window.addEventListener('pagehide', () => {
		cancelAnimationFrame(rafId);
		clearInterval(intervalId);
		for (const po of observers) {
			try {
				po.disconnect();
			} catch {
				/* already disconnected */
			}
		}
		setPerfSink(null);
		started = false;
	});
}

try {
	if (
		typeof window !== 'undefined' &&
		(window as unknown as Record<string, unknown>).__MAYON_PERF__ === 1
	) {
		start();
	}
} catch {
	/* non-browser env */
}
