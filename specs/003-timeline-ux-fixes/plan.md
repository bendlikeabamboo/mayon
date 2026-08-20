# Implementation Plan: Timeline UX Fixes

**Branch**: `003-timeline-ux-fixes` | **Date**: 2026-08-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-timeline-ux-fixes/spec.md`

## Summary

Four defect fixes on top of `specs/002-chat-timeline-kinds`, all verified against source before planning: (1) the orbit spinner renders for every durable assistant row because its guard only excludes the live `pending` state (`AssistantMessage.svelte:71`) — restrict it to live items; (2) the diagnostics panel keys MCP event rows by `kind + serverId` so two lifecycle events for one server crash the app (`DiagnosticsPanel.svelte:534`) — qualify the key; (3) turn order is wrong twice over: the agent loop persists text → tool call → reasoning in tool-carrying iterations (`loop.ts:397/405/580`) and timeline assembly flushes unpaired tool groups at the END of the whole timeline (`entries.ts:127-134`) — persist reasoning first per iteration and place groups at their stored position, plus a presentation-time reorder pass for chats already stored in the buggy order; (4) `choices` entries are routed into the tool-group path and rendered as failed tool calls — and the pairing map itself is keyed by row id instead of tool-call id (`entries.ts:115`), so production tool pairs never pair (masked by fixtures where both are equal) — render choices as offers, key pairing correctly, and suppress the failure mark for registry-classified terminal tools. Everything is presentation-layer plus persist-order in the loop: no schema change, no migration, provider context untouched (golden tests must pass unmodified).

## Technical Context

**Language/Version**: TypeScript 5.x; Svelte 5 (runes); Node 22; pnpm 10

**Primary Dependencies**: SvelteKit, Tailwind v4, shadcn-svelte, drizzle (read-only here), `@mayon/shared` (unchanged), Vitest + pglite

**Storage**: unchanged — `messages` table as delivered by 002 (kind column, NOT NULL after v2). This feature adds no columns, no migration, no schema-version bump.

**Testing**: `pnpm test` (must include updated `entries.test.ts` with distinct id/toolCallId fixtures — the regression for the pairing bug), `pnpm --filter @mayon/server test` (unchanged, still run), `pnpm check`, `pnpm lint`

**Target Platform**: static SPA + Node server (dev stack `pnpm dev`)

**Project Type**: web application (SPA + server)

**Performance Goals**: none new; the reorder pass is O(n) over timeline items per chat and must not reintroduce per-render recomputation (stays inside `assembleTimeline`, called from a `$derived`)

**Constraints**: presentation-only for historical rendering (no stored-row rewrites — IDs, `ord`, branch references, expound offsets immutable); golden provider-equivalence tests pass unmodified; terminal classification sourced from the existing tool registry (`getToolDefinition().terminal`), never a UI-side tool-name list; no `+` filename prefixes; Svelte 5 runes style; constitution gates green.

**Scale/Scope**: 6 source files touched (2 components, 1 panel, 1 assembly module, 1 loop, plus tests); zero new dependencies.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| # | Principle (constitution §) | Verdict | Notes |
|---|---|---|---|
| 1 | Layering: repos only (I) | PASS | No repository or schema changes; components read only passed props + the pure registry |
| 2 | `StorageDriver` only storage seam (I) | PASS | No storage change at all |
| 3 | `pnpm check` + `pnpm lint` (I) | PLANNED | Blocking gates; baseline = 10 pre-existing `server-stdio.test.ts` errors |
| 4 | No secrets in `settings` (I) | PASS | Untouched |
| 5 | No `+` filenames (I) | PASS | New/edited tests colocated, no prefix |
| 6 | Tests ship with fixes; regression per bug (II) | PLANNED | One regression test per user story: duplicate-key render fixture, durable-spinner guard, pairing with distinct ids, canonical order incl. buggy-stored fixture, terminal suppression vs genuine-gap retention |
| 7 | `search_vec` generated-only (II, IV) | PASS | Untouched |
| 8 | UI from existing vocabulary (III) | PASS | Reuses existing icons/components; no new primitives |
| 9 | Progressive degradation (III) | PASS | No capability changes |
| 10 | No downtime / in-place restore (III) | PASS | No server, schema, or restore changes |
| 11 | Expound offsets via source map (III) | PASS | Assistant content never rewritten; ordering is item-level, offsets ride the untouched entries |
| 12 | Perf probe for sensitive changes (IV) | PASS | Reorder pass is O(n) in an already-derived computation; no measurement claim needed beyond that, verified by existing render-count tests |
| 13 | Drizzle migrations via `db:generate` (Gates) | PASS | No migration |
| 14 | Bundle growth justified (IV) | PASS | Zero new dependencies |
| 15 | `@mayon/shared` build order (IV) | PASS | Shared untouched |

**Post-Phase-1 re-check (2026-08-20)**: design adds no new mechanism — it repairs dispatch, keying, and ordering inside the seams established by 002 (registry, `assembleTimeline`, loop persist hooks). No violations; **no Complexity Tracking entries**.

## Project Structure

### Documentation (this feature)

```text
specs/003-timeline-ux-fixes/
├── plan.md              # This file
├── research.md          # Phase 0 output — verified root causes + decisions
├── data-model.md        # Phase 1 output — presentation entities only (no stored changes)
├── quickstart.md        # Phase 1 output — manual validation for the four fixes
├── contracts/
│   └── timeline-presentation.md  # canonical order, terminal presentation, dispatch rules
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
src/lib/components/chat/rows/AssistantMessage.svelte  # spinner guard: live-only (US2)
src/lib/components/chat/rows/ToolActivity.svelte      # terminal-aware status icon/message (US4)
src/lib/components/diagnostics/DiagnosticsPanel.svelte# unique event keys (US1)
src/lib/chat/entries.ts                               # pairing key fix, choices dispatch,
                                                      # in-place group placement, reorder pass (US3/US4)
src/lib/chat/entries.test.ts                          # distinct id/toolCallId fixtures + regressions
src/lib/agent/loop.ts                                 # per-iteration reasoning-before-text persist (US3)
src/lib/agent/loop.test.ts                            # persist-order assertions
```

**Structure Decision**: same single-project layout; all edits in existing files delivered by 002. No new modules — the reorder pass lives inside `assembleTimeline` where dispatch already happens.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None.
