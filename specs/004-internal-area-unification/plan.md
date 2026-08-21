# Implementation Plan: Internal Area Unification

**Branch**: `004-internal-area-unification` | **Date**: 2026-08-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-internal-area-unification/spec.md`

## Summary

Close the honesty gaps the MCP-approval flow exposed and converge assistant-initiated interaction into the timeline's internal lane. Five verified defects: (1) the assistant text persisted at a tool-call boundary keeps rendering again from the stale live stream buffer until turn end; (2) a pending approval renders twice (durable ask row + live ask card) and its tool call wears a failure mark with "No result recorded" while merely awaiting a decision; (3) MCP tool results render as an unbounded wall of text because the result payload is stored and displayed as the row's summary; (4) pacing chips and static reply suggestions live in the compose area instead of the timeline; (5) the request trace logs raw context rows (duplicating the system prompt and stripping tool identity) instead of the projected wire payload. All fixes are presentation/trace-layer; provider-visible context is frozen by the existing golden tests.

## Technical Context

**Language/Version**: TypeScript, Svelte 5 (runes), Node 22 / pnpm 10 (toolchain pins)

**Primary Dependencies**: SvelteKit (adapter-static SPA), Tailwind v4 + shadcn-svelte (bits-ui), lucide-svelte icons, Vitest + pglite test driver, AI SDK streaming (`streamText`/`consumeStream`)

**Storage**: Postgres behind drizzle (`messages` table with `kind` column, metadata JSON) — **no schema change this feature**; one additive metadata field (`ok`) on newly written tool_result rows

**Testing**: `pnpm test` (Vitest, pglite), `pnpm --filter @mayon/server test` (server suite; expected unaffected), `pnpm check`, `pnpm lint`

**Target Platform**: Browser SPA + Node server container (Docker dev stack `pnpm dev`)

**Project Type**: web app (SvelteKit SPA + server package)

**Performance Goals**: No frame-timing regression on tool-heavy chats (perf probe `window.__MAYON_PERF__ = 1`, before/after); result clamping should reduce layout work on large payloads

**Constraints**: Presentation-layer only for historical rendering (no migration, no stored-row rewrites); provider-visible context byte-identical (golden equivalence tests pass unmodified); registry is the only tool classification source; no new dependencies; compose area is user-input-only

**Scale/Scope**: ~8 source files touched, ~6 test files extended; no new packages, no server changes

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                                          | Status | Notes                                                                                                                                                         |
| -------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Layering (repos-only, StorageDriver seam)       | PASS   | All changes are presentation/store/agent-loop; `MessageList`/`ChoicesOffer` call `chatStore` (established precedent — asks already do); no `db` imports added |
| I. No `+` filename prefix for tests                | PASS   | Test files follow `*.test.ts` colocated convention                                                                                                            |
| II. Every bug fix ships a failing-first regression | PASS   | D9 defines one regression per user story (entries merge, buffer retire, status derivation, trace fidelity, offer interactivity)                               |
| II. `pnpm test` + server suite before merge        | PASS   | Planned verification in quickstart; server suite run as a guard though no server code changes                                                                 |
| III. UI from Tailwind v4 + shadcn vocabulary       | PASS   | Status icons from lucide, clamp via Tailwind `truncate`, expander reuses the existing bounded `<pre>` pattern                                                 |
| III. Progressive degradation, no server assumption | PASS   | All rendering paths handle absent MCP/server (fewer tool rows, not errors); no runtime server dependency added                                                |
| III. Expound offset invariants                     | PASS   | No stored-row or offset changes; assistant text rendering path (`Highlighter`/`Markdown`) untouched                                                           |
| IV. Perf claims measured                           | PASS   | Perf probe before/after on a tool-heavy chat is a quickstart step                                                                                             |
| IV. Bundle growth justified                        | PASS   | Zero new dependencies                                                                                                                                         |
| Gates (check/lint/test/server-test)                | PASS   | All four run in quickstart                                                                                                                                    |

No violations. **Post-Phase-1 re-check**: design artifacts (data-model, contracts) introduce no schema change, no new seam, no UI-side tool list — check remains PASS.

## Project Structure

### Documentation (this feature)

```text
specs/004-internal-area-unification/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── timeline-assembly.md
│   ├── tool-activity-status.md
│   ├── interactive-surfaces.md
│   └── request-trace.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/lib/
├── chat/
│   ├── entries.ts                  # assembleTimeline: live-ask merge, awaiting/declined derivation (D2/D3)
│   ├── kinds.ts                    # ToolResultMeta.ok additive field (D3)
│   └── generate/generate-gate.ts   # unchanged (findGateFromMessages reused by MessageList)
├── agent/
│   ├── loop.ts                     # trace request event carries projected messages (D8); appendToolResult ok (D3)
│   └── trace.ts                    # TraceEvent/IterationState message type widened additively (D8)
├── stores/
│   └── chat.svelte.ts              # appendAssistantText retires the live buffer (D1)
├── db/repositories/
│   └── messages.ts                 # appendToolResult persists ok into metadata (D3)
└── components/chat/
    ├── MessageList.svelte          # active-gate derivation, ChoicesOffer wiring, ask placement (D7)
    ├── Composer.svelte             # chips/suggestedReplies/progress removed (D6)
    └── rows/
        ├── ToolActivity.svelte     # status-driven presentation + clamped collapsed result (D4/D5)
        └── ChoicesOffer.svelte     # interactive mode for the active gate (D7)

src/routes/chat/[id]/+page.svelte    # gate/suggestedReplies/progress plumbing removed (D6)

tests (colocated):
├── src/lib/chat/entries.test.ts                    # merge + derivation regressions
├── src/lib/chat/golden/*                           # must pass unmodified
├── src/lib/stores/chat.svelte.test.ts              # buffer-retire regression
├── src/lib/components/chat/rows/ToolActivity.*.test.ts  # status/clamp regressions
├── src/lib/agent/loop.test.ts                      # trace fidelity regression
└── src/lib/db/repositories/repositories.test.ts    # appendToolResult ok persistence
```

**Structure Decision**: single-repo SPA layout as above; all changes land in existing modules along the 002/003 seams (`entries.ts` presentation assembly, `rows/` renderers, `chat.svelte.ts` store). No new directories beyond `contracts/` documentation.

## Complexity Tracking

> No constitution violations — table intentionally empty.
