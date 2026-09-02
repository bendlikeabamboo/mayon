import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/e2e',
	outputDir: 'test-results/',
	retries: 0,
	workers: 1,
	reporter: [['list']],
	timeout: 60_000,
	use: {
		baseURL: 'http://localhost:5173',
		trace: 'retain-on-failure'
	},
	projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]
});
