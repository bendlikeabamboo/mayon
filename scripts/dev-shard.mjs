#!/usr/bin/env node
// Per-shard E2E runner: one dev stack per Playwright shard so shards can run
// concurrently with zero shared-state races (project mayon-dev-shard-N, web
// host port 5200+N, disjoint volumes/network via the compose project prefix).
//
//   node scripts/dev-shard.mjs up 1/2     # boot shard-1's stack + readiness waits
//   node scripts/dev-shard.mjs test 1/2   # playwright --shard=1/2 vs E2E_BASE_URL=:5201
//   node scripts/dev-shard.mjs down 1     # tear shard-1's stack down
//
// The host-published langfuse-stub receiver is the one port tests hardcode
// (telemetry.spec.ts asserts on 127.0.0.1:9998). Playwright shards whole spec
// files, so exactly one shard owns telemetry.spec.ts; `up` detects the owner
// (`playwright test --list --shard=N/M`) and publishes THAT shard's stub on
// 9998 (other shards get 5500+N, unused host-side). If 9998 is already taken
// — e.g. a running mayon-dev stack — `up` fails with instructions instead of
// leaving the shard stack half-up.
//
// Compose is always invoked through scripts/dev-compose.mjs (--shard=N), so
// engine resolution (MAYON_DEV_ENGINE) stays in one place.

import { spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shardLangfusePort, shardProject, shardWebPort } from './dev-compose.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const devCompose = path.join(repoRoot, 'scripts', 'dev-compose.mjs');

/** Host port tests hardcode for the langfuse-stub receiver (telemetry.spec.ts). */
const SHARED_STUB_PORT = 9998;
const TELEMETRY_SPEC = 'telemetry.spec.ts';
const usage =
	'Usage: node scripts/dev-shard.mjs up|test <shard>/<total> | down <shard>[/<total>] (e.g. up 1/2)';

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

/** True when something already listens on host 127.0.0.1:port. */
function portHeld(port) {
	return new Promise((resolve) => {
		const socket = net.connect({ host: '127.0.0.1', port });
		socket.setTimeout(2000);
		socket.once('connect', () => {
			socket.destroy();
			resolve(true);
		});
		socket.once('timeout', () => {
			socket.destroy();
			resolve(false);
		});
		socket.once('error', () => resolve(false));
	});
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

/** This shard's assigned tests via playwright --list (whole files per shard). */
function listShardTests(shard, total) {
	const result = spawnSync(
		'pnpm',
		['exec', 'playwright', 'test', '--list', `--shard=${shard}/${total}`],
		{ cwd: repoRoot, encoding: 'utf8' }
	);
	if (result.error || result.status !== 0) {
		fail(`playwright --list failed for shard ${shard}/${total}: ${result.stderr ?? result.error}`);
	}
	return result.stdout;
}

async function cmdUp(shard, total) {
	const ownsTelemetry = listShardTests(shard, total).includes(TELEMETRY_SPEC);
	const env = {
		...process.env,
		SHARD_WEB_PORT: String(shardWebPort(shard)),
		SHARD_LANGFUSE_PORT: String(ownsTelemetry ? SHARED_STUB_PORT : shardLangfusePort(shard))
	};
	console.log(
		`Bringing up ${shardProject(shard)} (web :${shardWebPort(shard)}, stub :${env.SHARD_LANGFUSE_PORT}${ownsTelemetry ? ' — owns telemetry' : ''})`
	);
	const code = compose(shard, ['up', '-d'], env);
	if (code !== 0) {
		if (ownsTelemetry && (await portHeld(SHARED_STUB_PORT))) {
			fail(
				`127.0.0.1:${SHARED_STUB_PORT} is already bound — shard ${shard} runs ${TELEMETRY_SPEC}, whose assertions read the stub receiver there. Stop the stack publishing it (e.g. the mayon-dev dev stack) and retry.`
			);
		}
		process.exit(code);
	}
	if (ownsTelemetry) {
		// A retry after a failed 9998 bind can start a half-created stub
		// endpoint whose port never gets programmed (docker quirk) — detect the
		// silent missing listener and recreate just the stub.
		for (let held = await portHeld(SHARED_STUB_PORT), i = 0; !held && i < 3; i++) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			compose(shard, ['up', '-d', '--force-recreate', 'langfuse-stub'], env);
			held = await portHeld(SHARED_STUB_PORT);
		}
		if (!(await portHeld(SHARED_STUB_PORT))) {
			fail(`langfuse-stub did not take 127.0.0.1:${SHARED_STUB_PORT}`);
		}
	}
	await waitWeb(shardWebPort(shard));
	waitMockLlm(shard);
	console.log(
		`shard ${shard} stack is ready (E2E_BASE_URL=http://127.0.0.1:${shardWebPort(shard)})`
	);
}

function cmdTest(shard, total) {
	const result = spawnSync('pnpm', ['exec', 'playwright', 'test', `--shard=${shard}/${total}`], {
		stdio: 'inherit',
		cwd: repoRoot,
		env: { ...process.env, E2E_BASE_URL: `http://127.0.0.1:${shardWebPort(shard)}` }
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
