import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm'],
	target: 'node22',
	dts: true,
	outDir: 'dist',
	tsconfig: './tsconfig.json',
	clean: true
});
