/// <reference types="vitest/config" />
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

import { defineConfig } from 'vite';

export default defineConfig({
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
		maxWorkers: Number(process.env.VITEST_MAX_WORKERS ?? 4)
	}
});
