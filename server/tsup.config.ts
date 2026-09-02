import { defineConfig } from 'tsup';

export default defineConfig({
	entry: {
		server: 'src/server.ts',
		'auth-cli': 'src/auth/cli.ts'
	},
	format: 'esm',
	target: 'node22',
	outDir: 'dist',
	clean: true
});
