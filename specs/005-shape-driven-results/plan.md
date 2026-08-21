# Implementation Plan: Shape-Driven Tool Result Rendering

**Branch**: `005-shape-driven-results` | **Date**: 2026-08-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-shape-driven-results/spec.md`

## Summary

Make expanded tool results readable by classifying each result body from its (summary, detail) shape through one pure classifier and rendering per shape: URL-bearing JSON records as a capped list of link cards (sources folded in), markdown through the timeline's markdown renderer, other JSON pretty-printed, everything else in the existing bounded raw view. The header row becomes the expand/collapse toggle. Presentation-only: stored payloads, provider context, and the tool registry are untouched; detection never consults tool names or server identity; every misdetection degrades to today's bounded view.

## Technical Context

**Language/Version**: TypeScript, Svelte 5 (runes), Node 22 / pnpm 10 (toolchain pins)

**Primary Dependencies**: SvelteKit (adapter-static SPA), Tailwind v4 + shadcn-svelte vocabulary, lucide-svelte icons, Vitest (pure-logic + source-inspection tests)

**Storage**: none changed — reads the stored `messages.content` (summary) and `messages.metadata` (parsed detail) only; no migration, no row rewrites

**Testing**: `pnpm exec vitest run src/lib/components/chat/ src/lib/chat/` (targeted), then full `pnpm test`, `pnpm check`, `pnpm lint`

**Target Platform**: Browser SPA (dev stack `pnpm dev`, web http://localhost:5173)

**Project Type**: web app (SvelteKit SPA)

**Performance Goals**: no timeline render regression on tool-heavy chats (perf probe before/after); card cap keeps DOM size bounded on large search payloads

**Constraints**: presentation-only (FR-011); no UI-side tool-name/server lists (FR-002); stored payload byte-identical (SC-005); degradation never crashes, never unbounded (FR-012); URL extraction shared with sources extraction, not duplicated (FR-014); verbose rule unchanged (FR-010); golden tests (`src/lib/chat/golden/*`) pass unmodified

**Scale/Scope**: ~4 source files touched (1 new module, 1 new component, 2 edited), 2–3 test files added/extended, 1 doc bullet; no new packages, no server changes

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                                    | Status | Notes                                                                                                                                    |
| -------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| I. Layering (repos-only, StorageDriver seam) | PASS   | Pure presentation module + component; no `db` imports, no store/repo changes                                                             |
| I. No `+` filename prefix for tests          | PASS   | Tests are `*.test.ts` colocated (`result-shape.test.ts`, `ToolResultBody.*.test.ts`)                                                     |
| II. Tests for new `src/lib/` behavior        | PASS   | Classifier (pure-logic, failing-first) + component (source-inspection, failing-first) per FR-015                                         |
| II. `pnpm test` before merge                 | PASS   | Quickstart runs targeted vitest, full suite, check, lint                                                                                 |
| III. Tailwind v4 + shadcn vocabulary         | PASS   | Cards/toggle reuse existing quiet-row vocabulary (muted text, border, truncate, chevron); lucide icons only                              |
| III. Progressive degradation                 | PASS   | Classifier is pure and total (never throws); unknown shapes fall to the existing bounded `<pre>` (FR-012); no server dependency          |
| III. Expound offset invariants               | PASS   | No stored-row or offset changes; `Markdown.svelte` reused read-only (tool-result markdown is not expound-targetable — no offset mapping) |
| IV. Perf claims measured                     | PASS   | Perf probe before/after on a web-search chat is a quickstart step                                                                        |
| IV. Bundle growth justified                  | PASS   | Zero new dependencies; classifier and cards are plain TS/Svelte                                                                          |
| Gates (check/lint/test)                      | PASS   | All run in quickstart                                                                                                                    |

No violations. **Post-Phase-1 re-check**: design artifacts introduce no schema change, no new seam beyond the documented classifier authority, no UI-side tool list — check remains PASS.

## Project Structure

### Documentation (this feature)

```text
specs/005-shape-driven-results/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/
│   └── tool-result-shapes.md  # classifier + rendering contract
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/lib/
├── chat/
│   ├── kinds.ts                    # TOOL_SUMMARY_THRESHOLD reused, unchanged
│   └── result-shape.ts             # NEW: pure shape classifier (single shape authority)
├── mcp/
│   └── sources.ts                  # refactor: shared tolerant-JSON + record-collection primitives (public contract unchanged)
└── components/chat/
    ├── Markdown.svelte             # reused read-only for S4
    ├── ToolSources.svelte          # unchanged; simply not rendered when records render
    └── rows/
        ├── ToolActivity.svelte     # header-row toggle; delegates expanded body; verbose rule unchanged
        └── ToolResultBody.svelte   # NEW: renders the shape union (cards / markdown / pretty JSON / raw text)

docs/dev/seams.qmd                  # feature-004 section: one bullet on shape-driven result rendering

tests (colocated):
├── src/lib/chat/result-shape.test.ts                 # NEW: classifier fixtures (records/json/markdown/text/null + precedence)
├── src/lib/components/chat/rows/ToolResultBody.test.ts  # NEW: shape-rendering source-inspection
├── src/lib/components/chat/rows/ToolActivity.collapse.test.ts  # EXTENDED: header-toggle + sources-fold contract (behavior changes by design)
└── src/lib/chat/golden/*            # must pass unmodified
```

**Structure Decision**: single-repo SPA layout; the classifier lands beside the other pure chat modules (`src/lib/chat/`), the renderer beside the other row components (`rows/`), and the shared parse/URL primitives stay in `src/lib/mcp/sources.ts` (their existing home) rather than a new module — one parse serves cards and sources extraction (FR-014).

## Complexity Tracking

> No constitution violations — table intentionally empty.
