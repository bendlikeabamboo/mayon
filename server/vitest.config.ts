import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
	resolve: {
		alias: {
			'@mayon/schema': path.resolve(__dirname, '../src/lib/db/schema.ts')
		}
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		// Server handler tests share pglite + Fastify; one capped fork keeps the
		// suite inside a ~500 MB heap budget on low-spec machines.
		maxWorkers: 1,
		fileParallelism: false,
		pool: 'forks',
		execArgv: ['--max-old-space-size=500']
	}
});
