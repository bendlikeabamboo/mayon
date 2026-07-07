export function truncateResult(text: string, capBytes: number): string {
	if (new TextEncoder().encode(text).length <= capBytes) return text;
	const encoder = new TextEncoder();
	let end = text.length;
	while (end > 0 && encoder.encode(text.slice(0, end)).length > capBytes) end--;
	return text.slice(0, end) + '\n…[truncated]';
}

export function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const abortHandler = () => {
		if (timer) clearTimeout(timer);
	};

	const wrapped = new Promise<T>((resolve, reject) => {
		const onTimeout = () => {
			reject(new Error('timed out'));
		};
		timer = setTimeout(onTimeout, ms);
		promise.then(
			(v) => {
				if (timer) clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				if (timer) clearTimeout(timer);
				reject(e);
			}
		);
	});

	if (signal) {
		if (signal.aborted) {
			return Promise.reject(new DOMException('Aborted', 'AbortError'));
		}
		return Promise.race([
			wrapped,
			new Promise<never>((_resolve, reject) => {
				signal.addEventListener(
					'abort',
					() => {
						reject(new DOMException('Aborted', 'AbortError'));
					},
					{ once: true }
				);
			})
		]).finally(() => {
			signal.removeEventListener('abort', abortHandler);
		});
	}

	return wrapped;
}
