# Quickstart: Test Suite Tiering

**Feature**: `032-test-suite-tiering` | **Date**: 2026-11-10

Validation guide for the implementation. Details live in [data-model.md](./data-model.md) and [contracts/](./contracts/); this file is the run guide, not a second specification.

## Prerequisites

```bash
pnpm install
pnpm --filter @mayon/shared build
pnpm exec playwright install --with-deps chromium   # once per machine/CI image
```

For Tier 3, a running stack is required:

```bash
pnpm dev:up                 # or pnpm dev:shard:up 1/2 for a shard stack
# Tier 3 default base URL: http://127.0.0.1:5173
```

## S1 — Tier 1 is instant and browser-free

```bash
time pnpm test:unit
```

Expected:

- All Node tests pass in under 60 s on an 8-CPU/8-GiB machine.
- No Chromium process starts (check the run output for the `[test-capacity]` line and use `pgrep -f chrome` before/after if needed).
- The command selects the same Node tests as before minus the migrated component files.

Break it: introduce a defect in a pure helper and a Fastify handler; both must fail in Tier 1 within seconds.

## S2 — Tier 2 renders real components

Add or migrate one component test:

```text
src/lib/components/chat/Breadcrumb.browser.test.ts
```

It must:

- `render(Breadcrumb, { … })` through `vitest-browser-svelte`;
- query via `screen.getByRole(...)` / `getByTestId(...)`;
- assert with auto-retrying `expect.element(...)`;
- pass without the app server or Postgres.

```bash
time pnpm test:browser
```

Expected: under 120 s on the reference machine; a deliberately broken interaction fails without touching Tier 3.

## S3 — Source-text test migration is complete

```bash
pnpm check:tests            # guardrail script
```

Expected:

- Zero `readFileSync`-based behavioral assertions under `*.browser.test.ts`.
- Zero files claiming `render`/`mount`/`anatomy` behavior without rendering.
- The migration ledger in the implementation PR covers all 32 classified files, each with a disposition and replacement/rationale.

Spot-check three conversions by breaking the rendered behavior and confirming the new test fails.

## S4 — End-to-end is lean and reuses state

```bash
pnpm dev:up
time pnpm test:e2e
```

Expected:

- The Playwright `setup` project runs once and writes `test-results/.auth/state.json`.
- No spec replays the first-run setup; no `waitForTimeout`/sleep exists in `tests/e2e`.
- `fullyParallel: true`; `workers` equals the capability-derived value.
- The suite passes when each spec file is run alone.
- The removed telemetry/live-stub dependency no longer requires port 9998.

Isolation check:

```bash
pnpm exec playwright test tests/e2e/provider-picker.spec.ts
pnpm exec playwright test tests/e2e/render.spec.ts
```

Both must pass independently and in either order.

Shard check (CI-style):

```bash
pnpm dev:shard:up 1/4 && pnpm dev:shard:test 1/4
pnpm dev:shard:up 2/4 && pnpm dev:shard:test 2/4
# … repeat per shard; each runner must be capable
```

## S5 — Capability gate behaves correctly

Force low-spec and confirm the full selection still runs:

```bash
MAYON_TEST_PARALLEL=off pnpm test
```

Expected run-start line:

```text
[test-capacity] mode=low-spec … workers=1 reason=override-off
```

- One worker, no file parallelism, 100% of tests selected.
- No test is skipped.
- Tier 3 runs with `workers: 1` and `fullyParallel: false`.

Force a worker cap on a capable machine:

```bash
MAYON_TEST_MAX_WORKERS=2 pnpm test
```

Expected: the reported worker count is 2, and no more than 2 workers run.

Simulate an unknown reading (unit-test the helper with unreadable signals) and confirm it resolves to serial.

## S6 — Guardrails reject regressions

Introduce each violation, run `pnpm check:tests`, and confirm exit code 2 with the matching ID:

| Injected violation | Expected ID |
|---|---|
| Import `vitest-browser-svelte` in a `*.test.ts` | `TT-001` |
| Add `await page.waitForTimeout(500)` | `TT-002` |
| Add `readFileSync` source assertion to a `*.browser.test.ts` | `TT-003` |
| Add the setup journey to a spec `beforeEach` | `TT-004` |
| Remove the shared fixture import from a spec | `TT-005` |
| Hard-code `workers: 4` in `playwright.config.ts` | `TT-006` |
| Add a docker-compose dependency to a `*.browser.test.ts` | `TT-007` |
| Let `*.integration.test.ts` match the default include | `TT-008` |

An exemption without a justification must fail as `TT-000`.

## S7 — CI budgets are enforced

With the dev stack running (`pnpm dev:up`), run:

```bash
pnpm test:ci
pnpm test:e2e:ci -- --shard=1/4
```

Expected:

- `test-results/tier-durations.json` lists tier1, tier2, and server, and marks
  tier3 as `deferred` to `test:e2e:ci`.
- `test-results/tier3-shard-1.json` exists and reports ≤ 120 s for that shard.
- Every `status` is `pass` on the reference machine.
- Temporarily lower a budget in `test-budgets.json`; the owning command exits 3
  and names the tier.

## S8 — Server boundary stays in-process

```bash
pnpm --filter @mayon/server test
```

Expected:

- Handler tests use `app.inject(...)`; the only real listeners are transport/proxy subjects.
- The live-provider file is excluded from the default run and runs only via `pnpm test:integration` with its environment prerequisites.

## S9 — Low-spec completeness

On a machine below the threshold (or with `MAYON_TEST_PARALLEL=off`):

```bash
pnpm test:low-spec
```

Expected: the same test selection as the capable run, one worker, no skips, and a slower but successful result.

## Troubleshooting

| Symptom | Check |
|---|---|
| Browser tier cannot find Chromium | `pnpm exec playwright install --with-deps chromium` |
| E2E tests fail at boot | `E2E_BASE_URL`, stack health, setup project log |
| Setup journey still runs per test | `storageState` path and `dependencies: ['setup']` |
| Parallel run flakes | worker-scoped ids, no global settings mutation, no shared chat ids |
| Budget report missing | `pnpm test:ci` ran, JSON reporter output path writable |
| MSW not intercepting | worker asset served by the test Vite server; app/API origins allowed |
