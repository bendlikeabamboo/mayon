import type { DbRuntime } from '$lib/stores/db.svelte.js';

export function runtimeLabel(r: DbRuntime): string {
	switch (r) {
		case 'tauri':
			return 'Desktop app';
		case 'browser':
			return 'Web';
		case 'memory':
			return 'Web';
		case 'unknown':
			return '';
	}
}
