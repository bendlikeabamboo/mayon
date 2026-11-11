# Implementation Plan: Back-propagation tool integrity fixes

**Branch**: `fix/issue-73-backprop-tool` | **Date**: 2026-11-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/037-backprop-tool-integrity/spec.md` (GitHub issue #73)

## Summary

Seven integrity defects around the 027 back-propagation tool: (1) tool-built artifacts
embed the propagation tool's own timeline chrome rows, breaking the byte-identical
parity guarantee with the manual path; (2) a latch-refused second propagation leaves a
stale success record that the chat page toasts as success; (3) the capabilities preamble
sends root-chat learners to a manual control hidden on roots; (4) the propagation tool
checks abort only at entry, so a mid-tool abort can write the artifact after the stop;
(5) duplicate image data crashes the artifact image grid (Svelte duplicate-key) because
collection does not dedupe and the grid keys by raw image data; (6) summary-artifact
regeneration updates content/metadata but never the stored image parts, leaving stale
images; (7) a declined tool call persists `{"ok":false}` — indistinguishable from
failure on context reassembly — so the model re-offers the declined tool.

Technical approach: one shared chrome-row filter inside `src/lib/chat/propagation.ts`
(used by both the tool and manual payload builders, restoring parity by construction);
clear the stale success record on latch refusal; split the preamble fallback line into
root vs provider-without-tools cases; re-check abort immediately before the artifact
write; dedupe collected images by data and adopt the Composer's duplicate-safe
`data + ':' + index` grid key; extend `updateArtifactContent` to atomically replace
`parts` (validated by the existing parts invariant); and mark the loop-synthesized
declined tool result with `detail: { declined: true }` so reassembly surfaces a legible
decline.

## Technical Context

**Language/Version**: TypeScript on Node 22 (`.nvmrc`), pnpm 10; Svelte 5 runes.

**Primary Dependencies**: SvelteKit (static SPA), drizzle (Postgres via pglite in
tests), Vitest. No new dependencies.

**Storage**: Postgres via the single drizzle schema behind `repos` (pglite test driver).
No schema change, no migration.

**Testing**: Vitest (`pnpm test:low-spec` on this machine — capped per fleet policy).
Regression tests must fail first (constitution II).

**Target Platform**: Browser SPA + Node server (existing topology).

**Project Type**: web application (SPA + server).

**Performance Goals**: None new; the chrome filter and dedupe are O(rows) over branch
timelines already fully loaded by the builders.

**Constraints**: All AGENTS.md invariants — layering (app code → repos only),
StorageDriver seam untouched, no secrets, `+` prefix reserved for routes, tool-map
updated in the same change when tool semantics change.

**Scale/Scope**: 7 fixes across 8 source files + 6 test files + 2 reference docs + 1
contract amendment; zero migrations, zero new entities.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
| --- | --- | --- |
| I. Layering | PASS | Chrome filter lives in `src/lib/chat/propagation.ts` (reads via `repos`); repo change stays inside `src/lib/db/repositories/messages.ts`; components/stores never import `db`. |
| I. Pins / no new deps | PASS | No dependency changes. |
| I. No secrets | PASS | N/A. |
| I. `+` prefix | PASS | No new route files; tests keep non-`+` names. |
| II. Tests | PASS | Every fix ships a fail-first regression test (T001–T0xx test tasks). |
| II. `search_vec` | PASS | No writes to generated columns. |
| III. UI vocabulary | PASS | Only the each-block key changes in the component; no new primitives. |
| III. Progressive capability | PASS | Server detection unchanged. |
| IV. Perf | PASS | No perf-sensitive path touched (no probe measurement required; filter/dedupe are linear over already-loaded rows). |
| IV. Bundle | PASS | No new dependencies. |

Post-design re-check (after Phase 1): still PASS — design adds no imports across the
StorageDriver seam, no new persisted kinds (US7 uses the existing `tool_result` row),
and the 027 contract amendments are documentation-only with a 037 cross-reference.

## Project Structure

### Documentation (this feature)

```text
specs/037-backprop-tool-integrity/
├── plan.md              # This file
├── research.md          # Phase 0 decisions D1–D8
├── data-model.md        # Phase 1 entity deltas
├── quickstart.md        # Phase 1 validation guide
├── contracts/           # Phase 1: payload-parity.md, decline-surface.md
└── tasks.md             # Phase 2 output ($speckit-tasks)
```

### Source Code (repository root)

```text
src/lib/chat/propagation.ts            # D1 chrome filter; D5 dedupe helper (buildRawPayload, collectPropagatedImages)
src/lib/agent/deterministic-tools.ts   # D4 pre-insert abort re-check (propagate_to_parent.run)
src/lib/agent/loop.ts                  # D7 declined marker on synthesized result
src/lib/stores/chat.svelte.ts          # D2 latch-refusal clearing; D6 regenerate passes current parts
src/lib/chat/brief.ts                  # D3 preamble root/provider fallback split
src/lib/components/chat/PropagatedArtifact.svelte  # D5 grid key data+':' + index
src/lib/db/repositories/messages.ts    # D6 updateArtifactContent optional parts
src/routes/chat/[id]/+page.svelte      # no change expected (D2 fixes at the store); verify
docs/reference/tool-map.qmd            # same-change tool-semantics updates (invariant)
docs/reference/agent-map.qmd           # check-only; update only if propagation wording drifts
specs/027-backprop-tool/contracts/propagate-tool.md  # amended in place, 037 cross-refs
src/lib/chat/propagation.test.ts                  # T-tests US1/US5
src/lib/agent/deterministic-tools.test.ts         # T-tests US1 parity, US4
src/lib/stores/chat.svelte.test.ts                # T-tests US2, US6
src/lib/chat/brief.test.ts                        # T-tests US3
src/lib/db/repositories/messages.test.ts          # T-tests US6
src/lib/components/chat/PropagatedArtifact.test.ts # T-tests US5 (wiring)
src/lib/agent/loop.test.ts                        # T-tests US7
src/lib/chat/context.test.ts                      # T-tests US7 (reassembly surfaces decline)
```

**Structure Decision**: single existing SPA project; all changes in `src/lib/` plus one
component and reference docs. No new directories.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None — no violations.
