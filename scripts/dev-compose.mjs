#!/usr/bin/env node
// Dev-command engine dispatch for the mayon dev stack (FR-010/FR-014).
//
// Single shared mechanism behind `pnpm dev`, `dev:up`, `dev:down`, `dev:build`:
// resolves the container engine (MAYON_DEV_ENGINE override → auto-detect,
// Docker preferred), then forwards the remaining args verbatim to
// `$ENGINE compose -p mayon-dev -f docker-compose.dev.yml <args…>`.
//
// Resolution is per-invocation and persists nothing (stateless by design):
// dev has no install-of-record, and engine-scoped volumes/caches reset when
// switching engines — documented caveat, not gated. Shell aliases are NOT
// consulted (FR-012): real binaries are probed only.

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = path.join(repoRoot, 'docker-compose.dev.yml');
const projectName = 'mayon-dev';
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

function resolveEngine() {
	const requested = process.env.MAYON_DEV_ENGINE;
	if (requested !== undefined && requested !== '') {
		if (!validEngines.includes(requested)) {
			fail(`Invalid MAYON_DEV_ENGINE='${requested}'. Valid values: docker | podman.`);
		}
		return { engine: requested, source: 'override' };
	}
	if (binaryExists('docker')) return { engine: 'docker', source: 'detected' };
	if (binaryExists('podman')) return { engine: 'podman', source: 'detected' };
	fail(
		'No container engine found. Install one of: docker (https://docs.docker.com/get-docker/) or podman (https://podman.io; also install a compose provider, e.g. the podman-compose package).'
	);
}

const args = process.argv.slice(2);
if (args.length === 0) {
	fail('Usage: node scripts/dev-compose.mjs <compose-args…> (e.g. up | up -d | down | build)');
}

const { engine, source } = resolveEngine();
console.log(`Using engine: ${engine} (source: ${source})`);

const child = spawn(engine, ['compose', '-p', projectName, '-f', composeFile, ...args], {
	stdio: 'inherit'
});
child.on('error', (err) => {
	fail(`Could not run '${engine} compose': ${err.message}`);
});
child.on('close', (code) => {
	process.exit(code ?? 1);
});
