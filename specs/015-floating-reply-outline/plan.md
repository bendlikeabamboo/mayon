# Implementation Plan: Floating Reply Outline

**Branch**: `015-floating-reply-outline` | **Date**: 2026-08-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/015-floating-reply-outline/spec.md`

## Summary

Long assistant replies that use markdown headings are hard to navigate. We add a floating,
non-reflowing outline panel to the chat view: it lists the currently-read reply's document
headings (in order, nested by level), lets the user click an entry to scroll that heading to
the top of the viewport with a brief emphasis, and highlights the in-view section while
scrolling. Below the desktop breakpoint it becomes a floating button opening a compact
overlay. Entries are derived from the reply's markdown at view time — no new stored data, no
new dependencies — and the panel lives outside every message container so the expound/
highlight offset machinery is untouched. Interaction conventions (section-top landing, flash,
scroll-spy band, reduced motion, mobile sheet) are reused from the Settings navigation feature.

## Technical Context

**Language/Version**: TypeScript 5.x, SvelteKit SPA on Svelte 5 (runes), Node 22, pnpm 10

**Primary Dependencies**: SvelteKit + Svelte 5, Tailwind v4 (CSS-first), shadcn-svelte (bits-ui) for Sheet/Button, unified/remark/rehype markdown pipeline (`src/lib/markdown/render.ts`), existing `createScrollSpy`/`resolveActive` (`src/lib/settings/scroll-spy.ts`), `subscribeScroll` (`src/lib/chat/scroll-bus.ts`), perf probe (`src/lib/perf/`)

**Storage**: None. Outline entries and panel state are view-time presentation state (spec FR-014); message content is read through the existing chat store, which is the only path to `repos.messages`.

**Testing**: Vitest (`pnpm test`; node default environment, jsdom opt-in per file), `pnpm check` (svelte-check), `pnpm lint` (ESLint + Prettier)

**Target Platform**: Browser (SPA). Feature is client-only; no server capability gates apply, and it must not assume the server is present.

**Project Type**: Web application (SPA + server; this feature touches only the SPA)

**Performance Goals**: Heading extraction memoized per content string (O(content) parse only on change); scroll-spy driven by IntersectionObserver + `scrollend`, no per-frame scroll work; outline causes no measurable frame-time regression during streaming (verify with perf probe marks `outline:extract` / render counts `ReplyOutline`)

**Constraints**: Zero new runtime dependencies; outline DOM must stay outside Highlighter containers (expound alignment invariant); jumps during streaming must defeat stick-to-bottom force-scroll; heading elements may be unmounted at any distance (`LazyMount unmountFar`, rootMargin 1200px); no URL/hash writes (chat owns `#m=<msgId>&b=<branchId>`)

**Scale/Scope**: One feature area of the chat view: ~3 new lib modules, ~3 new components, colocated unit tests; all conversations benefit, largest reply sizes bounded by model output (tens of headings).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Layering (repos only) | ✅ Pass | Outline reads reply content via props/chat store; zero direct `db`/driver imports; nothing new touches `StorageDriver`. |
| I. Quality gates (`pnpm check`/`lint`) | ✅ Pass | Gate commands run before merge; no toolchain changes. |
| II. Testing standards | ✅ Pass | New pure logic in `src/lib/` ships with unit tests (extractor, active-heading resolver); presentation components verified via `pnpm check` + source-contract tests (014 pattern) + manual smoke. No bug fix, so no regression-test obligation. |
| II. `search_vec` invariants | ✅ Pass | Untouched. |
| III. UX consistency (Tailwind + shadcn vocabulary) | ✅ Pass | Panel/Sheet/Button reuse existing primitives and the `bg-popover`, `z-40/z-50`, safe-area, and `pointer-events-none` wrapper conventions; flash reuses the `section-flash` keyframe vocabulary. |
| III. Progressive degradation | ✅ Pass | Client-only; no advertised server capability assumed. |
| III. Expound/highlight invariants | ✅ Pass by design | Outline is rendered as a sibling of the chat scroller, never inside Highlighter/`.markdown-body`; it injects no text nodes into message containers, so `EXCLUDED_CHROME_SELECTORS` needs no change and alignment cannot break. Jump/flash mutate heading classes only (attributes), which Highlighter's MutationObserver ignores. Verified in quickstart §5. |
| IV. Perf measured with probe | ✅ Pass | Quickstart includes before/after probe comparison with `window.__MAYON_PERF__ = 1`; new marks/renders counters added. |
| IV. Bundle growth justified | ✅ Pass | Zero new dependencies — heading extraction reuses the installed remark parser; no rehype-slug/github-slugger adopted. |
| Quality gates: migrations | ✅ Pass | No schema change (FR-014 forbids new durable data). |

