# Implementation Plan: Split Text-Generation Tests from UI E2E

**Branch**: `031-split-text-e2e-tests` | **Date**: 2026-11-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/031-split-text-e2e-tests/spec.md`

## Summary

Apply the 025 text-first policy to the existing test artifacts: split text-generation
behavior proofs out of the Playwright browser suite into the fast in-process Vitest
tier. The per-spec triage (research.md) shows leaf invariants are already fast-tier
covered — the real work is (1) authoring the missing **composed end-state** scenarios
(backprop offer/declined/root end-states, capability-toggle→tool-less trace, discovery→
persisted-settings merge, telemetry per-turn record emission), (2) pruning the
behavior-only assertions from the e2e specs once their fast homes are green (add-before-
remove), (3) de-duplicating the hand-mirrored mock-fixture strings into a single
`tests/fixtures/mock-llm/` source with a drift guard, and (4) finishing the browser
inventory: classify all 10 specs (incl. the two unclassified) and turn it into the parity
ledger. No runtime changes, no new dependencies, no new CI infrastructure — the fast
tier is already merge-blocking via `pnpm test` in the `web` job.

## Technical Context

**Language/Version**: TypeScript throughout; Node 22 (`.nvmrc`), pnpm 10; SvelteKit/Svelte 5 SPA + Node server. Mock-llm fixture server is plain-Node `.mjs`.

**Primary Dependencies**: none added. Existing: Vitest + PGlite harness (`useFileTestDb()` → seed via `repos`), Playwright e2e against the docker dev stack, mock-llm fixture server (`tests/fixtures/mock-llm/`), GitHub Actions composite CI.

**Storage**: N/A — no schema change, no migration; Postgres stays untouched behind the `StorageDriver` seam.

**Testing**: the feature *is* tests. Fast tier: colocated `src/**/*.test.ts` + `server/src/**/*.test.ts` (PGlite driver, in-process). Browser tier: `tests/e2e/*.spec.ts` (chromium, full stack, `workers: 1`).

**Target Platform**: dev tooling + CI only (GitHub Actions `web` + `e2e` jobs); zero runtime surface.

**Project Type**: web-app monorepo (SPA + server + shared package); this feature is test-artifact reorganization inside it.

**Performance Goals**: fast tier reaches verdict without the live stack (no browser, no containers) and in ≤ 1/10 of the browser suite's wall time (SC-003); new composed tests add seconds, not minutes.

**Constraints**: zero new npm dependencies; zero product-source/runtime changes (FR-010); coverage never dips — fast-tier home green before e2e assertion deletion (FR-008); both tiers stay merge-blocking with no CI structural changes; no `+`-prefixed filenames (SvelteKit route namespace).

**Scale/Scope**: ~1 new fast-tier file (`backprop-endstate.test.ts`, 3 scenarios) + 3–4 extended fast-tier files (loop/capability, telemetry, connection/provider-store, drift guard); fixture-string extraction into `tests/fixtures/mock-llm/`; `kitchen-sink.ts` converted to re-exports; README inventory rewrite (10 rows + policy); assertion pruning in ~3–4 e2e specs; 0 runtime files, 0 workflow files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` does not exist; gates are derived from the repo's
operating invariants (AGENTS.md / seams), as in spec 025.

| Principle | Status | Notes |
| --- | --- | --- |
| I. App code calls repositories only; `db` private to `src/lib/db/` | **Strengthens** | All new fast-tier scenarios seed through the `repos` façade via `useFileTestDb()` — the sanctioned proving path; test files are exempt from R1/R3 by design |
| I. Merge-blocking gates respected (`pnpm lint`, `pnpm check`, boundary checks) | Pass | No gate changes; suites must stay green through the migration (add-before-remove keeps `web` and `e2e` jobs green at every commit) |
| II. New behavior lands with tests in `src/lib/` | Pass | The feature *is* tests; no new product behavior exists to test |
| II. Toolchain pins (Node 22, pnpm 10; no bun/Rust) | Pass | No toolchain or dependency changes |
| III. No UX/runtime behavior change | Pass | FR-010: only test files, fixtures, README, spec artifacts are touched |
| IV. No bundle/perf impact | Pass | Nothing ships; `src/` edits are `*.test.ts` only (excluded from the SPA build) |
| Deviating from a documented seam requires amendment first | Pass | No seam touched; proves *through* the seams (repos, PGlite driver) |
| SvelteKit `+` filename prefix reserved for routes | Pass | New test files are plain `*.test.ts` names |
| Tool-map updated when touching agent/MCP tools | N/A | No agent/MCP tools touched |

**Verdict**: PASS — no violations; the feature operationalizes the 025 placement policy on the test artifacts themselves. Post-Phase-1 re-check: design adds only dev-time artifacts (tests, fixtures, README policy); still PASS.

## Project Structure

### Documentation (this feature)

```text
specs/031-split-text-e2e-tests/
├── plan.md              # This file
├── research.md          # Phase 0 — per-spec triage, decisions D1–D8
├── data-model.md        # Phase 1 — governance entities (tier, invariant, ledger, classification, fixture)
├── quickstart.md        # Phase 1 — V1–V8 validation scenarios
├── contracts/
│   ├── shared-fixtures.md    # mock-llm ↔ both-tiers text contract + drift guard
│   └── browser-inventory.md  # README classification + parity-ledger contract
└── tasks.md             # Phase 2 ($speckit-tasks — NOT created by this command)
```

### Source Code (repository root)

```text
tests/
├── e2e/
│   ├── README.md                      # inventory: 10 rows + policy → the parity ledger
│   ├── backprop-tool.spec.ts          # pruned: composed data invariants out (D8)
│   ├── provider-picker.spec.ts        # pruned: persisted-trace counts out
│   ├── telemetry.spec.ts              # pruned: span/usage composition out; live delivery stays
│   ├── image-round-trip.spec.ts       # mock-log scrape decision per ledger (D2.7)
│   ├── fixtures/kitchen-sink.ts       # re-exports shared strings; no hand mirrors
│   └── mock-classification|quiz|lab|prompt-contract|onboard|render.spec.ts
│                                      # classification-only (no assertion edits)
└── fixtures/mock-llm/
    ├── markers.mjs (or strings.mjs)   # + fixture-only assertion strings (single source)
    ├── server.mjs                     # serves from the constants (no inline copies)
    └── README.md                      # harness rule cross-link to shared-fixtures contract

src/lib/chat/backprop-endstate.test.ts             # NEW: offer/declined/root composed end-states
src/lib/agent/loop.test.ts                         # + capability toggle → tool-less persisted trace
src/lib/telemetry/telemetry.test.ts (or sibling)   # + per-turn record emission composition
src/lib/ai/connection-test.test.ts (or provider-store test)  # + discovery → persisted settings merge
src/lib/ai/generate/classification-markers.test.ts # + shared-strings drift guard

server/src/llm-proxy.test.ts           # UNCHANGED — already the in-process proxy proof (D5)
.github/workflows/ci.yml               # UNCHANGED — verified, not edited (D6)
```

**Structure Decision**: no new directories or packages — the split weaves into the
existing trees (colocated fast-tier tests per house pattern; e2e specs pruned in place;
fixture strings consolidated inside the existing mock-llm module family). Everything is
dev-time; nothing ships to the SPA bundle or server image.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations — nothing to justify.
