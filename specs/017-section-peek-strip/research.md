# Research: Section Peek Strip

**Feature**: specs/017-section-peek-strip | **Date**: 2026-09-02

Resolves every open design question from the spec's Assumptions against the actual
codebase. The spec left five "decide in spec" items (streaming, threshold, dwell,
touch fallback, where-am-I) — all are decided below with rationale and rejected
alternatives. No NEEDS CLARIFICATION items remain.

## R1. Where outline data comes from

**Decision**: Extract sections by walking `heading` nodes in an mdast tree produced by
`remarkParse` + `remarkGfm` (the same packages and order the render pipeline in
`src/lib/markdown/render.ts:66-85` uses), reading `node.position.start.offset` /
`end.offset` for section spans. The rendered DOM is used *only* to anchor jumps:
the nth `h1–h6` under the reply's `.markdown-body` (positional mapping, the same
contract 015 already designed).

**Rationale**: One parse serves bars (length), preview (plain-text excerpt), and jump
(order) deterministically; the renderer is deterministic, so mdast heading order maps
1:1 to DOM heading order. Code fences, blockquotes/admonitions, tables, math, and HTML
never produce `heading` nodes, so the spec's exclusions (FR-008) fall out for free;
setext headings count (they are `heading` nodes). Memoize on the exact input string
(Last-Value cache — callers feed one string per durable reply; 015 §1 uses the same
scheme).

**Alternatives considered**:
- *DOM scrape of rendered headings* (`querySelectorAll('h1..h6')` + measuring
  `offsetTop` deltas): faithful to rendered geometry but needs the DOM mounted, breaks
  under `LazyMount unmountFar`, and gives no clean plain-text excerpts. Rejected as
  the data source; retained only for jump anchoring.
- *Regex over raw markdown*: fails on setext headings, headings in code fences, and
  front-matter edge cases. Rejected.

## R2. Streaming behavior (spec FR-010)

**Decision**: The strip renders only for **durable** timeline entries while
`chatStore.streaming === false` (`src/lib/stores/chat.svelte.ts:95-103`,
`:599-603`). The live tail (`streamBufferRender`) never shows a strip; when a reply
completes, the strip appears once, fully formed. Regenerate (page
`onRegenerate`, `src/routes/chat/[id]/+page.svelte:444-458`) deletes the row and
streams a new one — the new durable message id and content make the strip recompute
from scratch, which structurally satisfies "excerpts refresh on edit/regenerate"
(FR-009).

