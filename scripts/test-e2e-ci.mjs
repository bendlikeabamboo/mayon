#!/usr/bin/env node
// Tier 3 (e2e) CI owner (specs/032-test-suite-tiering/contracts/test-commands.md).
//
// Runs one Playwright shard, measures its wall-clock duration, writes
// test-results/tier3-shard-<n>.json, then enforces the per-shard budget. The
// report is written even when the shard fails so CI can upload it. A test
// failure exits 1; a budget breach exits 3; a usage/config problem exits 2.
//
// The stack is not started here: CI boots it with `pnpm dev:shard:up` first and
// points E2E_BASE_URL at that shard's web port.
//
// Usage: pnpm test:e2e:ci --shard=<n>/<total>
//        pnpm test:e2e:ci            (runs all tests as shard 1/1)

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { readCapacity, reportCapacity } from './test-capacity.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RESULTS_DIR = join(ROOT, 'test-results');
const BUDGETS_FILE = join(ROOT, 'test-budgets.json');

const EXIT_TEST_FAILURE = 1;
const EXIT_CONFIG = 2;

function fail(message) {
	console.error(`[test:e2e:ci] ${message}`);
	process.exit(EXIT_CONFIG);
}

function parseShard(argv) {
	let spec = '1/1';
	for (const arg of argv) {
		if (arg === '--help' || arg === '-h') {
			console.log('Usage: pnpm test:e2e:ci --shard=<n>/<total>');
			process.exit(0);
		}
		if (arg.startsWith('--shard=')) {
			spec = arg.slice('--shard='.length);
			continue;
		}
		fail(`unknown argument '${arg}'`);
	}
	const match = /^(\d+)\/(\d+)$/.exec(spec);
	if (!match) fail(`--shard must be <n>/<total>, received '${spec}'`);
	const shard = Number(match[1]);
	const total = Number(match[2]);
	if (shard < 1 || total < 1 || shard > total) {
		fail(`--shard must satisfy 1 <= n <= total, received '${spec}'`);
	}
	return { shard, total };
}

function readTier3Budget() {
	let raw;
	try {
		raw = readFileSync(BUDGETS_FILE, 'utf8');
	} catch {
		fail('test-budgets.json is missing');
	}
	let budgets;
	try {
		budgets = JSON.parse(raw);
	} catch (error) {
		fail(`test-budgets.json is not valid JSON: ${error.message}`);
	}
	if (!Number.isFinite(budgets?.tier3) || budgets.tier3 <= 0) {
		fail("test-budgets.json must define a positive 'tier3' budget");
	}
	return budgets;
}

const { shard, total } = parseShard(process.argv.slice(2));
const budgets = readTier3Budget();
reportCapacity(readCapacity());

console.log(`[test:e2e:ci] shard ${shard}/${total}`);
const start = process.hrtime.bigint();
const result = spawnSync('pnpm', ['exec', 'playwright', 'test', `--shard=${shard}/${total}`], {
	stdio: 'inherit',
	cwd: ROOT
});
const measuredSeconds = Math.round((Number(process.hrtime.bigint() - start) / 1e9) * 100) / 100;
const exitCode = result.status ?? EXIT_TEST_FAILURE;
if (result.error)
	console.error(`[test:e2e:ci] playwright could not start: ${result.error.message}`);

const report = {
	shard,
	total,
	budgetSeconds: budgets.tier3,
	measuredSeconds,
	status: measuredSeconds > budgets.tier3 ? 'over-budget' : 'pass'
};
mkdirSync(RESULTS_DIR, { recursive: true });
const reportFile = join(RESULTS_DIR, `tier3-shard-${shard}.json`);
writeFileSync(reportFile, `${JSON.stringify(report, null, '\t')}\n`);
console.log(`[test:e2e:ci] wrote ${join('test-results', `tier3-shard-${shard}.json`)}`);

const budget = spawnSync('node', [join(ROOT, 'scripts/check-test-budget.mjs'), '--tiers=tier3'], {
	stdio: 'inherit',
	cwd: ROOT
});
const budgetExit = budget.status ?? EXIT_TEST_FAILURE;

if (exitCode !== 0) process.exit(EXIT_TEST_FAILURE);
process.exit(budgetExit);
