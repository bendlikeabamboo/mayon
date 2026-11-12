# Implementation Plan: Test-infrastructure accuracy fixes

**Branch**: `fix/issue-75-test-infra` | **Date**: 2026-11-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/038-test-infra-accuracy/spec.md` (GitHub issue #75)

## Summary

Seven test-infrastructure accuracy gaps: (1) the e2e mock-log scraper resolves
its compose project by "first project mounting the base compose file", so a
sharded run can read a sibling shard's logs; (2) the fixture-string drift guard
patrols only the mock server and the e2e kitchen-sink re-export while three
fast-tier suites re-type fixture values unpatrolled; (3) no assertion anywhere
pins toast absence for a declined propagation approval or a latch-refused
second propagation (the product guarantee from 037 is unpinned); (4) the
provider discovery merge formula is written three times (twice in the settings
UI, once re-implemented in the connection-test suite); (5) the e2e CI job
builds dev images uncached and the two-shard split is 21/12; (6) feature-031
artifacts still claim CI was never edited; (7) chat reload parity pins only the
streaming AI SDK entry point.

Technical approach: a pure compose-project selector (project name derived from
the runner base URL, verified against this checkout's compose files) living in
the dev-tooling module, unit-tested in the fast tier and consumed by the e2e
spec; a single explicit mirror registry in the existing drift-guard suite
patrolling every known mirror by byte-containment (both drift directions); a
shared `mergeDiscoveredModels` helper in the model-discovery module consumed by
both UI call sites and the parity test; store-level toast-absence assertions
observing the toast collection plus e2e absence sweeps; a cache-backed
buildx pre-build of the dev images under the compose-expected project tags in
CI plus a describe-boundary spec-file split to rebalance shards (verified by
the container-free `--list` oracle); dated addenda on the three 031 artifacts;
and extension of the reload-parity test to all three AI SDK entry points.

## Technical Context

**Language/Version**: TypeScript on Node 22 (`.nvmrc`), pnpm 10; Svelte 5 runes.

**Primary Dependencies**: SvelteKit (static SPA), Vitest (`include:
src/**/*.{test,spec}.{js,ts}` per `vite.config.ts:73`), Playwright, Docker
Compose (engine-agnostic via `MAYON_DEV_ENGINE`), GitHub Actions. No new
dependencies.

**Storage**: none — no schema, no migrations, no data.

**Testing**: Vitest with the pglite driver; SPA tests run capped per fleet
policy (`test:low-spec` under the systemd-run memory scope). Playwright e2e
requires a dev/shard stack (Docker) — maintainer-verified; every e2e change in
this feature ships with a container-free proof path.

**Target Platform**: developer/CI machines only; nothing ships to the SPA
bundle or the server image.

**Project Type**: web application (SPA + server) — test-infrastructure change.

**Performance Goals**: CI e2e wall-time reduced by layer-cache reuse and shard
balancing (measured by the next maintainer-run CI pass; not locally provable).

**Constraints**: All AGENTS.md invariants; constitution II (fail-first where a
behavior is missing; mutation-proof where the gap is assertion-only); no
product behavior changes (the merge-helper extraction and selector extraction
are behavior-preserving refactors); `+` prefix reserved for routes; worktree
branch discipline.

**Scale/Scope**: 7 fixes across ~2 product-adjacent files
(`ProviderConfig.svelte` refactor-only, `Toaster` untouched), ~8 test files, 1
workflow + 1 composite action, 3 spec-tree artifacts (031) + this feature's
tree, CHANGELOG; zero migrations.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
| --- | --- | --- |
| I. Layering | PASS | Selector lives in `src/lib/dev/` (dev tooling, no `db` access); merge helper in `src/lib/ai/model-discovery.ts`; no component imports `db`. |
| I. Pins / no new deps | PASS | No dependency changes (buildx/setup-buildx-action is a runner-provided capability; no package additions). |
| I. No secrets | PASS | N/A — no provider config touched beyond consuming an existing helper. |
| I. `+` prefix | PASS | New files: `src/lib/dev/compose-project.ts` (+ test), spec split file under `tests/e2e/` — none `+`-prefixed. |
| II. Tests before merge | PASS | Every story lands assertions; fail-first where behavior is missing (US1, US4 helper), mutation-proof where the gap is assertion-only (US2, US3, US7) — recorded per task. |
| II. `search_vec` | PASS | No DB writes. |
| III. UI vocabulary | PASS | `ProviderConfig.svelte` changes are refactor-only (call-site swap); no markup, no new primitives. |
| III. Progressive enhancement | PASS | No runtime capability changes. |
| IV. Perf claims measured | PASS | The only perf claim (CI velocity) is scoped to CI's own next run; no SPA runtime perf claim is made. |
| Gates | PASS | `pnpm check`, `pnpm lint`, capped `pnpm test:low-spec` per story; server suite untouched. |
| Release contract | PASS | CHANGELOG entry inside `## [0.10.0]` (release-train style, `### Fixed` — test accuracy); no version bumps in this worktree. |

## Project Structure

### Documentation (this feature)