**Rationale**: Zero mid-stream reflow/jitter (the spec's thrash requirement) at no
UX cost — nobody navigates a reply that is still growing. Completion is already a
store-level fact the UI consumes (`MessageList` derives the timeline from
`messages` + `liveItems` + `streaming`), so the gate is one boolean.

**Alternatives considered**:
- *Live strip from `streamBufferRender`* (015's approach for its panel): keys stay
  stable and it works, but it re-runs extraction on every throttle tick and visibly
  reshuffles bars as sections arrive — exactly the thrash the spec bans for 017.
  Rejected here; 015 may keep it for the panel.
- *Appear after a stability timeout mid-stream*: arbitrary, still janky at the tail.
  Rejected.

## R3. Eligibility threshold (spec FR-001)

**Decision**: A reply qualifies when **all** hold:
1. durable + not streaming (R2),
2. `sections.length >= 3`,
3. measured reply body height > transcript viewport height.

Measurement is a one-time mount check (plus a cheap `ResizeObserver` on the message
body, disconnected on unmount): compare the message body's `offsetHeight` against the
scroller's `clientHeight`, reached via `el.closest('.overflow-y-auto')` (existing
pattern: `src/lib/components/chat/Highlighter.svelte:428-433`). It is **not**
scroll-tied, so the `visibility-sentinel.test.ts` guard (no `scrollTop` reads in
scroll-tied effects) is untouched.

**Rationale**: Mirrors the spec's "sufficiently long and multi-section" with concrete,
tunable numbers (≥3 sections is the documented default; single-section replies never
qualify). Height relative to the actual viewport avoids magic pixel constants.

**Alternatives considered**:
- *Character-count threshold on raw markdown*: cheap but wrong for code-heavy vs
  prose-heavy replies (a 2k-char code block needs no TOC; 800 chars of prose with four
  headings does). Rejected as primary; could later be a pre-mount fast path.
- *≥2 sections*: strips on two-section replies feel noisy for near-zero value.
  Rejected.

## R4. Hover-intent / dwell model (spec FR-005, FR-006)

**Decision**: Per-bar pointerenter starts a single `setTimeout` at **400 ms**
(tunable 300–500); any pointerleave of the bar, or pointerenter of a *different* bar,
cancels it and hides any open preview immediately. Crossing the strip without
stopping on a bar therefore never fires a preview (sweep immunity is emergent: each
bar's timer is cancelled on leave). Pure decision helpers live in
`src/lib/chat/strip/dwell.ts` (`shouldOpenPreview`, `shouldCancelDwell` over an
event/timestamp record) so the timing edges are unit-testable without a browser.

**Rationale**: One timer per interaction, no global mousemove listener (a mousemove
throttle would add exactly the per-frame work the repo's perf guard tests police).
400 ms sits between "fires while brushing past" and "feels dead" — the midpoint of
the spec's documented range and close to native tooltip latencies.

**Alternatives considered**:
- *Global pointermove tracking with velocity heuristic (intent detection à la
  Flyout libraries)*: better sweep rejection in theory, but per-move work, more state,
  harder tests. Rejected for a 40-px-wide strip.
- *Click-to-preview on desktop*: adds an interaction before the preview's value
  (confirming the target) is delivered. Rejected.

## R5. Touch fallback (spec FR-011)

**Decision**: **Tap = jump directly**, no preview, on coarse-pointer/no-hover
devices; detected once via `matchMedia('(hover: none), (pointer: coarse)')` with a
listener + cleanup (the established pattern:
`src/lib/components/chat/MobileSectionJump.svelte:13-24`). Dwell timers are simply
never armed on touch.

**Rationale**: The spec offered tap-to-jump or hide-on-touch and said pick one.
Hiding discards the feature's whole value on touch devices; tap-to-jump preserves it
and costs one media query. Matches the coarse-pointer overrides
`AssistantMessage.svelte` already carries for its hover action row.

**Alternatives considered**: *Hide strip on touch*: strictly less value; rejected.
*Long-press preview on touch*: adds a gesture conflict with text selection inside
replies. Rejected.

## R6. Jump mechanics (spec FR-007, FR-015)

**Decision**: Adopt 015's contract §5 verbatim for the jump path, implemented in the
chat page (owner of `viewport` / stick state — the 014 split: components pure, page
orchestrates):

- Resolve index → nth `h1–h6` element under `#msg-<msgId>`'s `.markdown-body`;
  **rAF retry ≤5** until it exists (the target reply may be far away and unmounted by
  `LazyMount unmountFar`, `MessageList.svelte:161`; precedent:
  `handleHashScroll`, `+page.svelte:338-345`, and settings `landOn`,
  `src/routes/settings/+page.svelte:96-115`).
- `scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  block: 'start' })` with headings carrying `scroll-mt` for landing offset;
  `prefersReducedMotion()` from `src/lib/motion/stagger.ts:54-64`.
- **Stick-to-bottom suppression**: set the page's stick-suppression flag (role of
  `scrolledToHash`, `+page.svelte:89-92`) before scrolling so the streaming flush
  effects (`:106-162`) cannot yank the viewport back; release on next user turn.
- **Landing flash**: reuse the `.section-flash` keyframes already in
  `src/app.css:534-555` (settings `flashHeading` pattern, reduced-motion-zeroed by
  `app.css:420-422`) so the landing point is unmistakable.
- Repeated/overlapping clicks: idempotent target resolution, one animation at a
  time; no queued side effects.

**Rationale**: This is the proven, guard-tested machinery from 014 and the exact
contract 015 pre-designed; reimplementing it differently would fork behavior between
017 and 015 for no benefit.

## R7. Preference persistence (spec FR-014)

**Decision**: Plain global settings key **`sectionStripEnabled`** (boolean, default
**true**), accessed only through a sole-writer module `src/lib/chat/strip/pref.ts`
with defensive reads (wrong-type/corrupt JSON ⇒ default), following the
`uiState.ts` conventions (`src/lib/chat/uiState.ts:40-53`,
`docs/history/appendices/012-settings-keys.md`) and the `reasoningEnabled` precedent
for global booleans. Settings UI: a toggle control inside an existing
`/settings` section (state-styled `Button` per the no-Switch-primitive reality,
`McpServers.svelte:870-881`), added via the normal settings-section structure.

**Rationale**: The generic `settings` KV table exists precisely for this; no schema
change, no migration (Constitution-clean). Default-on matches the feature's purpose
(it is navigation chrome, not a distraction, once the rest state is a hairline);
the toggle exists because the spec makes opt-out an explicit requirement.

**Alternatives considered**:
- *localStorage*: breaks the repo convention that preferences persist server-side and
  would not follow restores. Rejected.
- *`ui-state:` namespaced key*: that namespace is per-entity (`<entityId>:<facet>`);
  this is a global preference. Rejected.

## R8. Expound/selection safety (spec FR-013)

**Decision**: Add `.section-strip` and `.section-strip-preview` (plus any inner
text-bearing strip class, finalized in tasks) to `EXCLUDED_CHROME_SELECTORS`
(`src/lib/chat/selection.ts:27-36`) and extend `selection.test.ts` with fixtures
that render a reply containing strip/preview markup and assert alignment still
resolves real reply text and still flags generated-content failures correctly.

**Rationale**: The strip is the exact "text-bearing chrome inside a message
container" case 015's contract §6.1 said would be a deliberate spec change. Excluded
nodes are simply not offered as alignment anchors (they get
`AlignmentEntry.excluded`), so selections *inside* replies remain correct and a
selection touching preview text fails safely rather than misaligning.

**Alternatives considered**:
- *Place the strip outside `.markdown-body` and hope*: it still sits inside the
  message container (AssistantMessage wrapper), and the preview overlays reply text —
  exclusion is required regardless. Rejected.
- *Portal the preview to `body`*: escapes alignment but breaks positioning within the
  reply edge and scroll behavior. Rejected.

## R9. Pointer discipline (spec FR-004, FR-012)

**Decision**: Strip wrapper is `pointer-events-none`; only the bar buttons and the
preview card are `pointer-events-auto`. The strip element itself never covers the
reply body (it occupies a slim absolute-positioned gutter on the reply's edge inside
the message wrapper, `z-10` — the same layer as the hover action row, below the
`z-50` menus). No wheel/touch handlers are attached to the strip, so wheel/touch
events over the strip's gutter scroll the transcript natively. Bars get generous hit
targets via vertical padding (≥24 px effective per target) while the *visual* bar
stays hairline-thin (the `AssistantMessage` reserved-height pattern, comment at
`:119-121`, is the precedent for zero-shift affordances).

**Rationale**: Fewer event handlers = fewer ways to steal scroll; padding-for-hit-area
decouples target size from visual size, satisfying both "generous hit targets" and
"near-invisible at rest".

## R10. Performance instrumentation (Constitution IV)

**Decision**: `mark('strip:extract', …)` around extraction in `sections.ts` (beside
the existing `'markdown:render'`, `'sourcemap:build'` marks) and
`incRender('SectionStrip')` in the component; quickstart includes a before/after
probe run with `window.__MAYON_PERF__ = 1`. Memoization keeps repeated renders free;
the eligibility `ResizeObserver` is one observer per mounted eligible reply, paused
on `document.hidden` (trivial) — no scroll listeners exist in this cut at all.

**Rationale**: Matches the probe's existing usage (`render.ts:92`, `Highlighter.svelte:41`)
and the constitution's "measured before and after" requirement.

## R11. Relationship to 015 (scope boundary)

**Decision**: 017 implements the *shared primitives* 015's contract designed —
extraction (as `extractSections`, a superset of `extractHeadings`), jump
orchestration, landing flash — but none of 015's panel/toggle/sheet chrome, and it
adds the one thing 015 explicitly deferred: in-message text-bearing chrome with
selection exclusions. No history/URL writes (chat's `#m=&b=` grammar untouched); no
scroll-spy (the where-am-I marker is deferred with it).

**Rationale**: When 015 lands, it consumes `sections.ts` and the page jump path
instead of re-deriving them; nothing in 017 blocks or predicts 015's panel UI.
