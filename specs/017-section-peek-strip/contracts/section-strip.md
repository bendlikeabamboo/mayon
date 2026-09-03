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
- No DOM, no timers inside this module — the gutter component applies the returned
  effect, keeping every timing edge unit-testable. Unchanged by the 2026-09-02
  refinement; only its consumer moved (in-message strip → page-level gutter).
- Touch: the component never calls this on coarse pointers (tap = jump, no preview,
  FR-012).

## 4. `src/lib/chat/strip/registry.ts` — per-reply strip registry (context)

```ts
interface StripAnchor {
  msgId: string;
  el: HTMLElement;        // the reply body element (`.markdown-body`'s container)
  sections: Section[];    // already eligibility-filtered by the registrant
}

class StripRegistry {
  entries: StripAnchor[];              // reactive ($state), insertion-ordered
  register(anchor: StripAnchor): void; // idempotent per msgId (upsert)
  unregister(msgId: string): void;
  bump(msgId: string): void;           // signal "my size changed" → recompute tops
}

const STRIP_REGISTRY_KEY: context key;  // provided by the chat page
function getStripRegistry(): StripRegistry | null;   // null outside the chat page (tests)
function getStripPrefFromContext(): boolean;         // page-provided feature flag mirror
```

- The chat page `setContext`s one registry + the loaded `stripEnabled` flag;
  `AssistantMessage` consumes it — no prop threading through `MessageList`
  (replaces the old `onJumpToSection`/`stripEnabled` props entirely).
- The registry never touches the DOM beyond holding element references; position
  measurement belongs to the gutter component (§5).

## 5. `src/lib/components/chat/strip/SectionStripGutter.svelte` — the gutter (page-level, presentation + sync)

```ts
props: {
  viewportEl: HTMLElement;             // the transcript scroll container
  onJump: (msgId: string, index: number) => void;   // page's handleSectionJump, direct
}
```

- **Placement**: rendered by the chat page as a sibling of the transcript viewport
  inside its relative wrapper: an absolutely positioned layer
  (`absolute inset-y-0 right-0`, gutter-width ~16px, `overflow-hidden`,
  `pointer-events-none`, above the fade overlays). The viewport receives a
  matching right inset (`margin-right`) **only while the feature is enabled**, so
  the scrollbar sits immediately left of the gutter: chat area → scrollbar →
  ticks (FR-003).
- **Scroll sync**: an inner container holds every reply's tick column positioned at
  its reply's document offset; a single passive, rAF-throttled `scroll` listener on
  `viewportEl` updates one `translateY(-scrollTop)` transform (FR-004). This is the
  feature's ONLY scroll listener; scroll-time work is transform-only (no layout
  reads/writes).
- **Anchor measurement** (invalidation-time only, never on scroll): for each
  registry entry, `docTop = el.rect.top − viewportEl.rect.top + viewportEl.scrollTop`
  and `height = el.offsetHeight`. Recompute **all** entries when: membership changes
  (`register`/`unregister`), any member bumps (`bump` — AssistantMessage's existing
  ResizeObserver fires on body resize, covering content growth above), the viewport
  box resizes (one ResizeObserver on `viewportEl`), or the section data changes.
- **Ticks** (per reply column, in `registry.entries` order): one `<button>` per
  section; rows tile vertically by flex-grow ∝ `section.length` (min row height so
  tiny sections stay reachable, ≥24px effective hit target via the row); the tick
  itself is a **thin horizontal hairline** (`h-[2px]`), **left-aligned** at the
  gutter origin, width ∝ section share clamped to `[min, gutter width]`. Rest color
  `--border`; gutter hover brightens (`--muted-foreground`); tick hover **extends
  the tick a few px to the right** (width transition, `motion-reduce:transition-none`).
  `role="navigation"` + `aria-label="Reply sections"` per column; `aria-label` per
  tick from `section.title` (fallback "Section N").
