/// <reference types="vitest/config" />
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		proxy: {
			'/api': 'http://localhost:4319',
			'/ws': { target: 'http://localhost:4319', ws: true }
		}
	},
	worker: { format: 'es' },
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
		environment: 'node',
		testTimeout: 15_000
	}
});
