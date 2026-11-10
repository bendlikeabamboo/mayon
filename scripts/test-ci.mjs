#!/usr/bin/env node
// Non-e2e CI test owner (specs/032-test-suite-tiering/contracts/test-commands.md).
//
// Runs Tier 1, Tier 2, and the server suite, measures each wall-clock duration,
// writes test-results/tier-durations.json (tier3 deferred to test:e2e:ci), then
// enforces the budgets owned by this command. A test failure exits 1; a budget
// breach exits 3; a guardrail/config problem exits 2. The report is written even
// when a tier fails so CI can upload it.
//
// Usage: pnpm test:ci

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { readCapacity, reportCapacity } from './test-capacity.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RESULTS_DIR = join(ROOT, 'test-results');
const DURATIONS_FILE = join(RESULTS_DIR, 'tier-durations.json');
const BUDGETS_FILE = join(ROOT, 'test-budgets.json');

const OWNED_TIERS = ['tier1', 'tier2', 'server'];
const TIER_COMMANDS = {
	tier1: ['pnpm', ['test:unit']],
	tier2: ['pnpm', ['test:browser']],
	server: ['pnpm', ['--filter', '@mayon/server', 'test']]
};

const EXIT_TEST_FAILURE = 1;
const EXIT_CONFIG = 2;

function fail(message) {
	console.error(`[test:ci] ${message}`);
	process.exit(EXIT_CONFIG);
}

function readBudgets() {
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
	for (const tier of OWNED_TIERS) {
		if (!Number.isFinite(budgets?.[tier]) || budgets[tier] <= 0) {
			fail(`test-budgets.json must define a positive '${tier}' budget`);
		}
	}
	return budgets;
}

function run(command, args) {
	const start = process.hrtime.bigint();
	const result = spawnSync(command, args, { stdio: 'inherit', cwd: ROOT });
	const measuredSeconds = Number(process.hrtime.bigint() - start) / 1e9;
	return {
		measuredSeconds: Math.round(measuredSeconds * 100) / 100,
		exitCode: result.status ?? EXIT_TEST_FAILURE,
		error: result.error
	};
}

function writeReport(capacity, budgets, tiers) {
	const factor =
		capacity.mode === 'capable'
			? 1
			: Number.isFinite(budgets.lowSpecMultiplier) && budgets.lowSpecMultiplier > 0
				? budgets.lowSpecMultiplier
				: 1;
	const report = {
		generatedAt: new Date().toISOString(),
		reference: budgets.reference ?? '8cpu/8GiB',
		capability: {
			mode: capacity.mode,
			logicalCpus: capacity.logicalCpus,
			usableMemoryBytes: capacity.usableMemoryBytes,
			override: capacity.override,
			workers: capacity.workers
		},
		tiers: tiers.map(({ id, measuredSeconds }) => ({
			id,
			budgetSeconds: budgets[id] * factor,
			referenceBudgetSeconds: budgets[id],
			measuredSeconds,
			status: measuredSeconds > budgets[id] * factor ? 'over-budget' : 'pass'
		})),
		deferred: [{ id: 'tier3', owner: 'test:e2e:ci' }]
	};
	mkdirSync(RESULTS_DIR, { recursive: true });
	writeFileSync(DURATIONS_FILE, `${JSON.stringify(report, null, '\t')}\n`);
	console.log(`[test:ci] wrote ${join('test-results', 'tier-durations.json')}`);
}

const capacity = reportCapacity(readCapacity());
const budgets = readBudgets();

const guardrails = spawnSync('node', [join(ROOT, 'scripts/check-test-tiers.mjs')], {
	stdio: 'inherit',
	cwd: ROOT
});
if ((guardrails.status ?? EXIT_CONFIG) !== 0) {
	fail('tier guardrails failed; fix the violations above before running the tiers');
}

const tiers = [];
let testFailed = false;
for (const tier of OWNED_TIERS) {
	const [command, args] = TIER_COMMANDS[tier];
	console.log(`[test:ci] ${tier}: ${command} ${args.join(' ')}`);
	const result = run(command, args);
	tiers.push({ id: tier, measuredSeconds: result.measuredSeconds });
	if (result.error) {
		console.error(`[test:ci] ${tier} could not start: ${result.error.message}`);
		testFailed = true;
	} else if (result.exitCode !== 0) {
		console.error(`[test:ci] ${tier} failed with exit code ${result.exitCode}`);
		testFailed = true;
	}
}

writeReport(capacity, budgets, tiers);

const budget = spawnSync(
	'node',
	[join(ROOT, 'scripts/check-test-budget.mjs'), `--tiers=${OWNED_TIERS.join(',')}`],
	{ stdio: 'inherit', cwd: ROOT }
);
const budgetExit = budget.status ?? EXIT_TEST_FAILURE;

if (testFailed) process.exit(EXIT_TEST_FAILURE);
process.exit(budgetExit);
