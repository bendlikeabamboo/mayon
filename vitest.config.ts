import { defineConfig } from 'vitest/config';

import { readCapacity, reportCapacity } from './scripts/test-capacity.mjs';

reportCapacity(readCapacity());

export default defineConfig({
	test: {
		// Browser files are still being migrated in; an empty browser project is
		// expected until US2 lands.
		passWithNoTests: true,
		projects: ['./vitest.unit.config.ts', './vitest.browser.config.ts']
	}
});
