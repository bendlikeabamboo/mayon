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
		environment: 'node'
	}
});
