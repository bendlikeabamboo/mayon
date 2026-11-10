# Phase 1 Data Model: Test Suite Tiering

**Feature**: `032-test-suite-tiering` | **Date**: 2026-11-10

This feature has no runtime data model. The entities below describe the test-suite artifacts the implementation must produce, validate, and keep consistent.

## TestTier

Represents one execution layer.

| Field | Type | Rules |
|---|---|---|
| `id` | `'tier1' \| 'tier2' \| 'tier3'` | Exactly three tiers; stable identifiers |
| `name` | string | Human label: in-process logic, real-browser component, end-to-end integration |
| `filePattern` | glob | Tier 1: `**/*.test.ts` excluding `**/*.browser.test.ts`; Tier 2: `**/*.browser.test.ts`; Tier 3: `tests/e2e/**/*.spec.ts` |
| `environment` | `'node' \| 'browser' \| 'full-stack'` | Must match the tier's isolation level |
| `command` | string | Per-tier command from `contracts/test-commands.md` |
| `budgetSeconds` | integer | Must be positive; from `test-budgets.json` |
| `buildsApp` | boolean | Tier 1 and Tier 2 must be `false`; Tier 3 `true` |
| `usesBrowser` | boolean | Tier 1 `false`; Tier 2 and Tier 3 `true` |
| `usesNetworkListener` | boolean | Tier 1 `false` except transport-subject tests; Tier 2 `false`; Tier 3 `true` |
| `parallelismPolicy` | `ConcurrencyPolicy` | Derived from the capability profile |

**Validation rules**

- Tier 1 cannot include a file matching the Tier 2 suffix.
- Tier 2 cannot require the application server, the primary database, or the end-to-end stack.
- Tier 3 cannot contain a test whose behavior is fully asserted at a lower tier.
- `pnpm test` must execute Tier 1 and Tier 2; the server package suite is a separate required gate.

**State transitions**: a test file is classified → implemented at its tier → verified (fails when its behavior is broken) → either retained or retired with a ledger entry.

## TestUnit

A single test file under management.

| Field | Type | Rules |
|---|---|---|
| `path` | repo-relative path | Unique; must not start with `+` |
| `tier` | `tier1 \| tier2 \| tier3` | Must match `filePattern` |
| `subject` | string | Module, component, handler, or flow under test |
| `claimsBehavior` | boolean | `true` only if it exercises the subject rather than reading its source |
| `usesFixedWait` | boolean | Must be `false` for Tier 3 |
| `requiresExternalService` | boolean | Must be `false` in default Tier 1/Tier 3 runs |

**Validation rules**

- A `TestUnit` with `claimsBehavior = true` must not rely on source-text assertions.
- A Tier 3 unit must be runnable alone and under any shard assignment.
- A Tier 1 unit must not import a browser project package.

## MigrationLedgerEntry

One row per file affected by the refactor.

| Field | Type | Rules |
|---|---|---|
| `sourceFile` | path | Must currently exist at classification time |
| `subject` | string | Component, route, or module |
| `claimedBehavior` | string | What the current test claims to protect |
| `disposition` | `'convert' \| 'delete' \| 'promote-static' \| 'retain'` | Every removed test needs a row |
| `replacementPath` | path or check id | Required for `convert` and `promote-static`; null for `delete` with a written rationale |
| `rationale` | string | Required for `delete`; must explain why coverage is redundant or retired |
| `verified` | boolean | `true` only after the replacement fails when the behavior is broken |

**Validation rules**

- The ledger must cover all 32 source-text component/route files.
- No `delete` row may be the only coverage for a user-visible behavior; such a row must instead have `disposition = convert`.
- `promote-static` rows must name a guardrail check ID from `contracts/guardrails.md`.
- The total of `convert` + `promote-static` + `delete` + `retain` equals the classified set; no duplicates.

## CapabilityProfile

The hardware decision made once per run.

| Field | Type | Rules |
|---|---|---|
| `logicalCpus` | integer | ≥ 1; from OS or cgroup quota, whichever is lower |
| `usableMemoryBytes` | integer | ≥ 1; from host or cgroup limit, whichever is lower |
| `signals` | string[] | Records which sources were read, e.g. `os.availableParallelism`, `cgroup-v2-memory.max` |
| `mode` | `'capable' \| 'low-spec' \| 'unknown'` | `capable` iff CPUs ≥ 8 **and** memory ≥ 8 GiB |
| `reason` | string | Human-readable explanation of the decision |
| `override` | `'auto' \| 'on' \| 'off'` | Default `auto`; from `MAYON_TEST_PARALLEL` |
| `maxWorkers` | integer or null | From `MAYON_TEST_MAX_WORKERS`; null when auto |

