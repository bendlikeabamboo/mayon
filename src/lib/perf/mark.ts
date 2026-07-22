export interface PerfSink {
	mark(label: string, ms: number): void;
	incRender(label: string): void;
}

let sink: PerfSink | null = null;

export function mark<T>(label: string, fn: () => T): T {
	if (sink) {
		const t0 = performance.now();
		const r = fn();
		sink.mark(label, performance.now() - t0);
		return r;
	}
	return fn();
}

export function incRender(label: string): void {
	sink?.incRender(label);
}

export function setPerfSink(s: PerfSink | null): void {
	sink = s;
}
