import { describe, it, expect } from 'vitest';
import { runtimeLabel } from './runtime';
import type { DbRuntime } from '$lib/stores/db.svelte.js';

describe('runtimeLabel', () => {
	const cases: Array<[DbRuntime, string]> = [
		['tauri', 'Desktop app'],
		['browser', 'Web'],
		['memory', 'Web'],
		['unknown', '']
	];

	it.each(cases)('maps %s → %s', (runtime, expected) => {
		expect(runtimeLabel(runtime)).toBe(expected);
	});
});