- **Preview**: `dwellTransition` (§3, unchanged) opens a floating window inside the
  gutter layer (viewport-static — unaffected by the scroll transform), anchored at
  the hovered tick and extending **leftward** from it (right edge just right of the
  scrollbar): `bg-popover text-popover-foreground border-border shadow-md
  rounded-md max-w-xs`, `title` + `excerpt` as plain text; click = `onJump`. Prompt
  dismissal on pointer leave of gutter+preview region (FR-007). One preview open at
  a time across the whole gutter.
- **Touch**: `matchMedia('(hover: none), (pointer: coarse)')` (listener + cleanup) —
  tap = `onJump` directly, no dwell, no preview (FR-012).
- **Wheel relay (amended during verification)**: because the gutter is a sibling
  overlay OUTSIDE the scroll container, native wheel chaining cannot cross the
  sibling boundary — wheel over the ticks would be swallowed by the clip box and
  never reach the transcript. The gutter therefore attaches exactly ONE `wheel`
  listener on its root, which relays the gesture: `preventDefault()` +
  `viewportEl.scrollBy(0, deltaY)` (roughly; exact relay math in tasks). No
  `stopPropagation`, no other wheel/touch handlers. Asserted by source-contract
  test (§10.2 documents the invariant change).
- MUST NOT: call `scrollIntoView`, write `scrollTop` directly (the relay uses
  `scrollBy` on the viewport), touch `history`/`location`, import `db`/repositories,
  or attach any other wheel/touch handlers (pointer discipline beyond the relay).
  Asserted by source-contract tests.
- `incRender('SectionStripGutter')` on render. (The old in-message
  `SectionStrip.svelte` is deleted.)

## 6. Integration in `AssistantMessage.svelte` + `MessageList.svelte`

- `AssistantMessage` derives `sections = extractSections(message.content)` for
  **durable** entries only (`live === false`; while `chatStore.streaming` the live
  tail has no strip — FR-011) exactly as before.
- Eligibility = durable ∧ ¬streaming ∧ `isStripCandidate(sections)` ∧ measured body
  height > scroller `clientHeight` (unchanged one-shot mount check + `ResizeObserver`
  on the message body, disconnected on unmount; scroller reached via
  `closest('.overflow-y-auto')`; **not** scroll-tied — the
  `visibility-sentinel.test.ts` guard stays green).
- **Change vs. the first cut**: instead of mounting `SectionStrip` in place, an
  eligible message **registers** `{ msgId, el: bodyEl, sections }` in the context
  registry (§4) and `bump`s it whenever its body resizes; ineligible/unmount →
  `unregister`. The feature flag comes from the context, not a prop.
- `MessageList.svelte` **loses** the `onJumpToSection` and `stripEnabled` props —
  pure pass-through removal, no other changes.

## 7. Page-level orchestration (`src/routes/chat/[id]/+page.svelte`)

- Renders `SectionStripGutter` beside the viewport (inside the relative wrapper),
  passes `viewportEl` and `onJump={handleSectionJump}` (the contract below,
  unchanged), and applies the viewport's right inset while `stripEnabled` is true.
- Provides the registry + feature flag via context (§4).

`handleSectionJump(msgId, index)` — the 015 §5 contract, verbatim:

| Concern | Contract |
|---|---|
| Anchor | nth `h1–h6` element under `#msg-<msgId>`'s `.markdown-body` — filtered to headings NOT inside `blockquote, .callout` so the DOM list matches `extractSections`' exclusions 1:1; **rAF retry ≤5** until it exists (`LazyMount unmountFar` mounts on approach; precedent `handleHashScroll`/`landOn`). Duplicates resolve positionally by `index`, never by text. |
| Scroll | `scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })`; headings in the reply carry `scroll-mt` for landing offset. |
| Stick | Sets the page's stick-suppression flag (role of `scrolledToHash`) before scrolling so streaming flushes cannot yank the viewport; released on the next user turn (`onSend` clears it, matching the flag's hash-jump lifecycle). |
| Emphasis | `.section-flash` on the landing heading (~1600 ms; existing `app.css` keyframes, reduced-motion-zeroed) — class-only mutation, invisible to Highlighter's MutationObserver. |
| Idempotence | Repeated/overlapping clicks always end at the correct section top; no queued jumps, no side-effect stacking. |
| URL/history | No writes of any kind; chat's `#m=&b=` grammar untouched. |
| Reduced motion | Via `prefersReducedMotion()` (`src/lib/motion/stagger.ts`) ⇒ `behavior: 'auto'`; landing position and flash identical otherwise. |

