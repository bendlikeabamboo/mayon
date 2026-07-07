import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const basePath = process.env.BASE_PATH || '';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		paths: {
			base: basePath
		},
		adapter: adapter({
			fallback: 'index.html',
			precompress: false,
			strict: false
		})
	}
};

export default config;