**Gate result: PASS — no violations to justify.**

## Project Structure

### Documentation (this feature)

```text
specs/015-floating-reply-outline/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── reply-outline.md # UI + module contracts
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/lib/markdown/
├── headings.ts                # NEW: pure heading extraction from raw markdown (mdast)
└── headings.test.ts           # NEW: unit tests (code fences, admonitions, setext, gate fence)

src/lib/chat/outline/
├── entries.ts                 # NEW: pure outline-state logic (entry identity, active-heading
│                              #   resolver, mount-aware observation sync over rect-like inputs)
├── entries.test.ts            # NEW: unit tests (pure, pattern of settings/scroll-spy.test.ts)
└── flash.ts                   # NEW: shared flash-element helper (section-flash vocabulary)

src/lib/components/chat/outline/
├── ReplyOutlinePanel.svelte   # NEW: desktop floating panel (presentation-only)
├── ReplyOutlineToggle.svelte  # NEW: compact floating button (mobile/narrow + collapsed state)
└── ReplyOutlineSheet.svelte   # NEW: bottom-sheet entry list for narrow viewports

src/lib/components/chat/rows/AssistantMessage.svelte   # touched: minor (none or heading registration only)
src/routes/chat/[id]/+page.svelte                      # touched: outline orchestration (spy wiring,
                                                       #   jump/flash, stick-to-bottom suppression)
src/lib/settings/scroll-spy.ts                         # reused as-is (generic)
src/lib/chat/selection.ts                              # unchanged (placement rule keeps it safe)

tests colocated with sources (*.test.ts), no new test dirs
```

**Structure Decision**: Extends the existing single-SPA layout. Pure logic goes beside its
domain (`src/lib/markdown/` for extraction, `src/lib/chat/outline/` for outline state),
presentation components under `src/lib/components/chat/outline/`, and orchestration in the
chat page that already owns the scroller (`viewport`), stick-to-bottom, and hash scrolling —
mirroring how 014 kept orchestration in `src/routes/settings/+page.svelte`.

## Phase 0 — Research Summary

All spec unknowns were resolved against the codebase; see [research.md](./research.md).
Decisions in brief:

- **D1** Entries derive from raw markdown via a new pure mdast extractor (memoized), never
  from DOM queries — far replies are unmounted (`LazyMount`), and mdast `heading` nodes
  exclude code-fence/callout/math text by construction (FR-005).
- **D2** "Currently reading" retargeting = one flat scroll-spy over mounted heading elements
  keyed `msgId:index`; the winning entry's owning reply is the panel's target.
- **D3** Jumps reuse the settings techniques (`scrollIntoView` block:'start' + rAF retry +
  `prefers-reduced-motion`) and set a stick-to-bottom suppression flag so streaming flushes
  cannot yank the viewport back (precedent: `scrolledToHash`).
- **D4** Panel placement: sibling of the chat scroller at page level (never inside message
  containers) — expound alignment untouched by construction.
- **D5** No URL/hash writes; FR-008's no-history rule is satisfied trivially.

## Phase 1 — Design Artifacts

- [data-model.md](./data-model.md) — HeadingEntry, OutlineEntry, outline view state, state transitions
- [contracts/reply-outline.md](./contracts/reply-outline.md) — module + UI contracts, integration rules
- [quickstart.md](./quickstart.md) — end-to-end validation scenarios

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified.

None — all gates pass; no violations to justify.

## Post-Design Constitution Re-Check

Re-evaluated after Phase 1 artifacts: design introduces no layering breach (no storage), no
new dependencies, no expound-contacting DOM, no search-index or restore interference, and
every new `src/lib/` module has a planned unit-test file. Presentation-only components are
covered by source-contract tests per the 014 precedent (constitution II allows UI-only
presentation changes to be verified via `pnpm check` + manual smoke; we add the cheap
source-contract tests anyway). **Gate result: PASS.**
