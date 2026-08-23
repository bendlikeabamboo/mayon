# Implementation Plan: AI Elements Adoption (Selective Community UI Convergence)

**Branch**: `006-ai-elements-adoption` | **Date**: 2026-08-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-ai-elements-adoption/spec.md`

## Summary

Converge three leaf UI surfaces on the community "Svelte AI Elements" patterns by copying
donor components into the codebase as first-party code (no runtime coupling): a
command-palette model picker (P1), one shared approval/confirmation pattern for MCP
elicitation + sampling (P2), and the collapsible tool-call display (P3). Adoption adds
**zero new npm packages**: donors depend only on `bits-ui` (already present), and their
one external helper (`runed`'s `watch`) is replaced with native Svelte 5 runes. The
message render path, expound, and branch navigation are untouched (spec FR-006/FR-009).

## Technical Context

**Language/Version**: TypeScript, Svelte 5 (runes) / SvelteKit 2, Node 22, pnpm 10

**Primary Dependencies**: existing only — `bits-ui` ^2.18 (Command/Dialog/Collapsible
primitives), `@lucide/svelte`, Tailwind v4, `clsx`. **No new npm packages.**

**Storage**: N/A — presentation layer only; no schema, migration, or API changes.

**Testing**: Vitest (`pnpm test`, pglite driver) for the new state/filter logic in
`src/lib/**`; `pnpm check` + manual smoke on the dev stack for presentation; full gates
`pnpm check` / `pnpm lint` / `pnpm test`.

**Target Platform**: static SPA served from Docker (web container); browser.

**Project Type**: web app (SvelteKit static SPA + Node server; this feature is SPA-side
only).

**Performance Goals**: no regression to transcript render counts (`incRender` marks);
model picker filter interaction under ~50ms for ≤200 models; donor dialogs lazy-mounted
via existing `LazyMount` pattern where applicable.

**Constraints**: constitution III/IV — existing shadcn-svelte vocabulary and visual
conventions; bundle growth must be justified (here: zero new deps; donor code is small
Svelte files); progressive degradation by advertised capabilities must be preserved.

**Scale/Scope**: 3 surfaces; ~533 lines of bespoke UI replaced; 4 shadcn vocabulary
primitives added (`command`, `alert`, `badge`, `collapsible` — all dependency-free).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                                  | Status              | Notes                                                                                                             |
| ------------------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| I — Layering / `StorageDriver` seam        | ✅ pass             | No repository/db changes; components consume existing stores only                                                 |
| I — Toolchain pins                         | ✅ pass             | No new toolchain; pnpm/Node untouched                                                                             |
| I — No secrets in settings                 | ✅ pass             | Untouched                                                                                                         |
| I — `+` filename prefix                    | ✅ pass             | New files are components/tests, none `+`-prefixed                                                                 |
| II — Tests with new `src/lib` behavior     | ✅ pass             | Confirmation state machine, model filtering, tool-status mapping get Vitest tests; presentation via check + smoke |
| II — `search_vec` / restore invariants     | ✅ pass             | Untouched                                                                                                         |
| III — shadcn-svelte vocabulary             | ✅ **strengthened** | Adds four canonical vocabulary primitives; donor styling is the same token system                                 |
| III — Progressive degradation              | ✅ pass             | Approval/tool UI remains capability-gated (stdio-mcp); picker works offline (local list)                          |
| III — Expound offsets invariant            | ✅ pass             | Render path untouched; tool display is outside markdown DOM (FR-006 guard test: expound suite must stay green)    |
| IV — Bundle growth justified               | ✅ pass             | Zero new npm deps; donor LOC small, Svelte-compiled, tree-shaken; justified in this plan                          |
| IV — Perf probe for perf-sensitive changes | ✅ pass             | Transcript row changes measured via existing `incRender('TimelineRow')` marks before/after                        |

**Post-Phase-1 re-check**: see end of `research.md` — no violations surfaced by design.

## Project Structure

### Documentation (this feature)

```text
specs/006-ai-elements-adoption/
├── plan.md              # This file
├── research.md          # Phase 0 output — donor selection, runed removal, LOC accounting
├── data-model.md        # Phase 1 output — presentation entities & state machines
├── quickstart.md        # Phase 1 output — manual validation guide
├── contracts/           # Phase 1 output — UI component contracts
│   ├── model-picker.md
│   ├── approval-confirmation.md
│   └── tool-display.md
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/lib/components/
├── ui/                          # shadcn-svelte vocabulary (added, zero npm deps)
│   ├── alert/                   #    used by confirmation
│   ├── badge/                   #    used by tool status
│   ├── collapsible/             #    used by tool shell
│   └── command/                 #    used by model picker (bits-ui Command)
├── ai/
│   ├── ModelSelect.svelte       # DELETED (replaced)
│   └── model-select/            # donor family, trimmed (trigger/dialog/content/input/
│                                #   list/item/empty/group/separator/name + index)
└── mcp/
    ├── confirmation/            # donor family (context/state machine w/o runed,
    │                            #   request/title/actions/accepted/rejected + index)
    ├── ElicitationDialog.svelte # RETAINED shell: donor chrome + existing schema form
    └── SamplingApprovalCard.svelte # becomes thin instantiation of shared pattern

src/lib/components/chat/rows/
├── ToolActivity.svelte          # ported onto tool-block shell (collapsible + badge);
│                                #   status/artifact/sources logic retained
└── ToolResultBody.svelte        # RETAINED (shape-driven body rendering)

tests: colocated
├── src/lib/components/mcp/confirmation/confirmation-context.test.ts
├── src/lib/components/ai/model-select/model-select.test.ts   (filtering + a11y roles)
└── src/lib/components/chat/rows/tool-status.test.ts          (status mapping retained)
```

**Structure Decision**: single-repo SPA structure (`src/lib/components/**`) — feature is
wholly frontend; no backend/server paths change.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations — table intentionally empty.
