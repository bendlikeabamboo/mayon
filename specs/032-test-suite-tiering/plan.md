# Implementation Plan: Test Suite Tiering

**Branch**: `032-test-suite-tiering` | **Date**: 2026-11-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/032-test-suite-tiering/spec.md`

## Summary

Restructure the existing 186-file Vitest suite and 37-case Playwright suite into three enforced tiers: an in-process Node tier for logic and server handlers, a real-browser component tier for Svelte interaction and reactivity, and a lean Playwright tier limited to true multi-process integration. Replace 32 source-text "component" tests with real render/interaction coverage, introduce capability-gated parallelism (8 logical CPUs + 8 GiB usable RAM, explicit override), reuse captured session state and seeded fixtures across end-to-end workers, remove fixed waits and external-stub dependencies, and add guardrails plus CI budgets so the structure cannot regress.

## Technical Context

**Language/Version**: TypeScript 6.x on Node 22 (pinned), Svelte 5 runes, pnpm 10

**Primary Dependencies**: Vitest 4.1 (existing), Playwright 1.62 (existing), plus development-only `@vitest/browser-playwright`, `vitest-browser-svelte`, and `msw`; the Fastify server package keeps its in-process `inject` harness

**Storage**: pglite for in-process tests; the existing Docker Postgres stack for end-to-end tests; no storage change in the feature

**Testing**: Vitest projects for Tier 1 (Node) and Tier 2 (browser), Playwright for Tier 3; server tests remain in `server/` and run through `pnpm --filter @mayon/server test`

**Target Platform**: Linux developer machines and GitHub Actions runners; Chromium for browser/component and end-to-end execution

**Project Type**: Static SvelteKit SPA (`src/`) plus a separate Node/Fastify server (`server/`), with a shared package (`packages/shared`)

**Performance Goals**: Tier 1 < 60 s, Tier 2 < 120 s on an 8-CPU/8-GiB reference machine; Tier 3 < 8 min across four capable CI shard runners; no browser process in Tier 1

**Constraints**: Parallelism only above 8 logical CPUs and 8 GiB usable RAM, with serial fallback on low-spec or unknown hardware; no shipped runtime dependency; `+` filename prefix remains forbidden for tests; low-spec runs 100% of tests

**Scale/Scope**: 186 existing unit/integration files, 32 source-text component/route files, 10 end-to-end spec files (37 cases), 2 CI shards to become 4

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Result |
|---|---|---|
| I. Code quality | Tests and helpers must not import `db` from app code; the `StorageDriver` seam is untouched; `pnpm check` and `pnpm lint` stay green; no `+`-prefixed test files; Node 22/pnpm 10 respected | PASS — tests move between runners; production boundaries unchanged |
| II. Testing standards | `pnpm test` must pass; server changes must pass the server suite; bug fixes ship regression tests; new `src/lib` and `server/src` behavior keeps tests; no writes to `search_vec` | PASS — tier split preserves `pnpm test` as the aggregate gate; server suite stays separate |
| III. UX consistency | UI patterns and progressive capability detection untouched; expound/markdown invariants preserved | PASS — no runtime behavior change; component tests adopt the existing vocabulary |
| IV. Performance | Performance claims measured; generated FTS columns untouched; no bundle growth | PASS — development-only dependencies; suite budgets are measured and enforced |
| Quality gates | `pnpm check`, `pnpm lint`, `pnpm test`, server tests remain merge blockers; release flow untouched | PASS — new tier commands are additive and `pnpm test` stays the umbrella |
| Governance | No documented seam is changed; AGENTS.md mechanics updated alongside the feature | PASS — test architecture is not a runtime seam; docs update is part of FR-022 |

**Post-design re-check**: PASS. The design adds only development tooling and test files, keeps the storage and runtime seams intact, and updates contributor guidance in the same change.

## Project Structure

### Documentation (this feature)

```text
specs/032-test-suite-tiering/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── tier-placement.md
│   ├── capacity-gate.md
│   ├── test-commands.md
│   ├── e2e-session-state.md
│   └── guardrails.md
└── tasks.md              # Phase 2 output, not created here
```

### Source Code (repository root)

```text
src/
├── **/*.test.ts                 # Tier 1: Node, colocated
├── **/*.browser.test.ts         # Tier 2: real Chromium, colocated, NEW suffix
├── lib/components/**/*.svelte   # subjects of Tier 2 tests
└── routes/**/*.svelte           # route-level subjects; no +page.server.ts exists

