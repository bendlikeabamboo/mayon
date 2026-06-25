/// <reference types="vitest/config" />
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// @sqlite.org/sqlite-wasm ships its own nested worker + .wasm assets and must
	// not be pre-bundled by esbuild (otherwise the wasm loader breaks in dev).
	optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
	worker: {
		format: 'es'
	},
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
		environment: 'node'
	}
});
