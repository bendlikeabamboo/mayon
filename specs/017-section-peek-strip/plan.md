# Implementation Plan: Section Peek Strip

**Branch**: `017-section-peek-strip` (git branch: `add-section-peek-strip`) | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/017-section-peek-strip/spec.md`

## Summary

Add a per-reply navigation strip to long, header-structured assistant messages: one
thin horizontal tick per markdown section, in a slim gutter **outside the chat
area** — immediately right of the transcript's scrollbar (chat → scrollbar →
ticks), left-aligned at the chat border, width proportional to section length,
near-invisible at rest and **scroll-synced** so ticks stay beside their sections.
Hovering brightens the ticks and extends the hovered one a bit rightward; a
deliberate ~400 ms dwell pops a **floating preview window anchored outside the chat
area** (heading + opening lines); clicking a tick or preview smooth-scrolls the
transcript to that section (LazyMount-aware, stick-to-bottom-safe,
reduced-motion-respecting). A persisted settings toggle turns the feature off
entirely — releasing the gutter reservation, so layout returns to pre-feature
geometry. All outline data derives from the reply's markdown via the existing
remark parse (no source mutation); strip/preview selectors join the expound
exclusion list so text selection and highlight alignment stay correct. This feature
builds the shared extraction + jump + flash primitives that the 015 floating
outline (panel) will later consume, but ships only the strip chrome.

> **2026-09-02 owner refinement (post-first-cut)**: the strip moved from inside the
> message wrapper to the outside-the-scroll-container gutter described above, bars
> became thin horizontal ticks with extend-on-hover, and the preview became a
> floating window outside the chat area. Contracts §4–§7 and the tasks' Phase 7
> carry the delta; the first-cut in-message `SectionStrip.svelte` is replaced by
> the page-level `SectionStripGutter.svelte`.

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

**Performance Goals**: Strip presence and hover states cause no layout shift; the
gutter's scroll sync is a single passive, rAF-throttled listener updating one
transform (no per-frame layout reads; anchor measurement only at invalidation
time); extraction is memoized and sub-millisecond for reply-length inputs. Perf
probe marks: `mark('strip:extract', …)`, `incRender('SectionStripGutter')`.

**Constraints**: Must not regress expound/highlight alignment (`selection.ts`
exclusions + `selection.test.ts`); must not fight `LazyMount unmountFar`
(jump = rAF retry ≤5) or the stick-to-bottom effects (jump sets the stick-suppression
flag); must respect `prefers-reduced-motion`; ticks need generous hit targets while
the gutter must not steal wheel/touch scroll from the transcript; the scroll-sync
listener is the feature's ONLY scroll listener (amended invariant, contracts §10.2).

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

**Post-design re-evaluation (after Phase 1, amended 2026-09-02)**: Re-checked with
the contracts in `contracts/section-strip.md`. The enumerated deviation from 015's
contract §6.1 remains and is safe: 015 placed its chrome *outside* the message
container and therefore left `EXCLUDED_CHROME_SELECTORS` untouched; 017 registers
its strip/preview selectors there (first cut: chrome inside the message container;
refinement: the gutter moved outside the message containers too, but the selectors
stay registered and tested as belt-and-braces for any text-bearing strip chrome) —
exactly the future case 015 §6.1 anticipated. The refinement's one invariant change
(the single scroll-sync listener) is recorded in contracts §10.2. No gate
violations. Complexity Tracking stays empty.

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
│   │   ├── sections.ts            # pure section extraction (mdast walk, memoized)
│   │   └── sections.test.ts       # unit tests (exclusions, offsets, excerpts, threshold)
│   ├── chat/
│   │   ├── selection.ts           # EXCLUDED_CHROME_SELECTORS += strip/preview selectors
│   │   ├── selection.test.ts      # fixtures proving alignment ignores strip/preview text
│   │   └── strip/
│   │       ├── pref.ts            # settings sole-writer for the strip toggle
│   │       ├── pref.test.ts       # defensive reads, persistence round-trip (pglite)
│   │       ├── dwell.ts           # pure hover-intent / dwell-decision helpers
│   │       ├── dwell.test.ts      # sweep immunity, prompt dismissal, timing edges
│   │       ├── registry.ts        # NEW (refinement): context registry of StripAnchors
│   │       └── registry.test.ts   # NEW (refinement): upsert/bump/unregister reactivity
│   └── components/
│       ├── chat/
│       │   └── strip/
│       │       └── SectionStripGutter.svelte  # NEW (refinement): gutter ticks + scroll
│       │                                      # sync + floating preview (replaces the
│       │                                      # first-cut in-message SectionStrip.svelte)
│       └── settings/                      # toggle control in an existing section
└── routes/
    └── chat/[id]/
        └── +page.svelte           # gutter mount + viewport inset + jump orchestration
```

The refinement removes the first-cut `SectionStrip.svelte`, the
`onJumpToSection`/`stripEnabled` prop threading through
`MessageList`/`AssistantMessage` (replaced by context), and the in-message strip
mount; `AssistantMessage` registers eligible replies into the registry instead.

**Structure Decision**: Single-project SvelteKit layout, unchanged. The feature is a
chat-UI vertical slice: pure logic in `src/lib/markdown` + `src/lib/chat/strip`, one
page-level gutter component under `src/lib/components/chat/strip/`, orchestration in
the chat page (owner of the scroll container, stick flag, gutter reservation, and
hash grammar), and a settings toggle in the existing `/settings` page. No new
routes, no server code, no schema/migration.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None — all gates pass; no constitution deviations require justification.
