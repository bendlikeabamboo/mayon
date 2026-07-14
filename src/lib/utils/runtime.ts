import type { DbRuntime } from '$lib/stores/db.svelte.js';

export function runtimeLabel(r: DbRuntime): string {
	switch (r) {
		case 'pg':
			return 'Postgres';
		case 'unknown':
			return '';
		default:
			return '';
	}
}
