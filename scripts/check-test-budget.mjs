#!/usr/bin/env node
// Per-tier duration gate for the tiered test suite
// (specs/032-test-suite-tiering/contracts/test-commands.md).
//
// Ownership: `test:ci` measures tier1, tier2, and server in
// `test-results/tier-durations.json`; `test:e2e:ci` measures tier3 per shard in
// `test-results/tier3-shard-<n>.json`. A tier listed in --tiers is owned by the
// current invocation: a missing or over-budget owned tier exits 3. Every other
// tier is reported as deferred to its owning job and never fails this run.
// Reports for deferred tiers are not read, so an unrelated stale/malformed
// artifact cannot fail a job that does not own it.
//
// Dependency-free. Usage:
//   node scripts/check-test-budget.mjs --tiers=tier1,tier2,server
//   node scripts/check-test-budget.mjs --tiers=tier3
// Defaults to the non-e2e owner (`tier1,tier2,server`) when --tiers is omitted.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RESULTS_DIR = join(ROOT, 'test-results');
const DURATIONS_FILE = join(RESULTS_DIR, 'tier-durations.json');
const BUDGETS_FILE = join(ROOT, 'test-budgets.json');

const TIER_OWNERS = {
	tier1: 'test:ci',
	tier2: 'test:ci',
	server: 'test:ci',
	tier3: 'test:e2e:ci'
};
const ALL_TIERS = Object.keys(TIER_OWNERS);
const DEFAULT_TIERS = ['tier1', 'tier2', 'server'];
const EXIT_CONFIG = 2;
const EXIT_BUDGET = 3;

function fail(message, exitCode) {
	console.error(`[test-budget] ${message}`);
	process.exit(exitCode);
}

function parseArgs(argv) {
	let tiers = null;
	for (const arg of argv) {
		if (arg === '--help' || arg === '-h') {
			console.log('Usage: node scripts/check-test-budget.mjs [--tiers=<tier1,tier2,server|tier3>]');
			process.exit(0);
		}
		if (arg.startsWith('--tiers=')) {
			tiers = arg.slice('--tiers='.length);
			continue;
		}
		fail(`unknown argument '${arg}'`, EXIT_CONFIG);
	}
	if (tiers === null) return [...DEFAULT_TIERS];
	const requested = [
		...new Set(
			tiers
				.split(',')
				.map((tier) => tier.trim())
				.filter(Boolean)
		)
	];
	if (requested.length === 0) fail('--tiers must name at least one tier', EXIT_CONFIG);
	const unknown = requested.filter((tier) => !ALL_TIERS.includes(tier));
	if (unknown.length > 0) {
		fail(
			`unknown tier(s): ${unknown.join(', ')}; expected one of ${ALL_TIERS.join(', ')}`,
			EXIT_CONFIG
		);
	}
	return requested;
}

function readJson(path, label) {
	let raw;
	try {
		raw = readFileSync(path, 'utf8');
	} catch {
		return null;
	}
	try {
		return JSON.parse(raw);
	} catch {
		fail(`${label} is not valid JSON: ${path}`, EXIT_CONFIG);
	}
}

function readBudgets() {
	const budgets = readJson(BUDGETS_FILE, 'test-budgets.json');
	if (!budgets || typeof budgets !== 'object') {
		fail(`test-budgets.json is missing or invalid: ${BUDGETS_FILE}`, EXIT_CONFIG);
	}
	for (const tier of ALL_TIERS) {
		const value = budgets[tier];
		if (!Number.isFinite(value) || value <= 0) {
			fail(`test-budgets.json must define a positive '${tier}' budget`, EXIT_CONFIG);
		}
	}
	return budgets;
}

function readDurations() {
	const report = readJson(DURATIONS_FILE, 'tier-durations.json');
	if (!report) return null;
	if (!Array.isArray(report.tiers)) {
		fail('tier-durations.json must contain a tiers array', EXIT_CONFIG);
	}
	return report;
}

