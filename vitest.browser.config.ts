import path from 'node:path';

import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineBrowserCommand, playwright, type CDPSession } from '@vitest/browser-playwright';
import { loadEnv } from 'vite';
import { configDefaults, defineProject } from 'vitest/config';

import { readCapacity } from './scripts/test-capacity.mjs';

function envOptionalNumber(env: Record<string, string>, name: string): number | null {
	const value = env[name];
	if (value === undefined || value === '') return null;
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

// Chromium-only media emulation for pointer/hover media features, which
// Playwright's `page.viewport` cannot change and `contextOptions.hasTouch`
// would apply to every test in the project. `coarse: null` restores defaults.
//
// Detaching a CDP session reverts its emulation, so the session that set the
// current state stays attached; the next call detaches it before replacing it.
const mediaGlobal = globalThis as typeof globalThis & {
	__mayonMediaSessions?: CDPSession[];
};
const mediaSessions = (mediaGlobal.__mayonMediaSessions ??= []);

const setPointerMedia = defineBrowserCommand(async ({ context, page }, coarse: boolean | null) => {
	for (const previous of mediaSessions.splice(0)) {
		await previous.detach().catch(() => {});
	}
	const session = await context.newCDPSession(page);
	mediaSessions.push(session);
	await session.send('Emulation.setTouchEmulationEnabled', {
		enabled: coarse === true,
		maxTouchPoints: coarse === true ? 5 : 1
	});
	await session.send('Emulation.setEmitTouchEventsForMouse', {
		enabled: coarse === true,
		configuration: 'mobile'
	});
	const features =
		coarse === null
			? []
			: coarse
				? [
						{ name: 'any-pointer', value: 'coarse' },
						{ name: 'pointer', value: 'coarse' },
						{ name: 'any-hover', value: 'none' },
						{ name: 'hover', value: 'none' }
					]
				: [
						{ name: 'any-pointer', value: 'fine' },
						{ name: 'pointer', value: 'fine' },
						{ name: 'any-hover', value: 'hover' },
						{ name: 'hover', value: 'hover' }
					];
	await session.send('Emulation.setEmulatedMedia', { features });
});

export default defineProject(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const capacity = readCapacity(env);
	const maxWorkers = envOptionalNumber(env, 'VITEST_MAX_WORKERS') ?? capacity.workers;

	return {
		plugins: [tailwindcss(), svelte({ preprocess: vitePreprocess() })],
		// SvelteKit owns `static/`; browser tests only need the MSW worker, which
		// lives in this test-only directory and never reaches `build/`.
		publicDir: 'tests/mocks/public',
		resolve: {
			alias: {
				$lib: path.resolve(__dirname, 'src/lib'),
				'$app/navigation': path.resolve(__dirname, 'tests/mocks/app/navigation.ts'),
				'$app/state': path.resolve(__dirname, 'tests/mocks/app/state.ts'),
				'$app/environment': path.resolve(__dirname, 'tests/mocks/app/environment.ts'),
				'$app/env': path.resolve(__dirname, 'tests/mocks/app/environment.ts')
			}
		},
		// Pre-bundle the component graph once. Without this, the first file to
		// touch bits-ui/lucide triggers a mid-run optimizer reload, which splits
		// module instances and breaks Svelte effects.
		optimizeDeps: {
			include: [
				'@lucide/svelte',
				'@lucide/svelte/icons/check',
				'@lucide/svelte/icons/chevron-right',
				'@lucide/svelte/icons/minus',
				'@lucide/svelte/icons/search',
				'@lucide/svelte/icons/x',
				'bits-ui',
				'clsx',
				'katex',
				'mermaid',
				'panzoom',
				'rehype-highlight',
				'rehype-katex',
				'rehype-sanitize',
				'rehype-stringify',
				'remark-gfm',
				'remark-math',
				'remark-parse',
				'remark-rehype',
				'tailwind-merge',
				'tailwind-variants',
				'unified'
			],
			rolldownOptions: { tsconfig: false }
		},
		ssr: { optimizeDeps: { rolldownOptions: { tsconfig: false } } },
		test: {
			name: 'browser',
			include: ['src/**/*.browser.test.ts'],
			exclude: [...configDefaults.exclude],
			testTimeout: 15_000,
			browser: {
				enabled: true,
				headless: true,
				provider: playwright(),
				instances: [{ browser: 'chromium' }],
				commands: { setPointerMedia }
			},
			// Capable hosts omit maxWorkers so Vitest sizes its own pool.
			...(maxWorkers === null ? {} : { maxWorkers }),
			fileParallelism: envBoolean(env, 'VITEST_FILE_PARALLELISM', capacity.fileParallelism),
			// Caps the Node-side worker; Chromium's own RSS is not bounded by this.
			execArgv: ['--max-old-space-size=500']
		}
	};
});
