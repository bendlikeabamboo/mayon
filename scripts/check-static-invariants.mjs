#!/usr/bin/env node
// Named static invariants promoted from retired source-text tests
// (specs/032-test-suite-tiering/migration-ledger.md: `#perf-marks`,
// `#render-instrumentation`, `#visibility-sentinel`). Dependency-free and fast:
// each check reads the real source file, and a failure names the file plus the
// invariant. Usage: node scripts/check-static-invariants.mjs [root]

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const root = process.argv[2] ?? repoRoot;

const checks = [
	{
		id: 'perf-marks',
		files: ['src/lib/stores/chat.svelte.ts'],
		verify(source, file) {
			if (!/mark\(\s*'pacing:flush'\s*,/.test(source)) {
				return `${file}: paced flush is not wrapped in mark('pacing:flush', ...)`;
			}
			if (!source.includes("incRender('Pacer')")) {
				return `${file}: paced flush no longer reports incRender('Pacer')`;
			}
			return null;
		}
	},
	{
		id: 'render-instrumentation',
		files: ['src/lib/components/chat/MessageList.svelte'],
		dirs: ['src/lib/components/chat/rows'],
		verify(source, file) {
			if (!/<LazyMount\b[^>]*rootMargin=["']1200px["']/s.test(source)) {
				return `${file}: LazyMount is not passed rootMargin="1200px"`;
			}
			return null;
		},
		verifyDir(dirFiles, dir) {
			const found = dirFiles.some(({ source }) =>
				/onMount\(\s*\(\)\s*=>\s*incRender\('TimelineRow'\)\s*\)/.test(source)
			);
			return found ? null : `${dir}: no row renderer calls incRender('TimelineRow') in onMount`;
		}
	},
	{
		id: 'visibility-sentinel',
		files: ['src/routes/chat/[id]/+page.svelte'],
		verify(source, file) {
			if (!source.includes('IntersectionObserver')) {
				return `${file}: chat page no longer uses IntersectionObserver`;
			}
			if (source.includes('updateVisibility')) {
				return `${file}: chat page reintroduced the updateVisibility scroll path`;
			}
			if (source.includes('onScroll')) {
				return `${file}: chat page reintroduced a scroll-tied onScroll layout read`;
			}
			return null;
		}
	}
];

const failures = [];
let scanned = 0;

function readSource(path) {
	try {
		scanned++;
		return readFileSync(path, 'utf8');
	} catch {
		return null;
	}
}

for (const check of checks) {
	for (const relative of check.files) {
		const path = join(root, relative);
		const source = readSource(path);
		if (source === null) {
			failures.push(`${check.id} ${relative}: file is missing`);
			continue;
		}
		const message = check.verify(source, relative);
		if (message) {
			failures.push(`${check.id} ${message}`);
		}
	}
	for (const relative of check.dirs ?? []) {
		const dir = join(root, relative);
		let names;
		try {
			names = readdirSync(dir)
				.filter((name) => name.endsWith('.svelte'))
				.sort();
		} catch {
			failures.push(`${check.id} ${relative}: directory is missing`);
			continue;
		}
		const dirFiles = names.map((name) => ({
			name,
			source: readSource(join(dir, name))
		}));
		if (dirFiles.some(({ source }) => source === null)) {
			failures.push(`${check.id} ${relative}: a row renderer could not be read`);
			continue;
		}
		const message = check.verifyDir?.(dirFiles, relative);
		if (message) {
			failures.push(`${check.id} ${message}`);
		}
	}
}

if (failures.length > 0) {
	for (const failure of failures.sort()) {
		console.error(`[static-invariants] FAIL ${failure}`);
	}
	process.exit(1);
}

console.log(`[static-invariants] ok (${checks.length} invariants, ${scanned} files)`);
