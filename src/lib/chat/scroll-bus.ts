let listener: (() => void) | null = null;
const callbacks = new Set<() => void>();
let activeTarget: EventTarget = window;

function dispatch() {
	for (const cb of callbacks) cb();
}

export function subscribeScroll(cb: () => void, target?: HTMLElement): () => void {
	if (target && target !== activeTarget) {
		if (listener) {
			activeTarget.removeEventListener('scroll', listener);
			listener = null;
		}
		activeTarget = target;
	}
	callbacks.add(cb);
	if (!listener) {
		listener = dispatch;
		activeTarget.addEventListener('scroll', listener, { passive: true });
	}
	return () => {
		callbacks.delete(cb);
		if (callbacks.size === 0 && listener) {
			activeTarget.removeEventListener('scroll', listener);
			listener = null;
			activeTarget = window;
		}
	};
}
