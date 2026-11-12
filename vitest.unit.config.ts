import adapterStatic from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { loadEnv } from 'vite';
import { configDefaults, defineProject } from 'vitest/config';

import { readCapacity } from './scripts/test-capacity.mjs';

function envNumber(env: Record<string, string>, name: string, fallback: number) {
	const value = env[name];
	if (value === undefined || value === '') return fallback;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${name} must be a positive integer, received '${value}'`);
	}
	return parsed;
}

function envBoolean(env: Record<string, string>, name: string, fallback: boolean) {
	const value = env[name];
	if (value === undefined || value === '') return fallback;
	if (value === 'true') return true;
	if (value === 'false') return false;
	throw new Error(`${name} must be true or false, received '${value}'`);
}

export default defineProject(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const capacity = readCapacity(env);
	const heapMb = envNumber(
		process.env as Record<string, string>,
		'MAYON_TEST_MAX_OLD_SPACE_MB',
		500
	);
	const pool = env.VITEST_POOL ?? 'forks';

	return {
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
		// rolldown#11086: the dep optimizer's tsconfig walk-up breaks when any
		// ancestor tsconfig fails to load; deps never need this repo's tsconfig paths.
		optimizeDeps: { rolldownOptions: { tsconfig: false } },
		ssr: { optimizeDeps: { rolldownOptions: { tsconfig: false } } },
		test: {
			name: 'unit',
			include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
			exclude: [...configDefaults.exclude, '**/*.browser.test.ts', '**/*.integration.test.ts'],
			environment: 'node',
			testTimeout: 15_000,
			maxWorkers: envNumber(env, 'VITEST_MAX_WORKERS', capacity.workers),
			fileParallelism: envBoolean(env, 'VITEST_FILE_PARALLELISM', capacity.fileParallelism),
			pool,
			// Cap each test worker's V8 heap so a low-spec machine is not
			// OOM-killed by a runaway suite. Vitest 4 takes execArgv top-level.
			execArgv: [`--max-old-space-size=${heapMb}`]
		}
	};
});
