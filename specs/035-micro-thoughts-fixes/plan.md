# Implementation Plan: Micro-Thoughts Follow-Up Fixes (029 defects)

**Branch**: `fix/issue-71-micro-thoughts` | **Date**: 2026-11-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/035-micro-thoughts-fixes/spec.md`

## Summary

Issue #71 collects six defects + test gaps left by feature 029 (plus #70's finalize rewrite):
a critic correction drops the original stream's reasoning rows (only `walkPersist` writes
them, and the corrected path bypasses it), `liveBlocks` is never reset between agent-loop
iterations (duplicate live thoughts + stale empty text bubble), regenerate is gated to a
trailing `assistant_message` and deletes only one row on multi-row turns, paced presets pay
a ~1.2 s drain-deadline stall per extra text block, finished live thoughts keep pulsing,
and the trace keeps a trailing whitespace-only reasoning segment. The approach: persist the
original iteration's reasoning blocks before the corrected append (loop), add an
`onIterationBoundary` dep the loop fires at each persist site and at correction start
(store clears `liveBlocks`), extract a regeneratable-id helper that treats trailing
anchored reasoning as part of the turn plus a store-level whole-turn delete, gate the
deferred drain on the 033 `final` marker + unflushed buffer, thread a `streaming` flag
from live reasoning blocks to `ReasoningEntry`, prune whitespace-only trace segments on
close/finish — each with a fail-first regression test, plus a fast-tier interleaved-mock-
shape test (optional dev-stack e2e noted for the maintainer).

## Technical Context

**Language/Version**: TypeScript (SvelteKit static SPA, Svelte 5 runes), Node 22, pnpm 10.

**Primary Dependencies**: `ai@7` fullStream part types (unchanged), existing drizzle/pglite
test driver, existing Vitest. No new dependencies.

**Storage**: Postgres via existing `repos.messages.append/delete` — no schema change.
Reasoning rows keep `metadata {iteration, anchored:true}`.

**Testing**: Vitest (pglite file test DB). **Fleet-capped invocation only**:
`systemd-run --user --scope -p MemoryMax=500M --setenv=NODE_OPTIONS=--max-old-space-size=384 pnpm test:low-spec <files>`
(SPA tests) — never plain `pnpm test`. Playwright e2e is optional/maintainer-verifiable
(Docker dev stack; implementer tier cannot run Docker).

**Target Platform**: Browser SPA + Node server (unchanged).

**Project Type**: web-app repo (agent loop / chat store / chat UI slice).

**Performance Goals**: paced presets add zero per-block drain stalls (≤1 drain wait/turn);
no other perf change.

**Constraints**: respect 029 contracts (amendments listed below), 033 finalize-composition
(image paths unchanged), 022 pacer API (untouched — the fix is store-side gating);
`Tool-map.qmd` untouched (no agent/MCP tool changes). CHANGELOG entries go inside
`## [0.10.0]` (per feature 034's release-train decision), not `## [Unreleased]`.

**Scale/Scope**: ~6 source files (`src/lib/agent/loop.ts`, `src/lib/agent/trace.ts`,
`src/lib/stores/chat.svelte.ts`, `src/lib/chat/entries.ts`,
`src/lib/components/chat/MessageList.svelte`,
`src/lib/components/chat/rows/ReasoningEntry.svelte`,
`src/routes/chat/[id]/+page.svelte`) + 4 test files. Exactly issue #71 — no refactors
beyond the two extracted helpers (regenerate gate; whole-turn delete).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| Layering: app code calls repos only | PASS | New store method uses `repos.messages.delete`; no `db` import outside `src/lib/db/`. |
| `StorageDriver` sole storage seam | PASS | No driver changes. |
| `pnpm check` + `pnpm lint` before merge | PASS | Tasks include both (fleet-capped test commands). |
| Testing standards (pglite vitest pass) | PASS | Fail-first tests per story; capped runner commands in quickstart. |
| No `+`-prefixed non-route files | PASS | New test file `src/lib/agent/trace.test.ts` (no prefix). |
| Docs updated where behavior contracts change | PASS | Contracts amended in-feature; `docs/` untouched (029/033 pages describe unchanged persistence shapes; the corrected-path reasoning rows match 029's documented row shapes). |

Post-design re-check: PASS — Phase 1 adds one optional dep to `AgentTurnDeps` (surface
owned by 029's stream-segments contract, amended in-feature) and one exported pure helper
in `src/lib/chat/entries.ts`; no gate newly violated.

## Project Structure

### Documentation (this feature)

```text
specs/035-micro-thoughts-fixes/
├── plan.md              # This file
├── research.md          # Phase 0 output — defect forensics + decision records
├── data-model.md        # Phase 1 output — amended LiveBlock/entry shapes
├── quickstart.md        # Phase 1 output — capped validation scenarios
├── contracts/           # Phase 1 output — amendments to 029/022/033 contracts
│   ├── iteration-boundary.md
│   ├── corrected-persist.md
│   ├── regenerate-scope.md
│   └── drain-once.md
└── tasks.md             # Phase 2 output ($speckit.tasks)
```

### Source Code (repository root)

```text
src/lib/agent/loop.ts                         # US1 corrected-path reasoning persist; US2 boundary dep
src/lib/agent/trace.ts                        # US5 whitespace-tail prune
src/lib/stores/chat.svelte.ts                 # US2 boundary/closing/streaming; US3 whole-turn delete; US4 drain gate
src/lib/chat/entries.ts                       # US3 lastRegeneratableAssistantId helper; LiveReasoningEntry.streaming
src/lib/components/chat/MessageList.svelte    # US3 gate; US2 pass streaming prop
src/lib/components/chat/rows/ReasoningEntry.svelte # US2 pulse only while streaming
src/routes/chat/[id]/+page.svelte             # US3 onRegenerate delegates to store
src/lib/agent/loop.test.ts                    # US1/US2 fail-first tests
src/lib/agent/trace.test.ts                   # US5 fail-first tests (new file)
src/lib/stores/chat.svelte.test.ts            # US1/US2/US3/US4 fail-first tests + interleaved shape
src/lib/chat/entries.test.ts                  # US3 gate fail-first tests
tests/e2e/render.spec.ts                      # optional maintainer e2e (dev stack only)
CHANGELOG.md                                  # entries inside ## [0.10.0]
```

**Structure Decision**: single-project SPA layout (existing); all edits in `src/lib` +
one route + tests.

## Complexity Tracking

> No constitution violations — table intentionally empty.
