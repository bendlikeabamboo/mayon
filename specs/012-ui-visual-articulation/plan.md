# Implementation Plan: UI Visual Articulation Pass

**Branch**: `feat/ui_overhaul` (speckit setup ref: `012-ui-visual-articulation`) | **Date**: 2026-08-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-ui-visual-articulation/spec.md`

## Summary

A restyle-and-affordance pass over the entire Mayon SPA that teaches the interface to communicate without changing architecture, density, type family, or the deliberately soft text contrast. Token level: one warm amber/terracotta accent (folded into the existing `--primary`/`--ring` shadcn vocabulary per theme) and a three-step surface ladder (canvas < panel < raised card) expressed with hairline borders + subtle shadows. Component level: composer becomes a docked rounded instrument card with persisted-artifact launchers (branch → tree node, quiz me, open lab) wired to existing store/repo creation paths; home is rebuilt around greeting + hero/resume + starter chips; message copy/branch/regenerate consolidate into hover-revealed actions; tree gains caret rotation + connector lines; dual status rows collapse into one compact popover indicator; header brief/persona chips merge into one summary chip whose expansion persists per chat via the settings KV; chat/quiz/lab lists share one RowCard grammar; route entries get a motion-reduce-aware stagger-fade; dark theme warms to charcoal while preserving lightness levels.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Svelte 5 (runes), SvelteKit 2 static SPA (`@sveltejs/adapter-static`, no SSR), Node 22 (`.nvmrc`), pnpm 10 (pins are constitutionally mandatory)

**Primary Dependencies**: Tailwind v4 CSS-first (`src/app.css` single token file), shadcn-svelte on bits-ui v2 (alert/badge/button/collapsible/command/dialog/dropdown-menu/sheet wrappers present), drizzle-orm over the `StorageDriver` seam, `@mayon/shared` workspace package (tsup build order matters)

**Storage**: PostgreSQL 17 behind the only storage seam `src/lib/db/driver/types.ts` (`query`/`batch`/`exec`); browser driver is `RemotePgDriver` → `POST /api/db/query`; tests use pglite. **No schema change is planned for this feature** — artifact launchers ride existing repositories; the new per-chat display preference lives in the existing settings KV (`repos.settings.get/set`).

**Testing**: Vitest run-once via `pnpm test` (environment `node`, pglite DB driver). Repo convention for UI components: colocation-source-text assertion tests (see `src/lib/components/chat/*.test.ts`); logic gains colocated unit tests; UI styling verified via `pnpm check` + manual smoke on `pnpm dev`.

**Target Platform**: Modern evergreen desktop-first browsers, self-hosted via Docker compose (dev stack `mayon-dev`; prod images GHCR). Keyboard + coarse-pointer parity expected throughout.

**Project Type**: pnpm monorepo: `src/` (web SPA) + `server/src/` (Node container) + `packages/shared`.

**Performance Goals**: Route entry animation completes ≤ 500 ms total including stagger; hover feedback perceptible within one frame budget (< 100 ms); loading placeholders only where load measurably exceeds ~300 ms (verified with existing states, none today qualify); no regression in perf-probe frame timing / longtasks after the pass (`window.__MAYON_PERF__ = 1` before/after comparison).

**Constraints**: From spec guiding principles — GP-1 edges-not-brightness (no text/background contrast raises, gentle adjacent-level luminance deltas), GP-2 single sans family (`Bpmf Huninn` stack; both `--font-sans`/`--font-serif` already resolve sans — keep it that way), GP-3 every composer interaction terminates in a persisted artifact, GP-4 compress-but-keep all status facts reachable in ≤ 2 actions, GP-5 exactly one accent hue reserved for actionable emphasis (status greens stay status-only). No new runtime dependencies anticipated (popover comes free with existing bits-ui).

**Scale/Scope**: Cross-cutting restyle touching the shared shell (AppShell/Sidebar), Composer, home route, chat page header/message rows, tree page, chat/quiz/lab lists, status components, and the two-theme token block in `app.css`. Three structural rebuilds (composer footprint, home composition, status/chip consolidation); everything else is class/token-level edits atop the same DOM intent.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Evidence / Notes |
|---|---|---|
| I. Layering (repos only; StorageDriver sole seam) | PASS | Artifact launchers call `chatStore`/`quizzesStore`/`labsStore` which already route through `repos.*`; no component imports `db`; no driver changes; no SQL outside repositories. |
| I. Toolchain pins & quality gates | PASS | Node 22/pnpm 10 respected; `pnpm check` + `pnpm lint` listed in quickstart as per-change gates. |
| I. No secrets / `+` prefix rules | PASS | No secret-bearing additions; no non-route `+` filenames introduced; new popover wrapper goes under `src/lib/components/ui/popover/`. |
| II. Tests (`pnpm test`; server suite untouched) | PASS | New logic (per-chat UI-state helper, launcher orchestration, status aggregator merge) gets colocated Vitest units; component expectations follow the repo's source-text assertion style; no server-side behavior change ⇒ server suite unaffected. |
| II. Regression-test discipline, search_vec inviolate | PASS | Search columns never written; no reindex/rebuild affordance enters scope. |
| III. Established Tailwind v4 + shadcn-svelte vocabulary | PASS | Surface ladder and accent ride existing token slots (`--primary`, `--ring`, `--card`, `--border`, shadows); new primitives limited to the standard bits-ui Popover wrapper consistent with the library already in `package.json`; prior hand-rolled popovers stay untouched. |
| III. Progressive enhancement (`detectServer()` gating) | PASS | Compact status indicator renders degraded/off states for server-absent (`serverStatus.connected === false`) instead of vanishing facts; launchers reuse whatever gating `chatStore.send` already applies; no code assumes the server. |
| III. No downtime operations; expound seams intact | PASS | Pure client-side UI work; source map/DOM-alignment modules untouched; hover-revealed actions must respect selection layering ( Highlighter/ContextMenu z-order) — tracked as a design requirement, no API change. |
| IV. Perf probe before/after; no unmeasured claims | PASS | Quickstart mandates probe runs around the motion/hover work; stagger-fade ≤ 500 ms budget asserted manually. |
| IV. Bundle growth justification | PASS | Zero new npm dependencies; no new fonts/assets; possibly a net **reduction** by dropping unused `@font-face` payloads flagged in research R-12 (done only if cheap — optional hygiene). |
| Quality Gates: migrations via `pnpm db:generate` | PASS (vacuous) | **No schema migration in this feature.** Settings-key convention documented in `contracts/settings-keys.md` uses the existing KV table. |

**Post-design re-check (Phase 1)**: re-evaluated after research/data-model — all verdicts stand. Complexity Tracking remains empty: no violations requiring justification.

## Project Structure

### Documentation (this feature)

```text
specs/012-ui-visual-articulation/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── design-tokens.md
│   ├── settings-keys.md
│   └── composer-launchers.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Existing monorepo layout is reused verbatim — no new apps/packages. Files marked ● are created; ◐ are rebuilt-in-place; everything else receives token/class-level edits.

```text
src/
├── app.css                                  # ◐ token block: accent into --primary/--ring, ladder vars, warm-charcoal .dark retune, stagger/motion-reduce utilities
├── lib/
│   ├── components/
│   │   ├── AppShell.svelte                  # · canvas role confirmation
│   │   ├── Sidebar.svelte                   # ◐ quiet side role; footer swaps two status rows → one StatusIndicator
│   │   ├── StatusIndicator.svelte           # ● compact icon/dot + bits-ui popover (DbStatus+ServerStatus merged)
│   │   ├── DbStatus.svelte                  # ◐ reduced to readout content served to the popover
│   │   ├── ServerStatus.svelte              # ◐ same
│   │   ├── RowCard.svelte                   # ● shared list-row grammar (title · timestamp · progress slot)
│   │   ├── Pagination.svelte                # · restyle only
│   │   └── ui/popover/                      # ● shadcn-svelte wrapper over existing bits-ui popover primitive
│   │       └── index.ts
│   ├── stores/
│   │   ├── chat.svelte.ts                   # · launchers consume existing createAndNavigate/branchFromMessage (no signature change expected)
│   │   ├── labs.svelte.ts                   # · consumer of generate()/saveRaw()
│   │   └── quizzes.svelte.ts                # · consumer of generate()
│   ├── services/status.svelte.ts            # · aggregation source for StatusIndicator
│   └── chat/
│       ├── uiState.ts                       # ● per-chat display-preference helper over settingsRepo (key contract: contracts/settings-keys.md)
│       └── starters.ts                      # ● home starter-chip derivation (curriculum-aware, generic fallback)
├── routes/
│   ├── +page.svelte                         # ◐ home: greeting + hero composer / resume card + starter chips; recents demoted
│   ├── chat/[id]/+page.svelte               # ◐ column/card containment; chip consolidation w/ chevron + persistence; wire row actions
│   ├── chat/+page.svelte                    # · RowCard adoption
│   ├── quiz/+page.svelte                    # · RowCard adoption (progress slot)
│   ├── lab/+page.svelte                     # · RowCard adoption
│   └── tree/+page.svelte                    # ◐ caret rotation transitions + connector lines between parent/child
└── lib/components/chat/
    ├── Composer.svelte                      # ◐ rounded bordered instrument card (max-w ~3xl footprint retained from column), docked controls, launcher chips
    └── rows/
        ├── AssistantMessage.svelte          # ◐ hover/tap-revealed action row (copy · branch · regenerate) consolidating existing handlers
        └── UserMessage.svelte               # · token ripples review (--highlight / dark:bg-primary interplay)
tests/                                      # fixtures only (unchanged role)
server/src/                                 # no changes required by this feature
packages/shared/                            # no changes required by this feature
```

**Structure Decision**: Remain inside the established `src/lib/components|stores|services|chat` + `src/routes` arrangement mandated by the architecture doc; the only new module locations are the idiomatic `components/ui/popover` wrapper, `lib/chat/uiState.ts`, and `lib/chat/starters.ts`, mirroring sibling seams (`selection.ts`, `tree.ts`). Design documentation lives beside the spec as listed above.

## Complexity Tracking

> Filled only for unjustifiable-otherwise violations — **none.** The heaviest liberty taken anywhere is merging two pre-existing status components into one; it removes rather than adds structure and keeps every fact reachable (contract: `contracts/design-tokens.md` §status; spec GP-4 / FR-18).