## 8. Selection-alignment contract (`src/lib/chat/selection.ts`)

- `EXCLUDED_CHROME_SELECTORS` gains: `'.section-strip'`, `'.section-strip-preview'`
  (plus any inner text-bearing strip class finalized in tasks — every such selector
  lands here).
- Effect: strip/preview text is never offered as an alignment anchor
  (`AlignmentEntry.excluded`); a selection touching preview text mid-range fails
  safely with `reason: 'generated'`. Selections, expound/highlight, and copy inside
  the reply body remain byte-correct (FR-014). The gutter now renders OUTSIDE the
  message containers, so these selectors are belt-and-braces; they stay registered
  (and tested) as safety.
- `selection.test.ts` MUST gain fixtures: a reply body containing rendered
  strip/preview markup ⇒ alignment of real reply text unchanged; generated-content
  failure still detected. **This is the deliberate deviation from 015 §6.1** (which
  kept the list untouched by placing chrome outside the message container) — the
  exact case 015 reserved as "a spec change: register the selector and re-verify
  alignment".

## 9. Settings UI contract (`/settings`)

- Toggle control in an existing settings section (no new `SETTINGS_SECTIONS` entry
  unless placement demands it): label "Section strip in long replies" (final copy in
  tasks), control = state-styled `Button` (no Switch primitive exists;
  `McpServers.svelte:870-881` pattern) or the section's established toggle idiom.
- Reads/writes only through `strip/pref.ts`; optimistic UI update + persisted write;
  turning off unregisters every strip and releases the gutter reservation on the
  next chat render (already-open chats re-evaluate eligibility reactively; the
  viewport inset is bound to the same flag, FR-015).

## 10. Integration rules (non-negotiable)

1. **Layering**: strip modules import neither `db`/driver types nor repositories
   directly — only `strip/pref.ts` touches `repos.settings` (Constitution I).
2. **Scroll discipline (amended 2026-09-02, wheel relay added during verification)**:
   the feature has exactly TWO scroll-coupled listeners, both on its own chrome:
   (a) the gutter's passive, rAF-throttled transform sync on the transcript
   viewport (FR-004) — scroll-time work is transform-only; layout reads happen only
   at invalidation time (registry/resize changes); (b) the gutter's wheel relay,
   which exists BECAUSE the gutter sits outside the scroll container: native wheel
   chaining cannot cross the sibling boundary, so the relay forwards the gesture to
   the viewport (`scrollBy`) to keep FR-013 (wheel over the gutter scrolls the
   transcript normally). It never scrolls anywhere but the transcript viewport.
   Other observers: the per-reply eligibility `ResizeObserver`, the gutter's
   viewport `ResizeObserver`, and the touch media query.
3. **Zero new runtime dependencies** (Constitution IV): extraction reuses the
   installed remark parser.
4. **Streaming gate**: no tick markup exists in the DOM for live tails, ever
   (FR-011); asserted by source-contract test.
5. **Design vocabulary**: Tailwind v4 utilities + existing tokens only (`--border`
   hairline rest state, popover surface for previews); light and dark exercised
   (012 ruling: hairlines articulate surfaces, text contrast untouched).
6. **Perf probes**: `mark('strip:extract', …)` around extraction;
   `incRender('SectionStripGutter')` in the gutter; quickstart validates before/after
   with `window.__MAYON_PERF__ = 1` (Constitution IV).