function readShardReports() {
	let entries;
	try {
		entries = readdirSync(RESULTS_DIR);
	} catch {
		return [];
	}
	const shardFile = /^tier3-shard-(\d+)\.json$/;
	return entries
		.map((name) => ({ name, match: shardFile.exec(name) }))
		.filter(({ match }) => match !== null)
		.sort((a, b) => Number(a.match[1]) - Number(b.match[1]))
		.map(({ name, match }) => {
			const report = readJson(join(RESULTS_DIR, name), name);
			if (!report || !Number.isFinite(report.measuredSeconds)) {
				fail(`${name} must contain a numeric measuredSeconds`, EXIT_CONFIG);
			}
			return { shard: Number(match[1]), name, report };
		});
}

function measuredStatus(measuredSeconds, budgetSeconds) {
	return measuredSeconds > budgetSeconds ? 'over-budget' : 'pass';
}

function formatSeconds(value) {
	return `${Number(value.toFixed(1))}s`;
}

const ownedTiers = parseArgs(process.argv.slice(2));
const budgets = readBudgets();
const multiplier =
	Number.isFinite(budgets.lowSpecMultiplier) && budgets.lowSpecMultiplier > 0
		? budgets.lowSpecMultiplier
		: 1;
const durations = readDurations();
const shards = ownedTiers.includes('tier3') ? readShardReports() : [];
const mode = durations?.capability?.mode ?? shards[0]?.report?.mode ?? 'capable';
const budgetFactor = mode === 'capable' ? 1 : multiplier;
const budgetFor = (tier) => budgets[tier] * budgetFactor;
const failures = [];
const deferred = ALL_TIERS.filter((tier) => !ownedTiers.includes(tier));

console.log(`[test-budget] owned: ${ownedTiers.join(', ')}`);
if (budgetFactor !== 1) {
	console.log(
		`[test-budget] low-spec x${multiplier}: budgets scaled (mode=${mode}, reference=${budgets.reference ?? '8cpu/8GiB'})`
	);
}
if (deferred.length > 0) {
	const summary = deferred.map((tier) => `${tier} (${TIER_OWNERS[tier]})`).join(', ');
	console.log(`[test-budget] deferred: ${summary}`);
}

for (const tier of ownedTiers) {
	const budgetSeconds = budgetFor(tier);
	const referenceBudgetSeconds = budgets[tier];

	if (tier === 'tier3') {
		if (shards.length === 0) {
			failures.push(
				`tier3: missing shard report test-results/tier3-shard-<n>.json (owned by ${TIER_OWNERS.tier3} — run pnpm test:e2e:ci --shard=<n>/<total>)`
			);
			continue;
		}
		for (const { shard, name, report } of shards) {
			const measured = Number(report.measuredSeconds);
			const status = measuredStatus(measured, budgetSeconds);
			console.log(
				`[test-budget] tier3 shard ${shard}: ${status} ${formatSeconds(measured)}/${budgetSeconds}s${budgetFactor === 1 ? '' : ` (reference ${referenceBudgetSeconds}s)`} (${name})`
			);
			if (status === 'over-budget') {
				failures.push(
					`tier3 shard ${shard}: over budget ${formatSeconds(measured)} > ${budgetSeconds}s (${name})`
				);
			}
		}
		continue;
	}

	if (!durations) {
		failures.push(
			`${tier}: missing report test-results/tier-durations.json (owned by ${TIER_OWNERS[tier]} — run pnpm test:ci)`
		);
		continue;
	}
	const entry = durations.tiers.find((candidate) => candidate?.id === tier);
	if (!entry || !Number.isFinite(entry.measuredSeconds)) {
		failures.push(
			`${tier}: missing measurement in test-results/tier-durations.json (owned by ${TIER_OWNERS[tier]} — run pnpm test:ci)`
		);
		continue;
	}
	const measured = Number(entry.measuredSeconds);
	const status = measuredStatus(measured, budgetSeconds);
	console.log(
		`[test-budget] ${tier}: ${status} ${formatSeconds(measured)}/${budgetSeconds}s${budgetFactor === 1 ? '' : ` (reference ${referenceBudgetSeconds}s)`}`
	);
	if (status === 'over-budget') {
		failures.push(`${tier}: over budget ${formatSeconds(measured)} > ${budgetSeconds}s`);
	}
}

if (failures.length > 0) {
	for (const failure of failures) console.error(`[test-budget] FAIL: ${failure}`);
	console.error(
		`[test-budget] ${failures.length} owned tier(s) missing or over budget; budgets live in test-budgets.json`
	);
	process.exit(EXIT_BUDGET);
}

console.log('[test-budget] all owned tiers within budget');
