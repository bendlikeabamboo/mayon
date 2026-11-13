import { defineConfig } from '@playwright/test';

import { readCapacity, reportCapacity } from './scripts/test-capacity.mjs';
import { AUTH_STATE_FILE } from './tests/e2e/auth-state';

const capacity = reportCapacity(readCapacity());

/** Explicit worker count override for CI's single-runner parallel suite. */
function readE2eWorkers(): number | null {
	const raw = process.env.MAYON_E2E_WORKERS;
	if (raw === undefined || raw === '') return null;
	const parsed = Number(raw.trim());
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`MAYON_E2E_WORKERS must be a positive integer, received '${raw}'`);
	}
	return parsed;
}

const e2eWorkers = readE2eWorkers();

/** Specs that intentionally mutate global provider settings. */
const SERIAL_SPEC = /.*\.serial\.spec\.ts$/;

const browserUse = {
	browserName: 'chromium' as const,
	storageState: AUTH_STATE_FILE
};

export default defineConfig({
	testDir: 'tests/e2e',
	outputDir: 'test-results/',
	retries: 0,
	// Capable hosts leave Playwright's worker count at its own default; only a
	// low-spec/unknown gate or an explicit MAYON_E2E_WORKERS forces a number.
	workers: e2eWorkers ?? capacity.workers ?? undefined,
	fullyParallel: capacity.fullyParallel,
	reporter: [['list']],
	timeout: 60_000,
	use: {
		// 127.0.0.1, not localhost: Node's DNS ordering can resolve localhost to
		// ::1, which the dev web container does not accept.
		baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173',
		trace: 'retain-on-failure'
	},
	projects: [
		{ name: 'setup', testMatch: /global-setup\.ts$/ },
		{
			name: 'chromium',
			testIgnore: SERIAL_SPEC,
			dependencies: ['setup'],
			use: browserUse
		},
		{
			// Specs that clear or rewrite global provider settings run alone so
			// they cannot race a parallel worker. Name them `*.serial.spec.ts`.
			name: 'serial',
			testMatch: SERIAL_SPEC,
			dependencies: ['setup', 'chromium'],
			fullyParallel: false,
			workers: 1,
			use: browserUse
		}
	]
});