```text
specs/038-test-infra-accuracy/
├── spec.md                      # 7 user stories (this issue's 7 items)
├── plan.md                      # this file
├── research.md                  # verified evidence + decisions D1–D9
├── data-model.md                # no entities; inputs to the pure selector
├── contracts/
│   └── test-helpers.md          # selector + merge helper + mirror registry contracts
└── quickstart.md                # container-free validation scenarios
```

### Source (verified current-tree anchors)

```text
src/lib/dev/compose-project.ts            # NEW — pure compose-project selector (+ .test.ts)
src/lib/ai/model-discovery.ts             # + mergeDiscoveredModels (sibling of mergeModelContextWindows:82)
src/lib/ai/model-discovery.test.ts        # + merge helper unit tests
src/lib/ai/connection-test.test.ts        # :336-358 — parity test consumes the helper (no re-implementation)
src/lib/components/ai/ProviderConfig.svelte  # :215, :272 — both call sites consume the helper
src/lib/ai/generate/classification-markers.test.ts  # + mirror registry patrol
src/lib/stores/chat.svelte.test.ts        # :927-929 mirrors; ~:2674-2698 reload parity (d); + zero-toast assertions
src/lib/stores/quizzes.svelte.test.ts     # :486/:510/:570 lever mirrors
src/lib/agent/loop.test.ts                # :99 tool-id mirror
src/lib/stores/toasts.svelte.test.ts      # + negative assertions
tests/e2e/image-round-trip.spec.ts        # :21-40 mockRequestCount → selector
tests/e2e/backprop-tool.spec.ts           # + toast-absence sweeps
tests/e2e/provider-picker.spec.ts         # split along describe boundary (rebalance)
tests/e2e/README.md                       # ledger rows stay complete (split file gets a row)
tests/fixtures/mock-llm/strings.mjs       # header doc: mirror registry pointer
.github/workflows/ci.yml                  # e2e job: cache-backed pre-build
.github/actions/ci/action.yml             # web job builds get cache flags
specs/031-split-text-e2e-tests/{plan,research,tasks}.md  # dated addenda
CHANGELOG.md                              # inside ## [0.10.0] ### Fixed
```

## Issue-to-story traceability

| Issue item | Story | Notes vs. current tree |
| --- | --- | --- |
| 1 shard-log cross-project | US1 | Verified at `image-round-trip.spec.ts:26-40`; sibling shards + base stack all mount the base file. |
| 2 drift-guard gaps | US2 | Guard reads only `server.mjs` + `kitchen-sink.ts` (`classification-markers.test.ts:21-28`); mirrors verified at `chat.svelte.test.ts:927-929`, `quizzes.svelte.test.ts:486/510/570`, `loop.test.ts:99`. Issue's `MOCK_IMAGE_REPLY_*` naming is stale — the real mirrors are the propagation/lever/tool-id constants (research R2). |
| 3 missing no-toast assertions | US3 | `backprop-tool.spec.ts` has zero toast assertions (226 lines); `toasts.svelte.test.ts` positive-only (63 lines); 037 shipped the behavior, not the absence pin. "Dismiss click" re-anchored to decline/decision + toast-layer controls (research R3). |
| 4 discovery-merge re-implementation | US4 | Verified at `connection-test.test.ts:352` and `ProviderConfig.svelte:215`/`:272` (three formulas). |
| 5 CI cache + shards | US5 | Issue's "no pnpm cache" is stale — both jobs already cache pnpm (`ci.yml:20`, `:78`). Remaining: image-build cache + rebalance. Split measured 21/12 (33 tests; issue said 21/11 — #71 G5 added one render e2e), oracle `playwright test --list --shard=N/2`. |
| 6 031 artifacts | US6 | Verified: `plan.md:103` ("UNCHANGED — verified, not edited (D6)"), `research.md:142-148` (D6), `tasks.md:174-176` (Notes bullet). |
| 7 reload parity | US7 | Verified at `chat.svelte.test.ts:2674-2698` (test (d) pins only `mockedStreamText`); mocks for all three entry points already exist (`:61-63`, `:121-123`); `load()` triggers no AI calls (brief inference is in `send()`, `chat.svelte.ts:659-663`). |

## Phases

- **Phase 0 — Research**: evidence table (all file:line claims re-verified on
  this tree at plan time) + decisions D1–D9 in `research.md`.
- **Phase 1 — Design**: `data-model.md` (selector inputs; no entities),
  `contracts/test-helpers.md` (the three test-helper contracts this feature
  creates), `quickstart.md` (container-free validation scenarios per story).

## Key risks

- **Playwright shard packing is opaque**: the describe-boundary split's final
  numbers must be measured with the container-free listing, not predicted;
  the task's acceptance is ≤18/15 and it iterates (rename/adjust the cut)
  until measured.
- **e2e additions are maintainer-verifiable only**: every Docker-gated change
  ships alongside a container-free proof (unit tier) and is written to run —
  no skips (house 035 T018 pattern).
- **Compose `up -d` must adopt the pre-built images**: pre-building under the
  exact `<project>-<service>` tags makes plain `up -d` reuse them (no `--build`
  in the shard path); this coupling is documented in the workflow comments.
- **Merge-helper refactor must be behavior-identical**: the existing
  connection-test expectations (`['a','b','manual-keep']`) are the regression
  net; the helper's unit tests pin the same shape.
