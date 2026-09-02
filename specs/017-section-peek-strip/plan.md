# Implementation Plan: Section Peek Strip

**Branch**: `017-section-peek-strip` (git branch: `add-section-peek-strip`) | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/017-section-peek-strip/spec.md`

## Summary

Add a per-reply navigation strip to long, header-structured assistant messages: one
hairline bar per markdown section along the reply's edge, sized proportionally to
section length, near-invisible at rest. Hovering fattens the bars; a deliberate
~400 ms dwell pops a plain-text preview card (heading + opening lines); clicking a
bar or preview smooth-scrolls the transcript to that section (LazyMount-aware,
stick-to-bottom-safe, reduced-motion-respecting). A persisted settings toggle turns
the feature off entirely. All outline data derives from the reply's markdown via the
existing remark parse (no source mutation); strip/preview selectors join the expound
exclusion list so text selection and highlight alignment stay correct. This feature
builds the shared extraction + jump + flash primitives that the 015 floating outline
(panel) will later consume, but ships only the strip chrome.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 22 (`.nvmrc`), pnpm 10; SvelteKit static
SPA with Svelte 5 runes; no SSR.

**Primary Dependencies**: Svelte 5 (runes), Tailwind v4 (CSS-first tokens in
`src/app.css`), shadcn-svelte (bits-ui) primitives, unified toolchain (`remark-parse`,
`remark-gfm` — same packages `src/lib/markdown/render.ts` already uses), drizzle
(read-only here). **Zero new runtime dependencies.**

**Storage**: One boolean user preference in the existing `settings` key/value table
(`src/lib/db/schema.ts:210-213`) via `repos.settings` (get/set, JSON values). No
schema change, no migration. Section/excerpt data is derived and transient — never
persisted.

**Testing**: Vitest (pglite test driver), colocated `*.test.ts`. Patterns to follow:
pure-logic tests (`src/lib/settings/scroll-spy.test.ts`), jsdom DOM tests
(`src/lib/chat/selection.test.ts`), source-contract tests
(`src/lib/components/chat/rows/AssistantMessage.actions.test.ts`,
`src/routes/chat/[id]/visibility-sentinel.test.ts`).

**Target Platform**: Modern evergreen browsers, desktop (hover) + touch
(tap-to-jump); light and dark themes; static SPA served behind the Mayon server
container.

**Performance Goals**: Strip presence and hover states cause no layout shift and no
scroll-tied work; extraction is memoized and sub-millisecond for reply-length inputs;
no new scroll listeners (strip is pointer-only in this cut — the where-am-I marker is
deferred). Perf probe marks: `mark('strip:extract', …)`, `incRender('SectionStrip')`.

**Constraints**: Must not regress expound/highlight alignment (`selection.ts`
exclusions + `selection.test.ts`); must not fight `LazyMount unmountFar`
(jump = rAF retry ≤5) or the stick-to-bottom effects (jump sets the stick-suppression
flag); must respect `prefers-reduced-motion`; bars need generous hit targets while the
strip must not steal wheel/touch scroll from the transcript.

**Scale/Scope**: Per assistant message; strips only on qualifying replies (≥3
sections, finished streaming, taller than one transcript viewport). One settings
toggle. No server changes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Requirement (constitution) | Status | Notes |
|---|---|---|---|
| I. Code quality | App code calls repositories only; no direct `db` imports in components; SvelteKit `+` prefix respected | ✅ PASS | Preference access is wrapped in a sole-writer module (`src/lib/chat/strip/pref.ts`, the `uiState.ts` pattern); components receive plain data via props. No `+`-prefixed non-route files. |
| I. Code quality | `@mayon/shared` build order respected | ✅ PASS | Feature touches no shared package code. |
| II. Testing | `pnpm check`, `pnpm lint`, `pnpm test` green; new behavior in `src/lib/` tested | ✅ PASS | Pure modules (`sections.ts`, `dwell.ts`, `pref.ts`) get unit tests; `selection.test.ts` gains exclusion fixtures; source-contract tests assert pointer-discipline, motion-reduce, and streaming-gate markup. |
| II. Testing | Bug fixes ship with regression tests | ✅ PASS (n/a) | New feature; the exclusion-list test doubles as the expound regression guard. |
| III. UX consistency | Tailwind v4 + shadcn vocabulary; match existing visual conventions; hairlines articulate surfaces | ✅ PASS | Bars use `--border`/`--muted-foreground`/`--ring` tokens; preview card reuses the popover surface idiom (`bg-popover text-popover-foreground border-border shadow-md`); rest state is a `--border` hairline per the 012 low-contrast ruling. No new primitives needed. |
| III. UX consistency | Progressive capability detection | ✅ PASS (n/a) | Client-only UI feature; adds no server capability dependence. |
| IV. Performance | Perf-sensitive changes measured with the probe before/after | ✅ PASS | Quickstart includes probe validation (`[mayon-perf]` summary) for scroll/hover scenarios; extraction wrapped in `mark()`. |
| IV. Performance | No synchronous reindex/heavy work; bundle growth justified | ✅ PASS | Zero new dependencies; extraction reuses the installed remark parser (also adopted-by-design in 015's contract §4). |
| Quality gates | Gate order: `pnpm check` → `pnpm lint` → `pnpm test` | ✅ PASS | Recorded in quickstart; tasks must run gates before merge. |
| Seams | Deviating from a documented seam requires amendment | ✅ PASS | Storage via existing settings KV + repository; scroll access via `scroll-bus.ts`/`closest('.overflow-y-auto')`; jump orchestration stays in the chat page (014 split: components pure / page orchestrates) — all documented seams. |

**Post-design re-evaluation (after Phase 1)**: Re-checked with the contracts in
`contracts/section-strip.md`. One deliberate, spec-mandated deviation from 015's
contract §6.1 is enumerated and safe: 015 placed its chrome *outside* the message
container and therefore left `EXCLUDED_CHROME_SELECTORS` untouched; 017's strip and
preview *are* text-bearing chrome inside the message container, so they register
their selectors there and extend `selection.test.ts` — exactly the future case 015
§6.1 anticipated. No gate violations. Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/017-section-peek-strip/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/
│   └── section-strip.md # Phase 1 output: module/component/interaction contracts
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── markdown/
│   │   ├── sections.ts            # NEW: pure section extraction (mdast walk, memoized)
│   │   └── sections.test.ts       # NEW: unit tests (exclusions, offsets, excerpts, threshold)
│   ├── chat/
│   │   ├── selection.ts           # EDIT: EXCLUDED_CHROME_SELECTORS += strip/preview selectors
│   │   ├── selection.test.ts      # EDIT: fixtures proving alignment ignores strip/preview text
│   │   └── strip/
│   │       ├── pref.ts            # NEW: settings sole-writer for the strip toggle
│   │       ├── pref.test.ts       # NEW: defensive reads, persistence round-trip (pglite)
│   │       ├── dwell.ts           # NEW: pure hover-intent / dwell-decision helpers
│   │       └── dwell.test.ts      # NEW: sweep immunity, prompt dismissal, timing edges
│   └── components/
│       ├── chat/
│       │   ├── strip/
│       │   │   └── SectionStrip.svelte   # NEW: bars + dwell preview (presentation-only)
│       │   └── rows/
│       │       └── AssistantMessage.svelte  # EDIT: eligibility, strip mount, onJump plumbing
│       └── settings/                     # EDIT: toggle control in an existing section
└── routes/
    └── chat/[id]/
        └── +page.svelte           # EDIT: section-jump orchestration + stick suppression
```

Tests are colocated beside each source file. `MessageList.svelte` gains only a
prop-plumbing pass-through for `onJumpToSection` if needed.

**Structure Decision**: Single-project SvelteKit layout, unchanged. The feature is a
chat-UI vertical slice: pure logic in `src/lib/markdown` + `src/lib/chat/strip`,
one presentation component under `src/lib/components/chat/strip/`, orchestration in
the chat page (owner of the scroll container, stick flag, and hash grammar), and a
settings toggle in the existing `/settings` page. No new routes, no server code, no
schema/migration.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None — all gates pass; no constitution deviations require justification.
