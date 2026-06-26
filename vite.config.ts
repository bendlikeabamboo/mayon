/// <reference types="vitest/config" />
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type PluginOption } from 'vite';

/**
 * Inject cross-origin isolation headers on every dev/preview response —
 * including the top-level HTML document.
 *
 * sqlite-wasm's OPFS VFS needs `SharedArrayBuffer`, which the browser only
 * enables when `crossOriginIsolated` is true. That requires COOP/COEP headers
 * on the **top-level document**, not just subresources. Vite's `server.headers`
 * covers assets, but SvelteKit's page middleware serves the HTML and bypasses
 * them — so we also set the headers in `configureServer`/`configurePreviewServer`.
 *
 * `credentialless` (vs `require-corp`) lets cross-origin resources like KaTeX
 * web fonts load without per-resource CORP headers.
 */
const COOP = 'same-origin';
const COEP = 'credentialless';
function crossOriginIsolation(): PluginOption {
	const apply = (server: {
		middlewares: {
			use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void;
		};
	}) => {
		server.middlewares.use((_req, res, next) => {
			res.setHeader('Cross-Origin-Opener-Policy', COOP);
			res.setHeader('Cross-Origin-Embedder-Policy', COEP);
			next();
		});
	};
	return {
		name: 'cross-origin-isolation',
		configureServer: apply,
		configurePreviewServer: apply
	};
}

export default defineConfig({
	plugins: [tailwindcss(), crossOriginIsolation(), sveltekit()],
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
