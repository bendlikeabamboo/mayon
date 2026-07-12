import type { DbRuntime } from '$lib/stores/db.svelte.js';

export function runtimeLabel(r: DbRuntime): string {
	switch (r) {
		case 'browser':
			return 'Web';
		case 'memory':
			return 'Web';
		case 'unknown':
			return '';
		default:
			return '';
	}
}
