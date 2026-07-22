if (import.meta.env.DEV && typeof PerformanceObserver !== 'undefined') {
	const THRESHOLD_MS = 200;
	const OBSERVE_DURATION_MS = 10_000;

	let _warned = false;
	try {
		if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
			const po = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					if (entry.duration > THRESHOLD_MS) {
						console.warn(
							`[mayon-perf] Longtask ${entry.duration.toFixed(0)} ms — ` +
								'possible regression. Enable the perf probe ' +
								'(window.__MAYON_PERF__ = 1) for details.'
						);
						_warned = true;
					}
				}
			});
			po.observe({ type: 'longtask', buffered: true });
			setTimeout(() => {
				po.disconnect();
			}, OBSERVE_DURATION_MS);
		}
	} catch {
		/* longtask not supported */
	}
}
