#!/usr/bin/env node
// Tier-boundary guardrails for the tiered test suite
// (specs/032-test-suite-tiering/contracts/guardrails.md).
//
// Dependency-free and fast (<10 s): walks the test tree once, applies the
// stable TT-001..TT-008 rules, validates scripts/test-tier-exemptions.json
// (TT-000), and exits 2 with one sorted line per violation. Exemptions are
// keyed by file + rule ID and never suppress a TT-000 problem.
//
// Usage: node scripts/check-test-tiers.mjs [--root=<dir>]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const RULE_IDS = ['TT-001', 'TT-002', 'TT-003', 'TT-004', 'TT-005', 'TT-006', 'TT-007', 'TT-008'];

const IGNORED_DIRS = new Set([
	'node_modules',
	'.git',
	'.svelte-kit',
	'build',
	'dist',
	'coverage',
	'test-results',
	'playwright-report',
	'.kilo'
]);

const RUNNER_CONFIGS = [
	'vitest.config.ts',
	'vitest.unit.config.ts',
	'vitest.browser.config.ts',
	'playwright.config.ts',
	'scripts/dev-shard.mjs'
];

const ALLOWED_SOURCE_TEXT_DISPOSITIONS = new Set(['promote-static', 'retain']);

function parseArgs(argv) {
	let root = repoRoot;
	for (const arg of argv) {
		if (arg === '--help' || arg === '-h') {
			console.log('Usage: node scripts/check-test-tiers.mjs [--root=<dir>]');
			process.exit(0);
		}
		if (arg.startsWith('--root=')) {
			root = arg.slice('--root='.length);
			continue;
		}
		console.error(`[test-tiers] unknown argument '${arg}'`);
		process.exit(2);
	}
	return root;
}

const root = parseArgs(process.argv.slice(2));

function toPosix(path) {
	return path.split(sep).join('/');
}

function relativePath(path) {
	return toPosix(relative(root, path));
}

function walk(dir, files = []) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return files;
	}
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!IGNORED_DIRS.has(entry.name)) walk(path, files);
			continue;
		}
		if (entry.isFile()) files.push(path);
	}
	return files;
}

function readSource(path) {
	try {
		return statSync(path).isFile() ? readFileSync(path, 'utf8') : null;
	} catch {
		return null;
	}
}

// Replace comments with spaces while preserving line numbers, so a violation
// reports the original line and prose in comments never trips a rule.
function stripComments(source) {
	const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (match) =>
		match.replace(/[^\n]/g, ' ')
	);
	return withoutBlocks
		.split('\n')
		.map((line) => {
			const index = line.indexOf('//');
			if (index === -1) return line;
			// Keep protocol separators (`https://`) intact.
			if (index > 0 && line[index - 1] === ':') return line;
			return line.slice(0, index);
		})
		.join('\n');
}

function moduleSpecifiers(line) {
	const specifiers = [];
	const pattern = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
	for (const match of line.matchAll(pattern)) specifiers.push(match[1]);
	return specifiers;
}

function isBrowserOnlyModule(specifier) {
	if (specifier.startsWith('@vitest/browser')) return true;
	if (specifier === '@playwright/test' || specifier === 'playwright-core') return true;
	if (specifier === 'playwright' || specifier.startsWith('playwright/')) return true;
	if (specifier === 'vitest-browser-svelte' || specifier.startsWith('vitest-browser-svelte/')) {
		return true;
	}
	if (specifier.startsWith('@testing-library/')) return true;
	if (specifier.includes('/tests/browser/') || specifier.startsWith('tests/browser/')) return true;
	return false;
}

function isFsModule(specifier) {
	return specifier === 'fs' || specifier === 'node:fs' || specifier.startsWith('node:fs/');
}

