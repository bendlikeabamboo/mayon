/// <reference types="vitest/config" />
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

import { defineConfig, loadEnv } from 'vite';

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

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');

	return {
		plugins: [tailwindcss(), sveltekit()],
		server: {
			host: true,
			proxy: {
				'/api': 'http://server:4319',
				'/ws': { target: 'http://server:4319', ws: true }
			}
		},
		worker: { format: 'es' },
		test: {
			include: ['src/**/*.{test,spec}.{js,ts}'],
			environment: 'node',
			testTimeout: 15_000,
			maxWorkers: envNumber(env, 'VITEST_MAX_WORKERS', 4),
			minWorkers: envNumber(env, 'VITEST_MIN_WORKERS', 1),
			fileParallelism: envBoolean(env, 'VITEST_FILE_PARALLELISM', true),
			pool: env.VITEST_POOL ?? 'threads'
		}
	};
});
