# Implementation Plan: Branch Back-Propagation (Anchored Context Artifacts)

**Branch**: `020-branch-backprop` | **Date**: 2026-09-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/020-branch-backprop/spec.md`

## Summary

Branched chats gain an explicit, user-controlled "back-propagate" action that lands the
branch outcome into the immediate parent chat as a persisted, collapsible message entry
of a new `branch_artifact` kind — anchored exactly at the branch point via fractional
`ord` placement — in two payload modes: the raw branch delta (branch-only turns +
anchored excerpt, verbatim) or a model-written summary. The operation is purely additive
(single-row insert; existing rows never rewritten), steers every future composition of
the parent, and is invisible to pre-existing sibling branches. Technically this rides
the existing `messages.kind` abstraction and the client-side composition path
(`assembleContext` → `projectEntries`), reuses the one-shot LLM generation precedent for
summaries, and requires one drizzle-generated migration (`messages.ord` →
`double precision`) plus a kind-adoption checklist across types, repos, projection,
search filter, and rendering.

## Technical Context

**Language/Version**: TypeScript on Node 22 (`.nvmrc`), pnpm 10; SvelteKit (Svelte 5
runes) static SPA + Node/Fastify server; `@mayon/shared` for shared types.

**Primary Dependencies**: Svelte 5 runes, Tailwind v4 + shadcn-svelte (bits-ui),
drizzle ORM (Postgres), Vercel AI SDK v5 (client-side `streamText`/`generateText`).
No new dependencies.

**Storage**: Postgres 17 behind the `StorageDriver` seam (browser → `RemotePgDriver` →
`POST /api/db/query`); pglite in tests. Drizzle file migrations + server schema-version
stamp; `search_vec` is a generated column (never written).

**Testing**: `pnpm test` (Vitest, pglite driver) for lib/repo/projection logic;
`pnpm --filter @mayon/server test` for the migration/boot path; `pnpm check` + manual
smoke for UI-only collapse rendering.

**Target Platform**: Browser SPA (desktop) with required server; Chrome/Firefox/Safari
current.

**Project Type**: Web application (SvelteKit SPA + stateless Fastify sidecar; the chat
turn path is entirely client-side).

**Performance Goals**: Raw propagation lands < 2 s (single-row insert); summary within
normal model latency (< 30 s typical); no long tasks > 50 ms during insert/render
(constitution: measured with the perf probe if any risk is observed).

**Constraints**: Purely additive at propagation time — no existing row rewritten
(FR-005/SC-003); no rebalancing path for `ord` may exist; no silent truncation of the
delta; feature requires only capabilities chats already use (no new server capability).

**Scale/Scope**: Single-user self-hosted instance; scope = 1 new message kind, 1
repo insert function + 1 guarded update function, 1 drizzle migration, projection/search/
rendering touchpoints, propagate control + artifact component. No new tables.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
| --- | --- | --- |
| I. Code quality / layering | ✅ Pass | All writes via `messagesRepo` (new `insertAnchored`, guarded `updateArtifactContent`); no direct `db` access; `StorageDriver` seam untouched (dumb executor unchanged). Gates `pnpm check`/`pnpm lint` in quickstart. |
| I. No secrets | ✅ Pass | Provider keys stay in IndexedDB behind the existing keychain fetch; nothing new. |
| I. No `+`-prefixed non-route files | ✅ Pass | New files: `src/lib/chat/propagation.ts`, `src/lib/ai/generate/generate-branch-artifact-summary.ts`, `src/lib/components/chat/PropagatedArtifact.svelte` — none routed. |
| II. Testing standards | ✅ Pass | New behavior in `src/lib/` ships with Vitest (pglite) coverage: midpoint placement, projection mapping, delta builder, anchor resolution, search filter, migration boot. UI-only collapse rendering via `pnpm check` + manual smoke per constitution. |
| II. search_vec invariants | ✅ Pass | Generated column never written; only the query-time kind filter string extends (`search.ts:97`); no reindex path. |
| III. UX consistency | ✅ Pass | Artifact reuses the established collapsible-entry pattern (`ReasoningEntry`/`ToolActivity` vocabulary); no new primitives or dependencies. |
| III. Progressive degradation | ✅ Pass | Requires nothing beyond what chats already require (pg-backed storage); no new advertised capability; UI control appears only in branch chats with divergence. |
| III. No downtime operations | ✅ Pass | Migration rides the normal boot path (drizzle, additive type change, lossless cast); no restart semantics beyond standard bring-up; no restore-path changes. |
| III. Expound/selection invariants | ✅ Pass | No change to offsets/source-map/DOM alignment; artifact is its own message wrapper; its chrome follows injected-DOM conventions outside selectable text. |
| IV. Performance | ✅ Pass | Single-row insert; midpoint resolution (~2^53) makes collision impossible at any realistic volume, so no rebalance path is even tempting. No bundle growth (zero new deps). Perf-probe spot-check included in quickstart. |
| Quality gates: migrations | ✅ Pass | `ord` type change generated via `pnpm db:generate` (first `ALTER COLUMN TYPE` in `drizzle/`, lossless int→double, no data transform → no `schema-migrations` entry; old-dump restore coerces automatically). No hand-edited SQL. |
| Quality gates: seam deviations | ✅ Pass | No documented seam is deviated from; `branch_artifact` extends the `messages.kind` abstraction exactly as Card 001 ruled (`ideas/008-branch-context-sync/decisions.md`). |

**Gate result**: no violations; Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/020-branch-backprop/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions R1–R9, all resolved
├── data-model.md        # Phase 1 output — artifact row, metadata, ord placement
├── quickstart.md        # Phase 1 output — validation scenarios
├── contracts/           # Phase 1 output
│   ├── kind-adoption.md     # Seam contract: types, repo, composition, search, UI
│   └── propagation-flow.md  # User-flow contract: control, modes, failure modes
└── tasks.md             # Phase 2 output ($speckit-tasks — NOT created here)
```

### Source Code (repository root)

Existing SvelteKit layout; the feature touches only these areas:

```text
src/
├── lib/
│   ├── db/
│   │   ├── schema.ts                        # kind enum + ord → doublePrecision
│   │   └── repositories/
│   │       └── messages.ts                  # insertAnchored, updateArtifactContent
│   ├── chat/
│   │   ├── kinds.ts                         # EntryKind / ALL_KINDS / laneOf
│   │   ├── propagation.ts                   # NEW — delta builder + anchor resolution
│   │   ├── projection.ts                    # branch_artifact → user message w/ framing
│   │   └── context.ts                       # (verification only: exclusion sets unchanged)
│   ├── ai/
│   │   └── generate/
│   │       └── generate-branch-artifact-summary.ts   # NEW — one-shot summary
│   ├── stores/
│   │   └── chat.svelte.ts                   # propagateToParent(mode) orchestration
│   └── components/
│       └── chat/
│           ├── PropagatedArtifact.svelte    # NEW — collapsible artifact entry
│           └── MessageList.svelte           # render case for the new kind
├── routes/
│   └── chat/[id]/+page.svelte               # back-propagate control (branch chats)
drizzle/
└── 0004_*.sql                               # generated: ord → double precision
tests (colocated *.test.ts per repo convention) — placement, projection, delta,
      anchor resolution, search filter, migration boot
```

**Structure Decision**: Single-app SvelteKit layout as-is (constitution: existing
vocabulary; Card 005: no separate store/service). Client-side orchestration mirrors the
existing store → repo → `$state` flow; no server changes beyond the generated migration
applied at boot.

## Complexity Tracking

> Empty — Constitution Check passed with no violations requiring justification.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
