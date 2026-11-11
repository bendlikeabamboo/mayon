# Contract: test helpers introduced by 038

This feature is internal test infrastructure; the interfaces it exposes to
other tests are its contracts. Three helpers, one per created mechanism.

## 1. Compose-project selector — `src/lib/dev/compose-project.ts`

```ts
/** Project name the runner's base URL implies (5173 → mayon-dev; 5200+N → mayon-dev-shard-N). */
export function expectedComposeProjectName(baseUrl: string): string;

export interface ComposeProjectEntry {
	Name: string;
	ConfigFiles: string;
}

export interface SelectComposeProjectOptions {
	baseUrl?: string;   // default: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173'
	repoRoot?: string;  // default: process.cwd() — where docker-compose.dev.y*ml resolve
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
): ComposeProjectEntry;
```

Consumers: `tests/e2e/image-round-trip.spec.ts` (mock log scrape);
`src/lib/dev/compose-project.test.ts` (unit tier, synthetic listings).

Guarantees: with any number of sibling shard stacks and/or the base stack
running concurrently, returns the entry for the project implied by `baseUrl`
and this checkout's files only.

## 2. Discovery merge — `src/lib/ai/model-discovery.ts`

```ts
/**
 * Discovered catalog merged ahead of stored manual additions: discovered IDs
 * first in discovery order, deduplicated, existing models not already
 * discovered appended in stored order. Empty `discovered` returns `existing`
 * unchanged.
 */
export function mergeDiscoveredModels(discovered: string[], existing: string[]): string[];
```

Consumers: `ProviderConfig.svelte` `refreshModels` (was `:215`) and
`testConnection` (was `:272`); `connection-test.test.ts` persisted-settings
merge check (was `:352`).

Guarantees: exactly one implementation of the rule exists in the codebase; the
parity test and both shipped paths call it.

## 3. Mirror registry — `src/lib/ai/generate/classification-markers.test.ts`

```ts
/** One entry per patrolled mirror of the shared fixture strings (spec FR-003/FR-004). */
const MIRRORS: ReadonlyArray<{
	label: string;              // human name in assertion messages
	path: string;               // repo-relative file URL resolved against the suite
	constants: readonly string[]; // names exported by tests/fixtures/mock-llm/strings.mjs
}>;
```

Invariants: every entry's file source must contain the byte-exact value of
each listed constant (catches fixture-side renames and mirror-side retypes in
one assertion); adding a mirror means adding one registry entry — no other
edit. Initial registry (research R2/D3):

| Mirror file | Constants |
| --- | --- |
| `src/lib/stores/chat.svelte.test.ts` | `PROPAGATE_TRIGGER`, `PROPAGATE_UNAVAILABLE_REPLY`, `PROPAGATE_TOOL_NAME` |
| `src/lib/stores/quizzes.svelte.test.ts` | `LEVER_TRIGGER_CORRECT`, `LEVER_TRIGGER_WRONG` |
| `src/lib/agent/loop.test.ts` | `PROPAGATE_TOOL_NAME` |

(`server.mjs` and `kitchen-sink.ts` keep their existing stronger
import-reexport guards — they are producers, not mirrors.)
