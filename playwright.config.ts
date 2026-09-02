import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/e2e',
	outputDir: 'test-results/',
	retries: 0,
	workers: 1,
	reporter: [['list']],
	timeout: 60_000,
	use: {
		// 127.0.0.1, not localhost: Node's DNS ordering can resolve localhost to
		// ::1, which the dev web container does not accept.
		baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173',
		trace: 'retain-on-failure'
	},
	projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]
});
