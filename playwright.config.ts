import { defineConfig } from '@playwright/test';

import { readCapacity, reportCapacity } from './scripts/test-capacity.mjs';
import { AUTH_STATE_FILE } from './tests/e2e/auth-state';

const capacity = reportCapacity(readCapacity());

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
	workers: capacity.workers,
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
			dependencies: ['setup'],
			fullyParallel: false,
			workers: 1,
			use: browserUse
		}
	]
});
