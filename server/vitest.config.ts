import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { readCapacity, reportCapacity } from '../scripts/test-capacity.mjs';

const capacity = reportCapacity(readCapacity());

export default defineConfig({
	resolve: {
		alias: {
			'@mayon/schema': path.resolve(__dirname, '../src/lib/db/schema.ts')
		}
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		// PGlite/WASM bootstraps take ~5–6s per fresh instance under a
		// memory-capped test profile (low-spec wrapper) — above the 5s default.
		testTimeout: 15000,
		// Low-spec keeps one capped fork inside the ~500 MB heap budget. Capable
		// hosts omit maxWorkers so Vitest sizes its own pool, and run files in
		// parallel (each test file owns its own in-memory PGlite instance).
		...(capacity.workers === null ? {} : { maxWorkers: capacity.workers }),
		fileParallelism: capacity.fileParallelism,
		pool: 'forks',
		execArgv: ['--max-old-space-size=500']
	}
});
