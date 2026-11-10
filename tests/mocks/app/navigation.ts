// Minimal `$app/navigation` double for route-level browser tests.
// See specs/032-test-suite-tiering/research.md R4.

import { page } from './state';

export interface GotoOptions {
	replaceState?: boolean;
	keepFocus?: boolean;
	noScroll?: boolean;
	invalidateAll?: boolean;
}

export async function goto(url: string | URL, options: GotoOptions = {}): Promise<void> {
	const target = typeof url === 'string' ? new URL(url, page.url) : url;
	page.url = new URL(target, page.url);
	if (!options.keepFocus && typeof document !== 'undefined') {
		(document.activeElement as HTMLElement | null)?.blur?.();
	}
	if (!options.noScroll && typeof window !== 'undefined') {
		window.scrollTo(0, 0);
	}
}
