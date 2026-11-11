import path from 'node:path';

export interface ComposeProjectEntry {
	Name: string;
	ConfigFiles: string;
}

export interface SelectComposeProjectOptions {
	/** Runner target; defaults to `process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173'`. */
	baseUrl?: string;
	/** Where this checkout's compose files resolve; defaults to `process.cwd()`. */
	repoRoot?: string;
}

const BASE_DEV_PORT = 5173;
const SHARD_PORT_BASE = 5200;
const SHARD_PORT_MAX = 5299;
const BASE_PROJECT = 'mayon-dev';

/**
 * Project name the runner's base URL implies (5173 → mayon-dev; 5200+N →
 * mayon-dev-shard-N), mirroring shardProject/shardWebPort in
 * scripts/dev-compose.mjs.
 */
export function expectedComposeProjectName(baseUrl: string): string {
	let url: URL;
	try {
		url = new URL(baseUrl);
	} catch {
		throw new Error(`invalid baseUrl '${baseUrl}' — expected an absolute http URL`);
	}
	const port = Number(url.port);
	if (Number.isInteger(port) && port === BASE_DEV_PORT) return BASE_PROJECT;
	if (Number.isInteger(port) && port > SHARD_PORT_BASE && port <= SHARD_PORT_MAX) {
		return `mayon-dev-shard-${port - SHARD_PORT_BASE}`;
	}
	throw new Error(
		`port '${url.port || '(none)'}' in baseUrl '${baseUrl}' is not a mayon dev-stack port — expected 5173 (mayon-dev) or 5201-5299 (mayon-dev-shard-N)`
	);
}

/**
 * The compose project this runner targets: found by exact expected Name, then
 * verified to mount this checkout's compose files (base + shard override for
 * shards). Throws (never falls back) naming the expected project and the
 * mismatch when not found or misconfigured.
 */
export function selectComposeProject(
	projects: ComposeProjectEntry[],
	options?: SelectComposeProjectOptions
): ComposeProjectEntry {
	const baseUrl = options?.baseUrl ?? process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
	const repoRoot = options?.repoRoot ?? process.cwd();
	const expectedName = expectedComposeProjectName(baseUrl);
	const baseFile = path.join(repoRoot, 'docker-compose.dev.yml');
	const shardOverride = path.join(repoRoot, 'docker-compose.dev.shard.yml');
	const required = expectedName === BASE_PROJECT ? [baseFile] : [baseFile, shardOverride];

	const found = projects.find((p) => p.Name === expectedName);
	if (!found) {
		const saw = projects.map((p) => p.Name).join(', ') || '(nothing running)';
		throw new Error(
			`no running compose project named '${expectedName}' (baseUrl ${baseUrl}) — start this checkout's stack first (pnpm dev, or pnpm dev:shard:up); compose ls saw: ${saw}`
		);
	}
	const configured = found.ConfigFiles.split(',').map((f) => f.trim());
	const missing = required.filter((file) => !configured.includes(file));
	if (missing.length > 0) {
		throw new Error(
			`compose project '${expectedName}' is running but not from this checkout (repoRoot ${repoRoot}) — its ConfigFiles '${found.ConfigFiles}' do not include ${missing.join(' and ')}`
		);
	}
	return found;
}
