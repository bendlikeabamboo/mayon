#!/usr/bin/env node
// Dependency-direction backstop for the $lib/db boundary
// (specs/025-text-first-runtime/contracts/enforcement.md). R1/R3 static checks
// duplicate eslint.config.js on purpose (belt + suspenders); R2 (dynamic deep
// imports) and R4 (inline disables of boundary rules) close real eslint gaps.
// ponytail: naive line regexes — comments quoting violation syntax can
// false-positive; acceptable for a backstop behind the eslint wire.
// Usage: node scripts/check-dependency-direction.mjs [root]  (default: src)

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import process from 'node:process';

// Escape hatches for THIS script's rules; eslint-side hatches live in the
// ESCAPE HATCHES block of eslint.config.js. Each entry needs a non-empty
// justification; a hatch without one is itself a violation. R1/R2 hatches stay
// at zero (launch invariant). R3 baseline stragglers: pre-existing db→app
// imports that migrate opportunistically when touched — see
// specs/025-text-first-runtime (spec edge case: baselined escape hatches).
const HATCHES = [
	{
		file: 'src/lib/db/driver/client.ts',
		rule: 'R3',
		justification:
			'R3 baseline straggler: reads boot state ($lib/stores/db.svelte) and lazily probes server services ($lib/services/detect, $lib/services/status.svelte); migrates opportunistically when touched.'
	},
	{
		file: 'src/lib/db/self-check.ts',
		rule: 'R3',
		justification:
			'R3 baseline straggler: reads boot state ($lib/stores/db.svelte); migrates opportunistically when touched.'
	},
	{
		file: 'src/lib/db/driver/pg.ts',
		rule: 'R3',
		justification:
			'R3 baseline straggler: reaches the server transport ($lib/services/client); migrates opportunistically when touched.'
	},
	{
		file: 'src/lib/db/repositories/mcp.ts',
		rule: 'R3',
		justification:
			'R3 baseline straggler: type-only import of $lib/mcp/types; migrates opportunistically when touched.'
	},
	{
		file: 'src/lib/db/repositories/chats.ts',
		rule: 'R3',
		justification:
			'R3 baseline straggler: type-only import of LearningBrief from $lib/chat/brief; migrates opportunistically when touched.'
	},
	{
		file: 'src/lib/db/repositories/messages.ts',
		rule: 'R3',
		justification:
			'R3 baseline straggler: kind derivation and part types from $lib/chat/kinds; migrates opportunistically when touched.'
	},
	{
		file: 'src/lib/db/repositories/settings.ts',
		rule: 'R3',
		justification:
			'R3 baseline straggler: defaults from $lib/chat/brief and $lib/chat/expound-instructions; migrates opportunistically when touched.'
	}
];

// Keep the app-module prefixes in sync with eslint.config.js (R3 block).
const DB_DIR = join('lib', 'db');
const DEEP_DB = /\b(?:from|import)\s*['"]\$lib\/db\//;
const DYNAMIC_DB = /\bimport\s*\(\s*['"]\$lib\/db\//;
const APP_IMPORT =
	/\b(?:from|import)\s*\(?\s*['"]\$lib\/(?:components|stores|services|ai|chat|mcp)(?:\/[^'"]*)?['"]/;
const INLINE_DISABLE =
	/eslint-disable(?:-next-line|-line)?\b.*(?:@typescript-eslint\/)?no-restricted-imports/;
const EXTS = new Set(['.ts', '.js', '.mjs', '.mts', '.jsx', '.tsx', '.svelte']);

const FACADE_ALT =
	"app code must import only from '$lib/db' (the repository façade), never '$lib/db/<deep path>'. See docs/reference/seams + docs/reference/agent-map.";
const HATCH_ALT =
	'inline disables of boundary rules are forbidden; add a scoped entry to the ESCAPE HATCHES block in eslint.config.js (justification required). See docs/reference/seams + docs/reference/agent-map.';
const ALTS = {
	R1: FACADE_ALT,
	R2: FACADE_ALT,
	R3: "'$lib/db/**' must not import app modules (no upward imports); data is reached only through '$lib/db'. See docs/reference/seams + docs/reference/agent-map.",
	R4: HATCH_ALT,
	hatch: HATCH_ALT
};

function walk(dir) {
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(p));
		else if (EXTS.has(p.slice(p.lastIndexOf('.')))) out.push(p);
	}
	return out;
}

const root = process.argv[2] ?? 'src';
const dbDir = join(root, DB_DIR);
const violations = [];

for (const h of HATCHES) {
	if (!h.file || !h.rule || !h.justification?.trim()) {
		violations.push({
			file: `${h.file ?? '(escape hatch)'}:0`,
			rule: 'hatch',
			reason: 'escape hatch needs file, rule, and a non-empty justification',
			alt: ALTS.hatch
		});
	}
}

const hatched = (file, rule) =>
	HATCHES.some((h) => h.file === file && h.rule === rule && h.justification?.trim());

for (const abs of walk(root)) {
	const file = relative(process.cwd(), abs).split(sep).join('/');
	const inDb = abs === dbDir || abs.startsWith(dbDir + sep);
	// Sanctioned tooling: test files may import '$lib/db/driver/pg-test' etc. (R1/R2
	// exempt) and are exempt from R3, matching eslint.
	const isTest = /\.test\.ts$/.test(abs);
	const lines = readFileSync(abs, 'utf8').split('\n');
	lines.forEach((line, i) => {
		const add = (rule, reason) => {
			if (!hatched(file, rule))
				violations.push({ file: `${file}:${i + 1}`, rule, reason, alt: ALTS[rule] });
		};
		if (!inDb && !isTest) {
			if (DEEP_DB.test(line)) add('R1', "static/type import of a '$lib/db/<deep path>' internal");
			if (DYNAMIC_DB.test(line)) add('R2', "dynamic import of a '$lib/db/<deep path>' internal");
		}
		if (inDb && !isTest && APP_IMPORT.test(line))
			add('R3', `'${DB_DIR}' module imports an app module`);
		if (INLINE_DISABLE.test(line)) add('R4', 'inline eslint-disable of a boundary rule');
	});
}

if (violations.length) {
	for (const v of violations)
		console.log(`${v.file}: boundary violation (${v.rule}): ${v.reason}; ${v.alt}`);
	process.exitCode = 1;
} else {
	console.log('boundary check: clean');
}