server/
└── src/**/*.test.ts             # Tier 1: Fastify inject, existing package runner

tests/
├── e2e/                         # Tier 3: only critical integration specs
│   ├── global-setup.ts          # NEW: seed + session capture
│   ├── fixtures/                # session/network/seed fixtures
│   └── *.spec.ts
└── mocks/                       # NEW: MSW handlers + service worker asset
    ├── handlers.ts
    ├── node.ts
    ├── browser.ts
    └── public/mockServiceWorker.js

scripts/
├── test-capacity.mjs            # NEW: hardware/cgroup probe + override
├── test-capacity.test.ts        # NEW: capability-gate unit tests
├── check-test-tiers.mjs         # NEW: guardrail checks
└── check-test-budget.mjs        # NEW: per-tier duration gate

test-budgets.json                # NEW: per-tier budget source of truth
vitest.config.ts                 # MODIFIED: projects: unit + browser
playwright.config.ts             # MODIFIED: setup project, parallelism, shards
```

**Structure Decision**: Keep tests colocated with their subjects, matching the existing repository convention. Tier 2 uses a distinct `*.browser.test.ts` suffix because `*.svelte.test.ts` is already taken by rune-module/store tests (for example `src/lib/stores/chat.svelte.test.ts`) and must not be reclassified by accident. End-to-end helpers and MSW assets live under the existing `tests/` tree.

## Phase 0 — Research (summary)

Full decisions and alternatives are in [research.md](./research.md). Key outcomes:

1. **Tier suffix**: `*.browser.test.ts` for real-browser component tests; existing `*.test.ts` stays Node. Rejected `*.svelte.test.ts` because it collides with existing rune-module tests.
2. **Browser harness**: Vitest 4 browser mode with `@vitest/browser-playwright` and `vitest-browser-svelte`; rejects jsdom for behavior because it does not exercise real layout, focus, or browser APIs.
3. **Projects layout**: one root `vitest.config.ts` with two Vitest projects (`unit`, `browser`) sharing the Vite/Svelte pipeline; `pnpm test` runs both, and per-tier commands filter the project.
4. **Capacity gate**: a shared Node helper reads CPU, host memory, and cgroup limits; low-spec means <8 logical CPUs or <8 GiB usable RAM; `MAYON_TEST_PARALLEL=auto|on|off` and `MAYON_TEST_MAX_WORKERS` override. Unknown readings default to serial.
5. **Component-network mocking**: MSW at the fetch boundary, shared handlers for Node and browser, with the worker asset served only by the test Vite server.
6. **End-to-end state**: a Playwright `setup` project captures `storageState` (setup dismissal + auth cookies) and seeds shared provider state; worker-indexed provider ids isolate parallel workers; specs that intentionally clear global settings run in a dedicated serial project.
7. **Telemetry**: replace the external langfuse-stub end-to-end test with Tier 1 ingest assertions plus a route-intercepted client-emission check, removing the port-ownership special case from sharding.
8. **Source-text tests**: 32 files are classified into convert-to-browser, delete-as-redundant, and promote-to-named-static-check; a migration ledger records every disposition.
9. **Budgets**: CI runs `test:ci` (tiers 1/2/server) and `test:e2e:ci` per shard (tier 3), records durations, and fails against `test-budgets.json`; local `pnpm test` stays fast and unburdened.

## Phase 1 — Design

Artifacts produced:

- [data-model.md](./data-model.md) — tier, migration ledger, session-state fixture, budget, and guardrail entities.
- [contracts/tier-placement.md](./contracts/tier-placement.md) — naming, globs, allowed dependencies, migration rules.
- [contracts/capacity-gate.md](./contracts/capacity-gate.md) — probe inputs, thresholds, overrides, and reported output.
- [contracts/test-commands.md](./contracts/test-commands.md) — commands, exit codes, duration report shape.
- [contracts/e2e-session-state.md](./contracts/e2e-session-state.md) — setup project, storage-state file, seeding and isolation rules.
- [contracts/guardrails.md](./contracts/guardrails.md) — check IDs, failure messages, escape-hatch policy.
- [quickstart.md](./quickstart.md) — runnable validation scenarios for every success criterion.

## Complexity Tracking

No constitution violations. No new production projects, services, seams, or shipped dependencies are introduced.
