# Implementation Plan: Settings Page Navigation

**Branch**: `014-settings-navigation` | **Date**: 2026-08-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/014-settings-navigation/spec.md`

## Summary

Make every section of the single `/settings` page reachable in one interaction: a sticky anchor rail (desktop) mirroring the page's real section headings with scroll-spy highlight, a visible search field (+ cmd-K, scoped to settings) over a static section index with aliases, URL hash anchors with strict history discipline (push on explicit jump only, replace on scroll-spy), a mobile floating jump button opening a compact section sheet, and brief heading flash on arrival. Nothing unmounts; the page keeps its current section set and order (Providers, MCP Servers, Learner profile, Expound Instructions, Lab generation prompt, Quiz generation prompt, Data, conditional Sandbox DB).

Technical approach: pure client-side UI work. Sections get stable DOM anchor ids; an IntersectionObserver rooted at the app shell's `<main>` scroll container drives the highlight; SvelteKit shallow-routing history helpers (`pushState`/`replaceState` from `$app/navigation`) implement the hash discipline; the existing shadcn `command` (cmdk) and `sheet` primitives provide search and the mobile overlay with zero new dependencies. Jump/spy/hash logic is extracted into testable modules under `src/lib/settings/`.

## Technical Context

**Language/Version**: TypeScript (Svelte 5 runes components) on SvelteKit 2, Node 22, pnpm 10

**Primary Dependencies**: SvelteKit 2 (adapter-static SPA, `ssr = false`), Tailwind v4 (CSS-first), shadcn-svelte / bits-ui (`command`, `sheet`, `popover`, `dialog` already present). **No new dependencies.**

**Storage**: N/A — no database or persisted state; the section index is static code. Existing `settings`-table and repository seams untouched.

**Testing**: Vitest 4 (root `vite.config.ts`; node environment by default, `// @vitest-environment jsdom` pragma available). Established convention: unit tests for `src/lib/*.ts` logic; source-reading assertions for `.svelte` files (no component mount library).

**Target Platform**: Modern evergreen browsers; desktop and mobile web; SPA served by the server container.

**Performance Goals**: Scrolling `/settings` remains jank-free with the rail/search mounted (perf probe longtask/frame metrics unchanged vs. baseline); jump produces visible scroll response immediately (< 1 frame delay for handler work); scroll-spy does no layout thrash (IntersectionObserver only, no per-scroll-event DOM reads).

**Constraints**: No new runtime dependencies; cmd-K on other pages must keep its existing global `/search` behavior; hash updates from scrolling must never create history entries; explicit jumps create exactly one; reduced-motion preference honored; conditional sections (Sandbox DB) appear/disappear from all affordances with server capability.

**Scale/Scope**: One route (`/settings`), 8 sections (7 always + 1 capability-conditional), 3 new UI regions (rail, search field, mobile floating button + sheet), 2–4 new logic modules, edits to 2 existing files (`settings/+page.svelte`, `ProviderConfig.svelte` shell) plus `app.css`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Code Quality — repositories-only data access | ✅ Pass | Feature touches no data access; no `db` imports outside `src/lib/db/`. Static section index is plain code. |
| I. Layering / seams | ✅ Pass | New code is UI + pure client logic under `src/lib/settings/`; no documented seam crossed. |
| I. Quality gates `pnpm check` / `pnpm lint` | ✅ Planned | Both run in quickstart validation before merge. |
| II. Testing — new `src/lib/` behavior has tests | ✅ Planned | Jump/hash/filter logic extracted to `src/lib/settings/*.ts` with unit tests; `.svelte` wiring via source-assertion tests (existing convention). UI-only presentation additionally smoke-tested per constitution. |
| II. No `search_vec` writes / reindex paths | ✅ N/A | Unrelated to full-text search. |
| III. UX consistency — Tailwind v4 + shadcn vocabulary | ✅ Pass | Reuses existing `command`, `sheet`, heading recipe (`text-sm font-semibold uppercase tracking-wide text-muted-foreground`), `inputClass`, border/muted tokens, `.tip` pattern; no new primitives. |
| III. Progressive capability detection | ✅ Pass | Sandbox DB section visibility derives from `serverStatus.has('sandbox-db')`; rail/search/floating list derive from the same source (FR-012). |
| III. No downtime / no server restarts | ✅ N/A | Pure client feature. |
| III. Expound offsets / selection invariants | ✅ N/A | No markdown/DOM-range work. |
| IV. Perf probe before/after for perf-sensitive changes | ✅ Planned | Scroll-path change → probe measurement with `mayon_perf_scenario = 'settings-nav'` recorded in quickstart before/after. |
| IV. Bundle growth justified | ✅ Pass | Zero new dependencies; uses already-bundled bits-ui primitives. |

**Post-design (Phase 1) re-check**: ✅ still pass — contracts introduce no storage access, no new dependencies, and no seam changes; see Complexity Tracking (empty).

## Project Structure

### Documentation (this feature)

```text
specs/014-settings-navigation/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── settings-navigation.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── settings/                      # NEW: navigation logic (pure, unit-testable)
│   │   ├── sections.ts                # Static section index (id, label, aliases, cap, order)
│   │   ├── scroll-spy.ts              # IntersectionObserver-based active-section tracker
│   │   ├── hash-sync.ts               # Hash discipline: push/replace/parse/popstate rules
│   │   └── sections.test.ts           # + hash-sync.test.ts, scroll-spy.test.ts
│   └── components/
│       └── settings/                  # NEW components (presentation only)
│           ├── SettingsRail.svelte
│           ├── SettingsSearch.svelte
│           ├── MobileSectionJump.svelte
│           └── SettingsRail.render.test.ts   # source-assertion style tests
├── routes/
│   └── settings/
│       └── +page.svelte               # EDIT: mount rail/search/mobile jump, wrap sections with anchor ids
├── components/ai/
│   └── ProviderConfig.svelte          # EDIT: add `id` to the Providers section (shell-owned section)
└── app.css                            # EDIT: `section-flash` utility (mirrors existing msg-flash pattern)
```

**Structure Decision**: Single SPA app (existing topology). All new logic lives in `src/lib/settings/` as pure modules so it satisfies the constitution's testing rule without a component-test harness; presentation lives in `src/lib/components/settings/` following the existing component layout; the route file composes them. Only two existing files need edits beyond the new code (the settings route and the `ProviderConfig` shell for the shell-owned Providers section anchor).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | | |
