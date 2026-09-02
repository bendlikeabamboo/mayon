# Contracts: Section Peek Strip

**Feature**: specs/017-section-peek-strip | **Date**: 2026-09-02

This is a UI feature of a closed SPA — no external/network interfaces are added. The
contracts here are the in-repo module + component + interaction agreements that tasks
and review check against. Signatures are TypeScript-shaped descriptions, not literal
source. Where machinery is shared with the future 015 floating outline, 017 adopts
015's contract (`specs/015-floating-reply-outline/contracts/reply-outline.md`)
rather than forking it.

## 1. `src/lib/markdown/sections.ts` — extraction (pure)

```ts
interface Section {
  index: number;              // 0-based, document order within the reply
  level: 1 | 2 | 3 | 4 | 5 | 6;
  title: string;              // trimmed display text; may be '' for a bare `##`
  start: number;              // raw-markdown offset: heading start
  end: number;                // raw-markdown offset: next heading start, or end of input
  length: number;             // end - start
  excerpt: string;            // plain text, heading excluded, whitespace-collapsed, ~240-char cap
}

function extractSections(raw: string): Section[];   // memoized on exact input
function clearSectionsCache(): void;                // test hook
function isStripCandidate(sections: readonly Section[]): boolean;  // sections.length >= 3
```

- Parser: `remarkParse` + `remarkGfm` (same package versions the render pipeline
  uses); walks `heading` nodes only; setext headings count. Text before the first
  heading belongs to no section (bars map 1:1 to headings).
- MUST NOT treat as headings: fenced/indented `code`, blockquote/admonition bodies,
  tables, math, HTML. Excerpt text comes from the section's paragraph `text` nodes —
  never raw markdown syntax.
- Memoized: Last-Value cache on the exact input string; deterministic output for
  equal inputs; wrapped in `mark('strip:extract', …)`.
- No DOM access; no dependence on `render.ts` output (same parse, not its HTML).

## 2. `src/lib/chat/strip/pref.ts` — preference sole-writer

```ts
const STRIP_ENABLED_KEY = 'sectionStripEnabled';            // settings KV, JSON boolean, default true
function isStripEnabled(): Promise<boolean>;                // defensive read (corrupt/wrong-type ⇒ true)
function setStripEnabled(value: boolean): Promise<void>;    // repos.settings.set
```

- Only this module reads/writes the key (the `uiState.ts` sole-writer convention).
- A small rune-backed reactive mirror lives beside it (or in the consuming page) so
  the chat page reacts to toggles without polling; the module itself stays
  promise-based like `uiState.ts`.
- No schema change, no migration (existing generic `settings` table).

## 3. `src/lib/chat/strip/dwell.ts` — hover-intent (pure)

```ts
const DWELL_MS = 400;                                       // tuning constant, 300–500 range

interface DwellState { hoveredIndex: number | null; previewIndex: number | null }

type DwellInput =
	| { kind: 'enter-bar'; index: number }
	| { kind: 'leave-bar' }
	| { kind: 'enter-other-bar'; index: number }
	| { kind: 'leave-strip' }
	| { kind: 'dwell-fire'; index: number };   // the armed timer expiring; stale fires are ignored