**Validation rules**

- `mode = capable` requires both thresholds; meeting only one is `low-spec`.
- Unreadable or contradictory signals resolve to `unknown`, which behaves as serial.
- An override changes the effective mode but must be printed in the run output.
- The effective worker count must never exceed the resolved `maxWorkers` or the capability-derived limit.

## ConcurrencyPolicy

The per-runner consequence of a `CapabilityProfile`.

| Field | Type | Rules |
|---|---|---|
| `runner` | `'vitest' \| 'playwright' \| 'shards'` | One policy per runner |
| `workers` | integer | `1` for low-spec/unknown; capability-derived for capable |
| `fileParallelism` | boolean | `false` for low-spec/unknown; `true` for capable |
| `fullyParallel` | boolean | Playwright only; `false` for low-spec/unknown |
| `reported` | boolean | Must be logged at run start |

**Validation rules**

- Low-spec/unknown may reduce concurrency but must not change test selection.
- A shard runner must itself be capable; the shard count is a distribution choice, not a capacity substitute.

## SessionStateFixture

The reusable Tier 3 browser state and seed.

| Field | Type | Rules |
|---|---|---|
| `path` | path | `test-results/.auth/state.json` (generated, not committed) |
| `producedBy` | `'playwright-setup-project'` | Exactly one producer per run |
| `cookies` | serialized cookies | Must include the auth session when the server is locked |
| `localStorage` | key/value map | Must include `mayon_setup_dismissed = '1'` when the gate is offered |
| `seededSettings` | list | Provider/active-provider seed applied once per run |
| `workerScopedIds` | list | Resources namespaced by `workerIndex` to isolate parallel workers |
| `freshness` | `'fresh' \| 'stale' \| 'missing'` | `stale`/`missing` triggers one recapture |

**Validation rules**

- A Tier 3 test must not perform the first-run setup journey when a fresh fixture exists.
- The fixture must never contain secrets committed to the repository.
- Provider-mutating specs must use worker-scoped ids or run in the dedicated serial project.

## TierBudget

| Field | Type | Rules |
|---|---|---|
| `tier` | tier id | Unique |
| `owner` | `'test:ci' \| 'test:e2e:ci'` | The CI job that measures and enforces this tier |
| `budgetSeconds` | integer | Tier 1 ≤ 60, Tier 2 ≤ 120, Tier 3 ≤ 120 per shard (4 × 120 = 480 total work), server ≤ 120 |
| `measuredSeconds` | number | Produced per run by the owning job |
| `status` | `'pass' \| 'over-budget' \| 'deferred'` | `over-budget` fails the owning job; `deferred` is valid only for a tier owned by another job |
| `reference` | string | Identifies the reference hardware |

**Validation rules**

- A missing measurement for a tier the current job owns is a failure; a tier marked `deferred` to another job is not.
- Budgets are enforced only in CI; local runs report but do not fail.

## Guardrail

| Field | Type | Rules |
|---|---|---|
| `id` | `TT-001`…`TT-006` | Stable, never reused |
| `rule` | string | One sentence |
| `scope` | glob | Files or configs the rule inspects |
| `failureMessage` | string | Must name the file and the rule |
| `exemptions` | list | Each exemption requires a justification |
| `runsIn` | `'lint' \| 'test:ci' \| 'check'` | At least `test:ci` |

**Validation rules**

- New anti-patterns are added as a new ID, not by rewriting an existing rule.
- An exemption without a non-empty justification is itself a violation.

## NetworkPolicy (Tier 3 and Tier 2)

| Field | Type | Rules |
|---|---|---|
| `allowedOrigins` | string[] | App origin, mock LLM origin, in-process test origin |
| `blockedCategories` | string[] | Third-party fonts, analytics, external CDNs/assets |
| `mswHandlers` | path | Shared handler module used by both tiers |
| `serviceWorkerAsset` | path | Test-only; must not appear in the production build |

**Validation rules**

- Blocking must not intercept allowed origins.
- MSW handlers take precedence over blanket blocking for API routes.
- A request to a non-allowed origin that is not explicitly classified fails the test.

## Relationship summary

```text
TestTier 1 ── * TestUnit
TestUnit 1 ── 0..1 MigrationLedgerEntry
CapabilityProfile 1 ── * ConcurrencyPolicy
TestTier 1 ── 1 TierBudget
SessionStateFixture 1 ── * Tier3 TestUnit (uses)
Guardrail * ── * TestUnit (scopes)
NetworkPolicy 1 ── * Tier2/Tier3 TestUnit (applies)
```
