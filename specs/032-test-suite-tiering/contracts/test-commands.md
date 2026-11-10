# Contract: Test Commands

**Feature**: `032-test-suite-tiering` | **Status**: Draft

## Commands

| Command | Tier | Behavior |
|---|---|---|
| `pnpm test` | 1 + 2 | Both Vitest projects, capability-gated; the local merge gate |
| `pnpm test:unit` | 1 | Node project only; no browser process |
| `pnpm test:browser` | 2 | Chromium project only |
| `pnpm test:watch` | 1 + 2 | Watch mode for local iteration |
| `pnpm test:low-spec` | 1 + 2 | Forces serial/one-worker mode, still selects every test |
| `pnpm test:e2e` | 3 | Playwright against `E2E_BASE_URL`; capabilities from the gate |
| `pnpm test:ci` | 1 + 2 + server | Non-e2e CI wrapper; writes `test-results/tier-durations.json` owning tier1/tier2/server and marking tier3 `deferred` |
| `pnpm test:e2e:ci` | 3 | Shard-aware wrapper; writes `test-results/tier3-shard-<n>.json` with that shard's wall-clock |
| `pnpm check:budget` | — | Validates only the tiers owned by the current job |
| `pnpm test:integration` | opt-in | Live-provider and other environment-dependent checks |
| `pnpm --filter @mayon/server test` | 1 (server) | Fastify handler suite, unchanged |
| `pnpm test:all` | all | Unit + browser + server (existing workspace command) |
| `pnpm check:tests` | guardrails | Tier/import/wait/naming checks; exit 2 on violation |

`test:e2e` continues to require a running dev/e2e stack (see quickstart). It does not boot docker compose itself.

## Environment

| Variable | Used by | Meaning |
|---|---|---|
| `MAYON_TEST_PARALLEL` | all runners | `auto` (default), `on`, `off` |
| `MAYON_TEST_MAX_WORKERS` | all runners | Positive integer cap |
| `VITEST_MAX_WORKERS` / `VITEST_MIN_WORKERS` / `VITEST_FILE_PARALLELISM` | Vitest | Existing knobs; the gate sets defaults and explicit values still win |
| `E2E_BASE_URL` | Playwright | Base URL of the running stack |
| `MAYON_TEST_UPDATE_STATE` | Playwright setup | `1` forces a session-state recapture |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | All selected tests passed and budgets met |
| 1 | At least one test failed |
| 2 | Configuration/guardrail failure (invalid tier placement, bad env var) |
| 3 | Budget breach in `test:ci` or `test:e2e:ci` |

## Duration report

`pnpm test:ci` writes `test-results/tier-durations.json`:

```json
{
  "generatedAt": "2026-11-10T00:00:00.000Z",
  "reference": "8cpu/8GiB",
  "capability": {
    "mode": "capable",
    "logicalCpus": 8,
    "usableMemoryBytes": 8589934592,
    "override": "auto",
    "workers": 4
  },
  "tiers": [
    { "id": "tier1", "budgetSeconds": 60, "measuredSeconds": 41.2, "status": "pass" },
    { "id": "tier2", "budgetSeconds": 120, "measuredSeconds": 88.5, "status": "pass" },
    { "id": "server", "budgetSeconds": 120, "measuredSeconds": 54.0, "status": "pass" }
  ],
  "deferred": [{ "id": "tier3", "owner": "test:e2e:ci" }]
}
```

`pnpm test:e2e:ci -- --shard=<n>/<total>` writes `test-results/tier3-shard-<n>.json`:

```json
{
  "shard": 1,
  "total": 4,
  "budgetSeconds": 120,
  "measuredSeconds": 96.4,
  "status": "pass"
}
```

Rules:

- `test:ci` owns tier1, tier2, and server; `test:e2e:ci` owns tier3.
- A missing tier that the current command owns is a failure; a tier owned by another CI job is reported as `deferred`, not failed.
- `status` is `over-budget` when `measuredSeconds > budgetSeconds`; the owning command exits 3.
- `budgetSeconds` is the effective budget: the reference budget from `test-budgets.json`, multiplied by `lowSpecMultiplier` (default 2) when the capability gate reports low-spec or unknown. `referenceBudgetSeconds` records the unscaled 8-CPU/8-GiB target.
- Tier 3 budget is enforced per shard: each shard ≤ 120 s at the reference tier (240 s on low-spec), four shards ⇒ ≤ 480 s of work and ≤ 120 s wall-clock. The e2e job fails if any shard exceeds the effective budget.
- Budgets live in `test-budgets.json` at the repository root and are the single source of truth.
- The report is uploaded as a CI artifact even when the job fails.

## Compatibility

- `pnpm test` keeps its meaning as the merge gate required by the constitution.
- `pnpm test:low-spec` remains available and now also implies the capacity gate's low-spec policy.
- Watch mode never enforces budgets.
- A developer can override parallelism without editing config.