// Pure transition function over (state, input) → { state; armTimerMs; openPreview; closePreview }
function dwellTransition(state: DwellState, input: DwellInput): DwellResult;
```

- `DwellState` = `{ hoveredIndex: number | null; previewIndex: number | null }` (the
  serializable core of `StripUiState`; the component holds the live timer id).
- Sweep immunity is emergent: `enter-bar` arms a 400 ms timer, `leave-bar` /
  `enter-other-bar` / `leave-strip` cancel it and close the preview immediately.
- No DOM, no timers inside this module — the component applies the returned effect,
  keeping every timing edge unit-testable.
- Touch: the component never calls this on coarse pointers (tap = jump, no preview).

## 4. `src/lib/components/chat/strip/SectionStrip.svelte` — presentation-only

```ts
props: {
  msgId: string;
  sections: Section[];                 // already eligibility-filtered by the caller
  onJump: (index: number) => void;     // page-orchestrated; component never scrolls
}
```

- **Rest state**: hairline gutter on the reply's edge — wrapper absolutely positioned
  inside the message wrapper (which gains `relative`), visually ≤2px of
  `bg-border` ticks; `pointer-events-none` wrapper, `pointer-events-auto` bar buttons
  and preview. At rest and on hover, no layout shift: the gutter is overlay-only.
- **Bars**: one `<button>` per section in document order; visual height proportional
  to `section.length` (min visual size enforced in CSS so tiny sections stay
  visible); hit area decoupled from visual size via vertical padding (≥24 px
  effective target). `aria-label` = section title (or "Section N" when empty);
  `role="navigation"` + `aria-label="Reply sections"` on the strip.
- **Hover**: hovering the strip fattens bars (width/opacity transition, `z-10` — the
  message-actions layer, below `z-50` menus). `motion-reduce:transition-none`.
- **Preview**: 400 ms dwell (via `dwellTransition`) opens a card anchored left of the
  strip (`absolute right-full`), `bg-popover text-popover-foreground border-border
  shadow-md rounded-md max-w-xs`, showing `title` + `excerpt` as plain text;
  clicking the preview invokes `onJump(previewIndex)`; prompt dismissal on pointer
  leave (FR-006).
- **Touch**: `matchMedia('(hover: none), (pointer: coarse)')` (listener + cleanup) —
  tap = `onJump(index)` directly, no dwell, no preview (FR-011).
- MUST NOT: call `scrollIntoView`, read/write scroll position, touch
  `history`/`location`, import `db`/repositories, or attach wheel/touch handlers
  (pointer discipline: the transcript scrolls natively over the strip). Asserted by
  source-contract tests.
- `incRender('SectionStrip')` on render.

## 5. Integration in `AssistantMessage.svelte` + `MessageList.svelte`

- `AssistantMessage` derives `sections = extractSections(message.content)` for
  **durable** entries only (`live === false`; while `chatStore.streaming` the live
  tail has no strip — FR-010).
- Eligibility = durable ∧ ¬streaming ∧ `isStripCandidate(sections)` ∧
  measured body height > scroller `clientHeight` (one-shot mount check + `ResizeObserver`
  on the message body, disconnected on unmount; scroller reached via
  `closest('.overflow-y-auto')`; **not** scroll-tied — the
  `visibility-sentinel.test.ts` guard stays green).
- New optional prop threaded `MessageList` → `AssistantMessage`:
  `onJumpToSection?: (msgId: string, index: number) => void`, supplied by the chat
  page. No store access added to rows.

## 6. Page-level orchestration (`src/routes/chat/[id]/+page.svelte`)

Implements `handleSectionJump(msgId, index)` — the 015 §5 contract, verbatim:

| Concern | Contract |
|---|---|
| Anchor | nth `h1–h6` element under `#msg-<msgId>`'s `.markdown-body` — filtered to headings NOT inside `blockquote, .callout` so the DOM list matches `extractSections`' exclusions 1:1; **rAF retry ≤5** until it exists (`LazyMount unmountFar` mounts on approach; precedent `handleHashScroll`/`landOn`). Duplicates resolve positionally by `index`, never by text. |
| Scroll | `scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })`; headings in the reply carry `scroll-mt` for landing offset. |
| Stick | Sets the page's stick-suppression flag (role of `scrolledToHash`) before scrolling so streaming flushes cannot yank the viewport; released on the next user turn (`onSend` clears it, matching the flag's hash-jump lifecycle). |
| Emphasis | `.section-flash` on the landing heading (~1600 ms; existing `app.css` keyframes, reduced-motion-zeroed) — class-only mutation, invisible to Highlighter's MutationObserver. |
| Idempotence | Repeated/overlapping clicks always end at the correct section top; no queued jumps, no side-effect stacking. |
| URL/history | No writes of any kind; chat's `#m=&b=` grammar untouched. |
| Reduced motion | Via `prefersReducedMotion()` (`src/lib/motion/stagger.ts`) ⇒ `behavior: 'auto'`; landing position and flash identical otherwise. |

## 7. Selection-alignment contract (`src/lib/chat/selection.ts`)

- `EXCLUDED_CHROME_SELECTORS` gains: `'.section-strip'`, `'.section-strip-preview'`
  (plus any inner text-bearing strip class finalized in tasks — every such selector
  lands here).
- Effect: strip/preview text is never offered as an alignment anchor
  (`AlignmentEntry.excluded`); a selection touching preview text mid-range fails
  safely with `reason: 'generated'`. Selections, expound/highlight, and copy inside
  the reply body remain byte-correct (FR-013).
- `selection.test.ts` MUST gain fixtures: a reply body containing rendered
  strip/preview markup ⇒ alignment of real reply text unchanged; generated-content
  failure still detected. **This is the deliberate deviation from 015 §6.1** (which
  kept the list untouched by placing chrome outside the message container) — the
  exact case 015 reserved as "a spec change: register the selector and re-verify
  alignment".

## 8. Settings UI contract (`/settings`)

- Toggle control in an existing settings section (no new `SETTINGS_SECTIONS` entry
  unless placement demands it): label "Section strip in long replies" (final copy in
  tasks), control = state-styled `Button` (no Switch primitive exists;
  `McpServers.svelte:870-881` pattern) or the section's established toggle idiom.
- Reads/writes only through `strip/pref.ts`; optimistic UI update + persisted write;
  turning off hides strips on the next chat render (already-open chats re-evaluate
  eligibility reactively).

## 9. Integration rules (non-negotiable)

1. **Layering**: strip modules import neither `db`/driver types nor repositories
   directly — only `strip/pref.ts` touches `repos.settings` (Constitution I).
2. **Scroll discipline**: no new scroll listeners anywhere in this feature; the only
   observers are the per-reply `ResizeObserver` (mount-scoped) and the touch media
   query. No per-frame layout reads (guard tests stay green).
3. **Zero new runtime dependencies** (Constitution IV): extraction reuses the
   installed remark parser.
4. **Streaming gate**: no strip markup exists in the DOM for live tails, ever
   (FR-010); asserted by source-contract test.
5. **Design vocabulary**: Tailwind v4 utilities + existing tokens only (`--border`
   hairline rest state, popover surface for previews); light and dark exercised
   (012 ruling: hairlines articulate surfaces, text contrast untouched).
6. **Perf probes**: `mark('strip:extract', …)` around extraction;
   `incRender('SectionStrip')` in the component; quickstart validates before/after
   with `window.__MAYON_PERF__ = 1` (Constitution IV).
