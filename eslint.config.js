import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default ts.config(
	{
		ignores: [
			'build/',
			'.svelte-kit/',
			'dist/',
			'src-tauri/',
			'drizzle/',
			'coverage/',
			// Generated: bundled migration SQL/journal — do not lint by hand.
			'src/lib/db/driver/migrations.ts'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		}
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: {
				parser: ts.parser
			}
		}
	},
	{
		files: ['**/*.svelte.ts'],
		languageOptions: {
			parser: ts.parser
		}
	},
	{
		rules: {
			// Optional type-safe routing; P0 uses plain hrefs.
			'svelte/no-navigation-without-resolve': 'off',
			// Allow intentionally-unused params/props prefixed with `_`.
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
			]
		}
	}
);