function sourceTextFacts(source) {
	const facts = [];
	for (const [index, line] of source.split('\n').entries()) {
		const code = stripComments(line);
		const readsSource =
			/\breadFileSync\s*\(/.test(code) ||
			/\breadFile\s*\(/.test(code) ||
			moduleSpecifiers(code).some(isFsModule);
		if (readsSource) facts.push(index + 1);
	}
	return facts;
}

const violations = [];
const exempted = [];

function addViolation(rule, file, detail, line = null) {
	violations.push({ rule, file, detail, line });
}

// ─── Migration ledger ────────────────────────────────────────────────────────
// Rows in the Entries table are the only ledger authority: `| # | sourceFile |
// subject | claimedBehavior | disposition | replacementPath | rationale |
// verified |`. The Tier 3 pruning table has fewer columns and is skipped.
function parseLedger() {
	const path = join(root, 'specs/032-test-suite-tiering/migration-ledger.md');
	const rows = new Map();
	const source = readSource(path);
	if (source === null) {
		rows.error = `migration ledger is missing: ${relativePath(path)}`;
		return rows;
	}
	for (const line of source.split('\n')) {
		if (!/^\|\s*\d+\s*\|/.test(line)) continue;
		const cells = line.split('|').map((cell) => cell.trim());
		// ['', '#', sourceFile, subject, claimedBehavior, disposition, ...]
		if (cells.length < 9) continue;
		const sourceFile = cells[2].replace(/`/g, '').trim();
		if (!sourceFile.endsWith('.test.ts')) continue;
		const disposition = cells[5].replace(/`/g, '').trim();
		rows.set(sourceFile, { sourceFile, disposition });
	}
	return rows;
}

const ledger = parseLedger();

// ─── Exemptions (TT-000) ─────────────────────────────────────────────────────
function loadExemptions() {
	const path = join(root, 'scripts/test-tier-exemptions.json');
	const source = readSource(path);
	if (source === null) {
		addViolation('TT-000', relativePath(path), 'exemption file is missing');
		return new Map();
	}
	let parsed;
	try {
		parsed = JSON.parse(source);
	} catch (error) {
		addViolation(
			'TT-000',
			relativePath(path),
			`exemption file is not valid JSON: ${error.message}`
		);
		return new Map();
	}
	if (!Array.isArray(parsed)) {
		addViolation('TT-000', relativePath(path), 'exemption file must be a JSON array');
		return new Map();
	}

	const map = new Map();
	for (const [index, entry] of parsed.entries()) {
		const label = `exemption #${index + 1}`;
		if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
			addViolation('TT-000', relativePath(path), `${label} is not an object`);
			continue;
		}
		const file = typeof entry.file === 'string' ? entry.file.trim() : '';
		const rule = typeof entry.rule === 'string' ? entry.rule.trim() : '';
		const justification = typeof entry.justification === 'string' ? entry.justification.trim() : '';
		let invalid = false;
		if (file === '') {
			addViolation('TT-000', relativePath(path), `${label} is missing 'file'`);
			invalid = true;
		} else if (!existsSync(join(root, file))) {
			addViolation(
				'TT-000',
				relativePath(path),
				`${label} names a file that does not exist: ${file}`
			);
			invalid = true;
		}
		if (rule === '') {
			addViolation('TT-000', relativePath(path), `${label} is missing 'rule'`);
			invalid = true;
		} else if (!RULE_IDS.includes(rule)) {
			addViolation(
				'TT-000',
				relativePath(path),
				`${label} names an unknown rule '${rule}'; expected one of ${RULE_IDS.join(', ')}`
			);
			invalid = true;
		}
		if (justification === '') {
			addViolation('TT-000', relativePath(path), `${label} is missing a non-empty 'justification'`);
			invalid = true;
		}
		if (invalid) continue;
		const key = `${file}\u0000${rule}`;
		if (map.has(key)) {
			addViolation(
				'TT-000',
				relativePath(path),
				`${label} duplicates the exemption for ${file} (${rule})`
			);
			continue;
		}
		map.set(key, { file, rule, justification });
	}
	return map;
}

const exemptions = loadExemptions();

function report(rule, file, detail, line = null) {
	const key = `${file}\u0000${rule}`;
	if (rule !== 'TT-000' && exemptions.has(key)) {
		exempted.push({ rule, file, line });
		return;
	}
	addViolation(rule, file, detail, line);
}

// ─── File inventory ──────────────────────────────────────────────────────────
const tier1Files = [];
const tier2Files = [];
const tier3Files = [];
const allFiles = [];

for (const dir of ['src', 'server/src', 'tests']) {
	for (const path of walk(join(root, dir))) {
		const file = relativePath(path);
		allFiles.push(file);
		if (file.endsWith('.browser.test.ts')) tier2Files.push(file);
		else if (file.endsWith('.test.ts')) tier1Files.push(file);
		else if (file.startsWith('tests/e2e/') && file.endsWith('.ts')) tier3Files.push(file);
	}
}

const tier3Specs = tier3Files.filter((file) => file.endsWith('.spec.ts'));
const integrationFiles = allFiles.filter((file) => file.endsWith('.integration.test.ts'));

// ─── TT-001: Tier 1 must not import browser-mode packages ────────────────────
for (const file of tier1Files) {
	const source = readSource(join(root, file));
	if (source === null) continue;
	for (const [index, line] of stripComments(source).split('\n').entries()) {
		const specifier = moduleSpecifiers(line).find(isBrowserOnlyModule);
		if (specifier !== undefined) {
			report(
				'TT-001',
				file,
				`imports the browser-only package '${specifier}'; move it to *.browser.test.ts`,
				index + 1
			);
		}
	}
}

// ─── TT-002: Tier 3 must not use fixed-duration waits ────────────────────────
const FIXED_WAIT_PATTERNS = [
	{ pattern: /\bwaitForTimeout\s*\(/, label: 'waitForTimeout' },
	{ pattern: /\btest\.setTimeout\s*\(/, label: 'test.setTimeout' },
	{ pattern: /\bsetTimeout\s*\(/, label: 'setTimeout' },
	{ pattern: /\bsleep\s*\(/, label: 'sleep' }
];

for (const file of tier3Files) {
	const source = readSource(join(root, file));
	if (source === null) continue;
	for (const [index, line] of stripComments(source).split('\n').entries()) {
		const hit = FIXED_WAIT_PATTERNS.find(({ pattern }) => pattern.test(line));
		if (hit) {
			report(
				'TT-002',
				file,
				`uses a fixed wait (${hit.label}); assert a condition instead`,
				index + 1
			);
		}
	}
}

// ─── TT-003: Component tests must render; source-text must be ledger-backed ──
for (const file of tier2Files) {
	const source = readSource(join(root, file));
	if (source === null) continue;
	const lines = sourceTextFacts(source);
	if (lines.length > 0) {
		report('TT-003', file, 'asserts component source text; render the component instead', lines[0]);
	}
}

for (const file of tier1Files) {
	// The source-text ledger covers app tests (`src/**/*.test.ts`). Server tests
	// legitimately read fixtures, keys, and dump files as part of their subject.
	if (!file.startsWith('src/')) continue;
	const source = readSource(join(root, file));
	if (source === null) continue;
	const lines = sourceTextFacts(source);
	if (lines.length === 0) continue;
	if (ledger.error) {
		report('TT-003', file, ledger.error, lines[0]);
		continue;
	}
	const row = ledger.get(file);
	if (!row) {
		report(
			'TT-003',
			file,
			'asserts component source text; render the component or use a static invariant check',
			lines[0]
		);
		continue;
	}
	if (!ALLOWED_SOURCE_TEXT_DISPOSITIONS.has(row.disposition)) {
		report(
			'TT-003',
			file,
			`asserts source text but its ledger disposition is '${row.disposition}'; a source-text file must be promote-static or retain`,
			lines[0]
		);
	}
}

// ─── TT-004: Tier 3 must not replay the first-run setup journey ──────────────
const SETUP_JOURNEY_PATTERNS = [
	{ pattern: /\bmayon_setup_dismissed\b/, label: 'setup dismissal key' },
	{ pattern: /\bSETUP_DISMISS_KEY\b/, label: 'setup dismissal key' },
	{ pattern: /\bsetupRequired\b/, label: 'setup-required state' },
	{
		pattern: /getByRole\(\s*['"]button['"]\s*,\s*\{\s*name:\s*['"]Skip['"]/,
		label: 'setup Skip button'
	}
];

for (const file of tier3Files) {
	if (file === 'tests/e2e/global-setup.ts') continue;
	const source = readSource(join(root, file));
	if (source === null) continue;
	for (const [index, line] of stripComments(source).split('\n').entries()) {
		const hit = SETUP_JOURNEY_PATTERNS.find(({ pattern }) => pattern.test(line));
		if (hit) {
			report(
				'TT-004',
				file,
				`replays the first-run setup journey (${hit.label}); use the shared session fixture`,
				index + 1
			);
		}
	}
}

// ─── TT-005: Tier 3 specs must use the shared session fixture ────────────────
const SESSION_FIXTURE_IMPORT = /from\s+['"][^'"]*fixtures\/(?:session|onboard)(?:\.js)?['"]/;
const HARD_CODED_SECRET =
	/\b(?:password|passcode|secret|apiKey|api_key|accessToken|access_token|authCode|auth_code)\s*[:=]\s*['"][^'"]+['"]/i;

for (const file of tier3Specs) {
	const source = readSource(join(root, file));
	if (source === null) continue;
	if (!SESSION_FIXTURE_IMPORT.test(source)) {
		report('TT-005', file, 'does not use the shared E2E session fixture');
	}
	for (const [index, line] of stripComments(source).split('\n').entries()) {
		if (HARD_CODED_SECRET.test(line)) {
			report(
				'TT-005',
				file,
				'contains a hard-coded credential; read it from the environment',
				index + 1
			);
		}
	}
}

// ─── TT-006: Runner concurrency must come from the capability gate ───────────
const CONCURRENCY_SETTING = /\b(maxWorkers|workers|fullyParallel|fileParallelism)\s*:\s*(.+)$/;
const CAPABILITY_ROUTED = /\b(?:capacity|readCapacity|cap\.)|env(?:Number|Boolean)\(/;
const SAFE_LITERAL = /^(?:1|false|'1'|"1")\s*[,;]?\s*$/;

for (const file of RUNNER_CONFIGS) {
	const path = join(root, file);
	const source = readSource(path);
	if (source === null) continue;
	for (const [index, line] of stripComments(source).split('\n').entries()) {
		const match = CONCURRENCY_SETTING.exec(line);
		if (!match) continue;
		const value = match[2].trim();
		if (CAPABILITY_ROUTED.test(value) || SAFE_LITERAL.test(value)) continue;
		report(
			'TT-006',
			file,
			`sets '${match[1]}' without the capability gate; use capacity.${match[1]} or a safe serial literal`,
			index + 1
		);
	}
}

// ─── TT-007: Tier 2 must not require the app server/DB/docker compose ────────
const FULL_STACK_PATTERNS = [
	{ pattern: /\bdocker[\s-]+compose\b/i, label: 'docker compose' },
	{ pattern: /\bDATABASE_URL\b/, label: 'DATABASE_URL' },
	{ pattern: /\bpostgres(?:ql)?:\/\//i, label: 'a Postgres URL' },
	{ pattern: /['"]\/api\/db\/query['"]/, label: 'the server DB proxy' },
	{ pattern: /\bRemotePgDriver\b/, label: 'RemotePgDriver' },
	{ pattern: /:4319\b/, label: 'the app server port' },
	{ pattern: /\bcreateServer\s*\(/, label: 'an HTTP listener' }
];

for (const file of tier2Files) {
	const source = readSource(join(root, file));
	if (source === null) continue;
	for (const [index, line] of stripComments(source).split('\n').entries()) {
		const hit = FULL_STACK_PATTERNS.find(({ pattern }) => pattern.test(line));
		if (hit) {
			report(
				'TT-007',
				file,
				`depends on the full stack (${hit.label}); move it to tests/e2e`,
				index + 1
			);
		}
	}
}

// ─── TT-008: *.integration.test.ts must be excluded from the unit project ────
if (integrationFiles.length > 0) {
	const unitConfig = readSource(join(root, 'vitest.unit.config.ts'));
	if (unitConfig === null) {
		report(
			'TT-008',
			'vitest.unit.config.ts',
			'unit project config is missing; integration tests are selected by the default suite'
		);
	} else {
		const excludeBlock = /exclude\s*:\s*\[[\s\S]*?\]/.exec(unitConfig)?.[0] ?? '';
		const includeBlock = /include\s*:\s*\[[\s\S]*?\]/.exec(unitConfig)?.[0] ?? '';
		const excluded = /integration\.test\.ts/.test(excludeBlock);
		const included = /integration\.test\.ts/.test(includeBlock);
		if (!excluded || included) {
			for (const file of integrationFiles) {
				report('TT-008', file, 'is selected by the default unit project; exclude it or rename it');
			}
		}
	}
}

// ─── Output ──────────────────────────────────────────────────────────────────
const sorted = violations.sort(
	(a, b) =>
		a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule) || (a.line ?? 0) - (b.line ?? 0)
);

const scannedConfigs = RUNNER_CONFIGS.filter((file) => existsSync(join(root, file))).length;
console.log(
	`[test-tiers] scanned ${tier1Files.length} tier1, ${tier2Files.length} tier2, ${tier3Files.length} tier3, ${scannedConfigs} runner configs (${RULE_IDS.length} rules)`
);
if (exempted.length > 0) {
	console.log(
		`[test-tiers] exemptions applied: ${exempted
			.map(({ rule, file }) => `${rule}:${file}`)
			.join(', ')}`
	);
}

if (sorted.length > 0) {
	for (const { rule, file, detail, line } of sorted) {
		const location = line === null ? file : `${file}:${line}`;
		console.error(`${rule}: ${location} ${detail}`);
	}
	console.error(`[test-tiers] ${sorted.length} violation(s)`);
	process.exit(2);
}

console.log('[test-tiers] all tier guardrails pass');
