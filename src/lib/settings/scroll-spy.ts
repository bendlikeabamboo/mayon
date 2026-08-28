export interface SpyEntry {
	id: string;
	isIntersecting: boolean;
	top: number;
	bandTop: number;
}

export function resolveActive(entries: readonly SpyEntry[], atBottom = false): string | null {
	if (atBottom && entries.length > 0) return entries[entries.length - 1].id;
	let active: string | null = null;
	let bestTop = Number.NEGATIVE_INFINITY;
	for (const entry of entries) {
		if (entry.top > entry.bandTop) continue;
		if (entry.top < bestTop) continue;
		bestTop = entry.top;
		active = entry.id;
	}
	return active;
}

export function entriesFromTops(
	ordered: readonly { id: string; top: number }[],
	bandTop: number
): SpyEntry[] {
	return ordered.map(({ id, top }) => ({ id, isIntersecting: true, top, bandTop }));
}

export interface ScrollSpy {
	observe(id: string, el: HTMLElement): void;
	unobserve(id: string): void;
	active(): string | null;
	refresh(): void;
	destroy(): void;
}

const BAND_ROOT_MARGIN = '-20% 0px -70% 0px';
const BAND_TOP_RATIO = 0.2;
const BOTTOM_EPSILON = 4;

export function createScrollSpy(
	root: HTMLElement,
	onActive: (id: string | null) => void
): ScrollSpy {
	const targets = new Map<Element, string>();
	const entries = new Map<string, SpyEntry>();
	let current: string | null = null;

	const evaluate = (live = false) => {
		let list = [...entries.values()];
		if (live) {
			const bandTop = root.getBoundingClientRect().top + root.clientHeight * BAND_TOP_RATIO;
			const tops: { id: string; top: number }[] = [];
			for (const [el, id] of targets) tops.push({ id, top: el.getBoundingClientRect().top });
			list = entriesFromTops(tops, bandTop);
		}
		const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - BOTTOM_EPSILON;
		const next = resolveActive(list, atBottom);
		if (next === current) return;
		current = next;
		onActive(next);
	};

	const observer = new IntersectionObserver(
		(records) => {
			for (const record of records) {
				const id = targets.get(record.target);
				if (id === undefined) continue;
				entries.set(id, {
					id,
					isIntersecting: record.isIntersecting,
					top: record.boundingClientRect.top,
					bandTop: record.rootBounds ? record.rootBounds.top : 0
				});
			}
			evaluate();
		},
		{ root, rootMargin: BAND_ROOT_MARGIN, threshold: 0 }
	);

	const evaluateListener = () => evaluate(true);
	root.addEventListener('scrollend', evaluateListener);

	return {
		observe(id: string, el: HTMLElement): void {
			targets.set(el, id);
			observer.observe(el);
		},
		unobserve(id: string): void {
			for (const [el, elId] of targets) {
				if (elId !== id) continue;
				targets.delete(el);
				observer.unobserve(el);
			}
			entries.delete(id);
			evaluate();
		},
		active(): string | null {
			return current;
		},
		refresh(): void {
			evaluate(true);
		},
		destroy(): void {
			root.removeEventListener('scrollend', evaluateListener);
			observer.disconnect();
			targets.clear();
			entries.clear();
			current = null;
		}
	};
}
