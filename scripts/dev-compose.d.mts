/**
 * Types for scripts/dev-compose.mjs (imported by typechecked e2e specs).
 * Keep in sync with the implementation.
 */

/** MAYON_DEV_ENGINE override → auto-detect (docker preferred); null if none. */
export function resolveEngine(): {
	engine: 'docker' | 'podman';
	source: 'override' | 'detected';
} | null;

/** Project name of the shard-N dev stack (volumes/network prefix off it). */
export const shardProject: (shard: number) => string;
/** Host port of shard N's web (Playwright E2E_BASE_URL target). */
export const shardWebPort: (shard: number) => number;
/** Host port of shard N's langfuse-stub receiver. */
export const shardLangfusePort: (shard: number) => number;
