import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// ─── $lib/db boundary (specs/025-text-first-runtime/contracts/enforcement.md) ───
// R1: app tier imports the data tier only through the '$lib/db' façade, never a
// deep path (static, type-only, or export-from). R3: '#lib/db/**' never imports
// app modules. See docs/reference/seams + docs/reference/agent-map.
const r1Message =
	"Boundary violation (R1): app code must import only from '#lib/db/index.js' (the repository façade), never '#lib/db/<deep path>'. See docs/reference/seams + docs/reference/agent-map.";
const r3Message =
	"Boundary violation (R3): '#lib/db/**' must not import app modules (no upward imports). See docs/reference/seams + docs/reference/agent-map.";
// '#lib/db/*' catches one segment, '#lib/db/*/**' the rest: together every deep
// path matches while the '#lib/db/index.js' façade stays allowed (SvelteKit 3
// resolves the façade through the #lib subpath import, so the bare alias is gone).
const dbDeepPaths = ['#lib/db/*', '#lib/db/*/**', '!#lib/db/index.js'];
// db internals still read a few app-tier modules by design today (boot state,
// server transport, mcp types); each such file is baselined as an escape hatch
// below (R3 baseline stragglers) and migrates opportunistically when touched.
// Extend this list only together with the changes that empty each new area of db imports.
const appTierAreas = ['components', 'stores', 'services', 'ai', 'chat', 'mcp'].flatMap((area) => [
	`#lib/${area}`,
	`#lib/${area}/*`,
	`#lib/${area}/*/**`
]);

export default ts.config(
	{
		ignores: [
			'build/',
			'.svelte-kit/',
			'dist/',
			'drizzle/',
			'coverage/',
			'.kilo/',
			'docs/',
			'tests/fixtures/',
			'specs/**/donors/',
			'server/dist/',
			'packages/*/dist/'
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
	},
	// R1 — app tier: only the '$lib/db' façade, never a deep path. Sanctioned
	// tooling (**/*.test.ts, tests/**) is exempt; the typescript-eslint variant of
	// the rule also flags `import type` deep imports and `export ... from` re-exports.
	{
		files: ['src/**'],
		ignores: ['src/lib/db/**', '**/*.test.ts'],
		rules: {
			'@typescript-eslint/no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: dbDeepPaths,
							message: r1Message
						}
					]
				}
			]
		}
	},
	// R3 — data tier: no upward imports into app modules. Sanctioned tooling
	// (**/*.test.ts) is exempt, same as R1.
	{
		files: ['src/lib/db/**'],
		ignores: ['**/*.test.ts'],
		rules: {
			'@typescript-eslint/no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: appTierAreas,
							message: r3Message
						}
					]
				}
			]
		}
	},
	// ─── ESCAPE HATCHES ───
	// The only exception mechanism for the boundary rules above (FR-005): one
	// file-scoped override per exception, each with a justification. Inline
	// `eslint-disable` of a boundary rule is itself a violation (R4). R1/R2
	// hatches stay at zero (launch invariant). Template:
	// {
	// 	files: ['src/lib/path/to/file.svelte'],
	// 	rules: { '@typescript-eslint/no-restricted-imports': 'off' } // justification: why
	// },
	// R3 baseline straggler: reads boot state ('$lib/stores/db.svelte') and lazily
	// probes server services ('$lib/services/detect', '$lib/services/status.svelte');
	// migrates opportunistically when touched — see specs/025-text-first-runtime
	// (spec edge case: baselined escape hatches).
	{
		files: ['src/lib/db/driver/client.ts'],
		rules: { '@typescript-eslint/no-restricted-imports': 'off' }
	},
	// R3 baseline straggler: reads boot state ('$lib/stores/db.svelte'); migrates
	// opportunistically when touched — see specs/025-text-first-runtime
	// (spec edge case: baselined escape hatches).
	{
		files: ['src/lib/db/self-check.ts'],
		rules: { '@typescript-eslint/no-restricted-imports': 'off' }
	},
	// R3 baseline straggler: reaches the server transport ('$lib/services/client');
	// migrates opportunistically when touched — see specs/025-text-first-runtime
	// (spec edge case: baselined escape hatches).
	{
		files: ['src/lib/db/driver/pg.ts'],
		rules: { '@typescript-eslint/no-restricted-imports': 'off' }
	},
	// R3 baseline straggler: type-only import of '$lib/mcp/types'; migrates
	// opportunistically when touched — see specs/025-text-first-runtime
	// (spec edge case: baselined escape hatches).
	{
		files: ['src/lib/db/repositories/mcp.ts'],
		rules: { '@typescript-eslint/no-restricted-imports': 'off' }
	},
	// R3 baseline straggler: type-only import of LearningBrief from '$lib/chat/brief';
	// migrates opportunistically when touched — see specs/025-text-first-runtime
	// (spec edge case: baselined escape hatches).
	{
		files: ['src/lib/db/repositories/chats.ts'],
		rules: { '@typescript-eslint/no-restricted-imports': 'off' }
	},
	// R3 baseline straggler: kind derivation and part types from '$lib/chat/kinds';
	// migrates opportunistically when touched — see specs/025-text-first-runtime
	// (spec edge case: baselined escape hatches).
	{
		files: ['src/lib/db/repositories/messages.ts'],
		rules: { '@typescript-eslint/no-restricted-imports': 'off' }
	},
	// R3 baseline straggler: defaults from '$lib/chat/brief' and
	// '$lib/chat/expound-instructions'; migrates opportunistically when touched —
	// see specs/025-text-first-runtime (spec edge case: baselined escape hatches).
	{
		files: ['src/lib/db/repositories/settings.ts'],
		rules: { '@typescript-eslint/no-restricted-imports': 'off' }
	}
);
