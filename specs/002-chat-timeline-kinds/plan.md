# Implementation Plan: Chat Timeline Kind Model

**Branch**: `002-chat-timeline-kinds` | **Date**: 2026-08-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-chat-timeline-kinds/spec.md`

## Summary

Replace the chat timeline's implied content model — provider intent and UI presentation both guessed from nullable `role`/`toolCallId`/`toolName`/`metadata` combinations on `messages` — with an explicit, single classification: one durable `kind` per timeline event. Lane (user/internal/external) and all presentation (collapsible, collapsed-by-default, renderer) become pure functions of kind via one registry used by both persisted rows and live streaming state. Permission/sampling/elicitation asks persist with their resolved outcomes on the same entry; choice offers persist with their options and the taken selection linked back; reasoning persists per agent-loop iteration; the critic phase persists a self-corrected record. Context assembly is rewritten as an explicit pure projection `entries → ModelMessage[]` proven equivalent on existing chats by golden tests. Storage evolves in place: an additive `kind` column (drizzle-generated ALTER) plus a stamped schema-version v1→v2 data migration that backfills every legacy row from the column combinations — run both at server boot (new runner; today the registry only runs post-restore) and after backup restore. Existing row IDs, branch references, and expound offsets are untouched; the generated full-text columns are never written (search gains a kind filter at query level).

## Technical Context

**Language/Version**: TypeScript 5.x; Svelte 5 (runes); Node 22 (`.nvmrc`); pnpm 10 (`packageManager`)

**Primary Dependencies**: SvelteKit (`@sveltejs/adapter-static`, no SSR), Tailwind v4, shadcn-svelte (bits-ui), drizzle-orm (+ `node-postgres` migrator), AI SDK v7 (`ai` — `ModelMessage`, `streamText`), `@mayon/shared` (tsup-built, `SCHEMA_VERSION` lives here), Fastify server, Postgres 17

**Storage**: Postgres primary store behind the `StorageDriver` seam; `messages` table (single-table evolution, additive `kind` column); `settings.schemaVersion` stamp; `search_vec` columns `GENERATED ALWAYS` (never written); pglite driver in tests

**Testing**: Vitest via pglite (`pnpm test`), server suite (`pnpm --filter @mayon/server test`), `svelte-check` (`pnpm check`), ESLint + Prettier (`pnpm lint`)

**Target Platform**: Static SPA + Node/TS server, both in Docker (dev: Vite HMR `:5173` + `tsx watch` `:4319`; prod: GHCR images)

**Project Type**: web application (SPA + server)

**Performance Goals**: preserve the ~12 Hz streaming-render flush cap (`chat.svelte.ts` `RENDER_INTERVAL_MS`); timeline render-count and longtask profile no worse than baseline under `window.__MAYON_PERF__ = 1` (constitution requires measurement for the presentation rewrite)

**Constraints**: in-place migration with zero downtime/restart (restore 503 flag semantics unchanged); no writes to `search_vec` and no reindex paths; all existing user/assistant row IDs preserved (branch points, `branch_sources`, expound offsets); app code touches storage only through repositories; SvelteKit `+` filename prefix reserved for routes; no new external dependencies (bundle); drizzle migrations generated via `pnpm db:generate`; `@mayon/shared` rebuild required after `SCHEMA_VERSION` bump (`pnpm dev:build` in the Docker dev stack)

**Scale/Scope**: single-user self-hosted learning app; hundreds of messages per chat; the v1→v2 backfill must classify 100% of legacy rows across all edge-case shapes (hidden prompts, `present_choices` pairs, empty tool-call bookkeeping rows, metadata-embedded reasoning)

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #   | Principle (constitution §)                                                                                  | Verdict | Notes                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Layering: repos only, `db` private (I)                                                                      | PASS    | Kind logic lives in `src/lib/db/schema.ts` + repositories; projection/presentation/loop call repos only                                 |
| 2   | `StorageDriver` is the only storage seam (I)                                                                | PASS    | No new driver operations; `kind` flows through existing SQL paths; pglite/PG parity maintained                                          |
| 3   | `pnpm check` + `pnpm lint` before merge (I)                                                                 | PLANNED | Gates listed in quickstart; blocking                                                                                                    |
| 4   | No secrets in `settings` (I)                                                                                | PASS    | Unchanged; ask payloads contain tool args only                                                                                          |
| 5   | No `+` filename prefix outside routes (I)                                                                   | PASS    | New components under `src/lib/components/chat/rows/`, tests colocated — none use `+`                                                    |
| 6   | `pnpm test` + server tests; regression test per bug fix; tests for new `src/lib`/`server/src` behavior (II) | PLANNED | Projection golden tests, kinds/backfill tests, reload-honesty store tests, wall-of-text regression test                                 |
| 7   | `search_vec` generated-only; no reindex (II, IV)                                                            | PASS    | Query-level kind filter only; columns untouched                                                                                         |
| 8   | UI from existing Tailwind v4 + shadcn-svelte vocabulary (III)                                               | PASS    | Renderers reuse `Markdown`, `Reasoning`, `Highlighter`, `ToolSources`, `Button` patterns                                                |
| 9   | Progressive capability degradation (III)                                                                    | PASS    | Kinds need no new server capability; SPA functions with pglite/PG alike                                                                 |
| 10  | No downtime; in-place restore semantics (III)                                                               | PASS    | Additive column; boot/restore data migration inside transactions; 503 flag untouched                                                    |
| 11  | Expound offsets via source map; no substring heuristics (III)                                               | PASS    | Assistant entry content is never rewritten; assistant renderer keeps `Highlighter` path                                                 |
| 12  | Perf-sensitive changes measured with probe (IV)                                                             | PLANNED | Before/after measurement for the registry rewrite in quickstart                                                                         |
| 13  | Drizzle migrations via `pnpm db:generate` (Gates)                                                           | PASS    | Column ALTER is generated; backfill SQL lives in the registry `migrate(client)` — the stamped-version seam, not hand-edited drizzle SQL |
| 14  | Bundle growth justified (IV)                                                                                | PASS    | Zero new dependencies                                                                                                                   |
| 15  | `@mayon/shared` built before consumers (IV)                                                                 | NOTED   | `SCHEMA_VERSION` bump requires rebuilding shared + dev Docker image; part of the task list                                              |

**Post-Phase-1 re-check (2026-08-19)**: design adds one new mechanism — a boot-time data-migration runner in `server/src/server.ts` that executes `SCHEMA_MIGRATIONS` when the stamped version lags. It reuses the existing stamped-version/registry seam (documented in `docs/dev/seams.qmd` under restore), introduces no new table, no new dependency, and no downtime; gates 1–15 above remain PASS/PLANNED with no violations. **No Complexity Tracking entries required.**

## Project Structure

### Documentation (this feature)

```text
specs/002-chat-timeline-kinds/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── entry-kinds.md
│   ├── presentation-registry.md
│   ├── projection.md
│   └── migration-v2.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
packages/shared/src/
├── schema-version.ts         # SCHEMA_VERSION 1 → 2 (constants + planRestore unchanged)
└── fts.ts                    # unchanged — generated columns stay as-is

