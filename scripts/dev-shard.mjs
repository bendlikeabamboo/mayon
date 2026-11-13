#!/usr/bin/env node
// Per-shard E2E runner: one dev stack per Playwright shard so shards can run
// concurrently with zero shared-state races (project mayon-dev-shard-N, web
// host port 5200+N, disjoint volumes/network via the compose project prefix).
//
//   node scripts/dev-shard.mjs up 1/4     # boot shard-1's stack + readiness waits
//   node scripts/dev-shard.mjs test 1/4   # playwright --shard=1/4 vs E2E_BASE_URL=:5201
//   node scripts/dev-shard.mjs down 1     # tear shard-1's stack down
//
// Shard files are independent (no shared port ownership, no cross-spec chat
// ids, and provider-picker-coaching owns its provider), so the configured total
// is whatever the caller passes. CI builds the dev images once, pulls them onto
// one runner, and runs the whole suite there as shard 1/1 with parallel
// workers; this command remains the local way to split work across stacks. The
// capability gate is resolved here and passed explicitly to the Playwright
// process through MAYON_TEST_MAX_WORKERS; Playwright itself still applies the
// same gate (workers/fullyParallel).
//
// Compose is always invoked through scripts/dev-compose.mjs (--shard=N), so
// engine resolution (MAYON_DEV_ENGINE) stays in one place.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shardProject, shardWebPort } from './dev-compose.mjs';
import { reportCapacity } from './test-capacity.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const devCompose = path.join(repoRoot, 'scripts', 'dev-compose.mjs');

const usage =
	'Usage: node scripts/dev-shard.mjs up|test <shard>/<total> | down <shard>[/<total>] (e.g. up 1/4)';

function fail(message) {
	console.error(`✗ ${message}`);
	process.exit(1);
}

/** `<shard>` or `<shard>/<total>`, validated. */
function parseShard(spec, { totalRequired }) {
	const match = /^(\d+)(?:\/(\d+))?$/.exec(spec ?? '');
	if (!match || (totalRequired && match[2] === undefined)) fail(usage);
	const shard = Number(match[1]);
	const total = match[2] === undefined ? null : Number(match[2]);
	if (shard < 1 || (total !== null && (total < 1 || shard > total))) fail(usage);
	return { shard, total };
}

/** Run dev-compose.mjs for shard N; returns exit code (output inherited). */
function compose(shard, args, env = process.env) {
	const result = spawnSync('node', [devCompose, `--shard=${shard}`, ...args], {
		stdio: 'inherit',
		cwd: repoRoot,
		env
	});
	if (result.error) fail(`Could not run scripts/dev-compose.mjs: ${result.error.message}`);
	return result.status ?? 1;
}

/** Resolve the capability gate once and print its stable report line. */
function capacity() {
	return reportCapacity();
}

/** Poll until the shard web answers 200 (mirrors the CI readiness wait). */
async function waitWeb(port) {
	const url = `http://127.0.0.1:${port}/`;
	const deadline = Date.now() + 120_000;
	for (;;) {
		try {
			const res = await fetch(url);
			await res.text();
			if (res.ok) return;
		} catch {
			// not up yet
		}
		if (Date.now() > deadline) {
			fail(`shard web did not become ready on :${port}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}
}

/** Poll until the server container can reach mock-llm (mirrors the CI wait). */
function waitMockLlm(shard) {
	const deadline = Date.now() + 120_000;
	for (;;) {
		const probe = spawnSync(
			'node',
			[
				devCompose,
				`--shard=${shard}`,
				'exec',
				'-T',
				'server',
				'wget',
				'-qO-',
				'http://mock-llm:9999/v1/models'
			],
			{ stdio: 'ignore', cwd: repoRoot }
		);
		if (probe.error) fail(`Could not probe mock-llm: ${probe.error.message}`);
		if (probe.status === 0) return;
		if (Date.now() > deadline) {
			fail('mock-llm did not become reachable from the shard server container');
		}
	}
}

async function cmdUp(shard, total) {
	const { mode, workers, reason } = capacity();
	console.log(
		`Bringing up ${shardProject(shard)} (web :${shardWebPort(shard)}, shard ${shard}/${total}, ${mode} workers=${workers ?? 'auto'} reason=${reason})`
	);
	const code = compose(shard, ['up', '-d']);
	if (code !== 0) process.exit(code);
	await waitWeb(shardWebPort(shard));
	waitMockLlm(shard);
	console.log(
		`shard ${shard} stack is ready (E2E_BASE_URL=http://127.0.0.1:${shardWebPort(shard)})`
	);
}

function cmdTest(shard, total) {
	const { workers } = capacity();
	const env = {
		...process.env,
		E2E_BASE_URL: `http://127.0.0.1:${shardWebPort(shard)}`
	};
	// Pass the resolved decision explicitly; an operator-supplied cap still wins.
	// Capable mode returns null workers, leaving Playwright at its own default.
	if (workers !== null) env.MAYON_TEST_MAX_WORKERS ??= String(workers);
	const result = spawnSync('pnpm', ['exec', 'playwright', 'test', `--shard=${shard}/${total}`], {
		stdio: 'inherit',
		cwd: repoRoot,
		env
	});
	process.exit(result.status ?? 1);
}

const [cmd, spec] = process.argv.slice(2);
if (cmd === 'up') {
	const { shard, total } = parseShard(spec, { totalRequired: true });
	await cmdUp(shard, total);
} else if (cmd === 'test') {
	const { shard, total } = parseShard(spec, { totalRequired: true });
	cmdTest(shard, total);
} else if (cmd === 'down') {
	const { shard } = parseShard(spec, { totalRequired: false });
	process.exit(compose(shard, ['down']));
} else {
	fail(usage);
}
