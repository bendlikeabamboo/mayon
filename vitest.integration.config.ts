import adapterStatic from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		sveltekit({
			preprocess: vitePreprocess(),
			adapter: adapterStatic({
				fallback: 'index.html',
				precompress: false,
				strict: false
			})
		})
	],
	optimizeDeps: { rolldownOptions: { tsconfig: false } },
	ssr: { optimizeDeps: { rolldownOptions: { tsconfig: false } } },
	test: {
		name: 'integration',
		include: ['src/**/*.integration.test.ts'],
		environment: 'node',
		testTimeout: 60_000,
		passWithNoTests: true,
		maxWorkers: 1,
		fileParallelism: false,
		pool: 'forks',
		execArgv: ['--max-old-space-size=500']
	}
});