server/src/
├── schema-migrations.ts      # first registry entry: v1→v2 kind backfill (migrate(client))
├── schema-migrations.test.ts # backfill derivation + idempotency tests
└── server.ts                 # boot-time data-migration runner (stamped-version gate, pre-stamp)

drizzle/                      # generated ALTER TABLE messages ADD COLUMN kind (pnpm db:generate)

src/lib/db/
├── schema.ts                 # messages.kind (text enum) + EntryKind inference
└── repositories/
    ├── messages.ts           # kind-aware append/appendToolResult, updateOutcome, entry queries
    └── search.ts             # message search gains kind filter (user_message, assistant_message)

src/lib/chat/
├── kinds.ts                  # EntryKind union, lane derivation, legacy-column derivation (phase 1 only)
├── kinds.test.ts
├── entries.ts                # TimelineItem = DurableEntry | LiveEntry; tool_call↔tool_result grouping
├── presentation.ts           # kind → {lane, collapsible, collapsedByDefault, renderer} registry
├── projection.ts             # pure entries → ModelMessage[] with per-kind visibility rules
├── projection.test.ts        # golden fixtures (legacy chats) + per-kind rules tests
└── context.ts                # gathering walk unchanged; delegates to projection (toCoreMessages removed)

src/lib/agent/
├── loop.ts                   # per-iteration reasoning buffers, self_corrected record, ask persistence hooks
└── loop.test.ts

src/lib/stores/
└── chat.svelte.ts            # persists asks + outcomes (updateOutcome), choices↔user_message link, live entries

src/lib/components/chat/
├── MessageList.svelte        # timeline assembly from entries (+ live), LazyMount retained
├── rows/                     # per-kind renderers (same components serve live variants via `live` props)
│   ├── UserMessage.svelte
│   ├── AssistantMessage.svelte   # Markdown + Highlighter + branch affordances (legacy metadata.reasoning still displayed)
│   ├── ReasoningEntry.svelte
│   ├── ToolActivity.svelte       # grouped call+result unit: header, summary, collapsible detail
│   ├── AskEntry.svelte           # approval / sampling / elicitation (pending → resolved/undecided states)
│   ├── ChoicesOffer.svelte
│   └── SelfCorrected.svelte
└── MessageRow.svelte         # deleted once dispatch is complete (phase 5)

src/lib/ai/generate/
└── generate-gate.ts          # kind-aware gate lookup (kind === 'choices') + legacy fallback

docs/dev/
├── architecture.qmd          # entry-kind model, lanes, live/durable unification
└── seams.qmd                 # projection seam, presentation registry boundary, boot migration runner
```

**Structure Decision**: single-project SvelteKit layout (existing) — all new app modules colocated with their subsystems (`src/lib/chat/` for the kind/entry/projection core, `src/lib/components/chat/rows/` for renderers), server migration code in `server/src/`, shared version constants in `packages/shared/src/`. No new top-level directories, no monorepo restructuring.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None — no constitution violations; the design stays within documented seams (the boot migration runner extends the existing stamped-version seam rather than adding a new one).
