/// <reference types="vitest/config" />
import adapterStatic from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
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

// kit.paths.base must be '' or '/…' (e.g. BASE_PATH=/mayon/ for GitHub Pages).
function basePathFromEnv(): '' | `/${string}` {
	const value = process.env.BASE_PATH;
	if (!value) return '';
	return value.startsWith('/') ? (value as `/${string}`) : `/${value}`;
}

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');

	return {
		plugins: [
			tailwindcss(),
			sveltekit({
				preprocess: vitePreprocess(),
				adapter: adapterStatic({
					fallback: 'index.html',
					precompress: false,
					strict: false
				}),
				paths: {
					base: basePathFromEnv()
				}
			})
		],
		server: {
			host: true,
			proxy: {
				'/api': {
					target: 'http://server:4319',
					changeOrigin: false,
					// The bundled proxy rewrites Host to the target regardless of
					// changeOrigin; forward the browser's host so the API gate's
					// same-origin check can verify it.
					configure: (proxy) => {
						proxy.on('proxyReq', (proxyReq, req) => {
							const host = req.headers['x-forwarded-host'] ?? req.headers.host;
							if (host) proxyReq.setHeader('x-forwarded-host', String(host));
						});
					}
				},
				'/ws': { target: 'http://server:4319', ws: true, changeOrigin: false }
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
