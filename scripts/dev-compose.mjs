#!/usr/bin/env node
// Dev-command engine dispatch for the mayon dev stack (FR-010/FR-014).
//
// Single shared mechanism behind `pnpm dev`, `dev:up`, `dev:down`, `dev:build`:
// resolves the container engine (MAYON_DEV_ENGINE override → auto-detect,
// Docker preferred), then forwards the remaining args verbatim to
// `$ENGINE compose -p mayon-dev -f docker-compose.dev.yml <args…>`.
//
// `--shard=N` as the first arg retargets the invocation at a per-shard stack:
// project mayon-dev-shard-N plus the shard port override file (ports required
// by it are derived from N). Everything else is identical to the base stack.
//
// Resolution is per-invocation and persists nothing (stateless by design):
// dev has no install-of-record, and engine-scoped volumes/caches reset when
// switching engines — documented caveat, not gated. Shell aliases are NOT
// consulted (FR-012): real binaries are probed only.

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Project name of the shard-N dev stack (volumes/network prefix off it). */
export const shardProject = (shard) => `mayon-dev-shard-${shard}`;
/** Host port of shard N's web (Playwright E2E_BASE_URL target). */
export const shardWebPort = (shard) => 5200 + shard;
/** Host port of shard N's langfuse-stub receiver. */
export const shardLangfusePort = (shard) => 5500 + shard;

function isMain() {
	try {
		return import.meta.url === pathToFileURL(process.argv[1]).href;
	} catch {
		return false;
	}
}

const validEngines = ['docker', 'podman'];

function fail(message) {
	console.error(`✗ ${message}`);
	process.exit(1);
}

function binaryExists(binary) {
	// `command -v` is a shell builtin, so probe through a shell. `where` is the
	// Windows equivalent.
	const probe =
		process.platform === 'win32'
			? spawnSync('cmd', ['/c', 'where', binary], { stdio: 'ignore' })
			: spawnSync('/bin/sh', ['-c', `command -v ${binary}`], { stdio: 'ignore' });
	return probe.status === 0;
}

/** MAYON_DEV_ENGINE override → auto-detect (docker preferred); null if none. */
export function resolveEngine() {
	const requested = process.env.MAYON_DEV_ENGINE;
	if (requested !== undefined && requested !== '') {
		if (!validEngines.includes(requested)) {
			fail(`Invalid MAYON_DEV_ENGINE='${requested}'. Valid values: docker | podman.`);
		}
		return { engine: requested, source: 'override' };
	}
	if (binaryExists('docker')) return { engine: 'docker', source: 'detected' };
	if (binaryExists('podman')) return { engine: 'podman', source: 'detected' };
	return null;
}

function main() {
	const args = process.argv.slice(2);
	if (args.length === 0) {
		fail(
			'Usage: node scripts/dev-compose.mjs [--shard=N] <compose-args…> (e.g. up | up -d | down | build)'
		);
	}

	let shard = null;
	if (args[0]?.startsWith('--shard=')) {
		shard = Number(args.shift().slice('--shard='.length));
		if (!Number.isInteger(shard) || shard < 1) {
			fail(`Invalid shard '${shard}'. Expected a positive integer, e.g. --shard=1.`);
		}
	}

	const projectName = shard === null ? 'mayon-dev' : shardProject(shard);
	const composeFiles = [path.join(repoRoot, 'docker-compose.dev.yml')];
	const env = { ...process.env };
	if (shard !== null) {
		composeFiles.push(path.join(repoRoot, 'docker-compose.dev.shard.yml'));
		// Defaults only — an explicit SHARD_* env (e.g. dev-shard.mjs pinning the
		// telemetry-owning shard's stub to 9998) passes through untouched.
		env.SHARD_WEB_PORT ??= String(shardWebPort(shard));
		env.SHARD_LANGFUSE_PORT ??= String(shardLangfusePort(shard));
	}

	const resolved = resolveEngine();
	if (!resolved) {
		fail(
			'No container engine found. Install one of: docker (https://docs.docker.com/get-docker/) or podman (https://podman.io; also install a compose provider, e.g. the podman-compose package).'
		);
	}
	const { engine, source } = resolved;
	console.log(`Using engine: ${engine} (source: ${source})`);

	const fileArgs = composeFiles.flatMap((file) => ['-f', file]);
	const child = spawn(engine, ['compose', '-p', projectName, ...fileArgs, ...args], {
		stdio: 'inherit',
		env
	});
	child.on('error', (err) => {
		fail(`Could not run '${engine} compose': ${err.message}`);
	});
	child.on('close', (code) => {
		process.exit(code ?? 1);
	});
}

if (!isMain()) {
	// Imported for the shard helpers — do not run dispatch.
} else {
	main();
}
