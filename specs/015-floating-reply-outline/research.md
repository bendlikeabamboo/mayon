# Research: Floating Reply Outline

**Feature**: specs/015-floating-reply-outline | **Date**: 2026-08-29

Research grounded in the codebase as of branch `015-floating-reply-outline` (two explore
passes over chat rendering/scroll/streaming and settings-navigation/expound prior art).
Every decision below resolves a question the spec left to planning; no NEEDS CLARIFICATION
markers remained from the spec.

## R1 — Where do outline entries come from: markdown text or rendered DOM?

**Decision**: Derive entries from the reply's **raw markdown** via a new pure extractor
(`src/lib/markdown/headings.ts`) that walks mdast `heading` nodes (remarkParse + remarkGfm,
same parser the render pipeline uses), memoized per input string. Never query the DOM to
build the list.

**Rationale**:
- `MessageList.svelte` wraps every durable row in `LazyMount unmountFar rootMargin="1200px"`;
  rows farther than that are **unmounted** and replaced by fixed-height placeholders. DOM
  queries (`querySelectorAll('h1..h6')`) would silently miss far replies and go stale on
  every `{@html}` subtree replacement (Markdown.svelte re-renders innerHTML whenever `raw`
  changes — ~12.5 Hz during streaming via `streamBufferRender`).
- mdast `heading` nodes exist only for real document headings. Heading-like text inside code
  fences, block quotes/admonitions, tables, and math is not a `heading` node — FR-005's
  exclusion rule falls out of the data structure instead of needing heuristics.
- Content must pass through `stripGateFence` first (AssistantMessage.svelte:58–60 strips the
  hidden `​```gate` fence from `entry.content`); otherwise the hidden fence pollutes the
  outline. The extractor takes the same `visible` string the row already renders.
- No heading ids exist anywhere (`render.ts` has no rehype-slug), and extending the sanitize
  schema is a non-goal: ids injected before `rehypeSanitize` get prefixed `user-content-` by
  the clobber rules. Positional mapping (R2) avoids the whole problem.

**Alternatives considered**:
- *rehype-slug + id anchors*: rejected — new dependency, sanitize clobber handling, and ids
  still vanish with unmounted rows.
- *Extract from rendered HTML via the DOM of the mounted row*: rejected — unmount/staleness
  above; also couples the outline to post-processing chrome (copy buttons, mermaid swaps).
- *Regex over the raw markdown*: rejected — fragile for fences/admonitions/setext; the
  project has an existing mdast toolchain, so parsing is the honest cheap option. (This does
  not touch the expound substring-heuristic prohibition — no offsets are derived here.)

## R2 — How does the panel track "the reply the user is currently reading"?

**Decision**: One flat scroll-spy over **mounted heading elements** of all assistant replies,
keys shaped `msgId:index`. Reuse `createScrollSpy`/`resolveActive` from
`src/lib/settings/scroll-spy.ts` verbatim (they are generic: any root container, any
elements). The active entry's owning `msgId` is the panel's target reply; the entry is the
highlighted section.

**Rationale**:
- `createScrollSpy(root, onActive)` takes the chat `viewport` div
  (`src/routes/chat/[id]/+page.svelte`, the `overflow-y-auto` element) and uses an
  IntersectionObserver band (`-20% 0px -70% 0px`) + `scrollend` re-evaluation + at-bottom
  clamp — exactly the interaction 014 shipped and the spec's FR-008 describes. It never reads
  `scrollTop` per frame (a guard test in the repo forbids that pattern in scroll-tied
  effects).
- The spy only sees mounted rows, but unmounted rows cannot be the reading target, and the
  mount-aware sync (R3) plus `refresh()` after jumps keeps the highlight self-correcting.
- A two-level spy (reply anchors, then headings within the active reply) was rejected as
  strictly more machinery for the same observable behavior.

**Mount-awareness**: an IntersectionObserver on the `#msg-<itemId>` wrapper divs (which
persist for every timeline item; LazyMount swaps only their content) with the same 1200px
margin observes which replies are near the viewport; its callback syncs heading-element
observations into the spy (observe on approach, unobserve on departure). The sync function is
pure (Map in/out) and unit-tested. `#msg-` anchors come from MessageList's keyed each block;
timeline item ids — not raw message indexes — are the stable identity (assembleTimeline
hides/reorders rows).

## R3 — How do jumps work, and what about stick-to-bottom during streaming?

**Decision**: Jump = resolve the heading element by key (`msgId:index` → the *n*th `h1–h6`
under that reply's `.markdown-body`), retry up to 5 rAFs until it exists (established
`handleHashScroll`/`landOn` pattern — scrolling itself triggers LazyMount mid-flight), then
`el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })` with a
`scroll-mt` offset on headings, plus a brief `section-flash` emphasis (reusing the app.css
keyframes; helper extracted to `src/lib/chat/outline/flash.ts`). During an in-flight jump,
spy updates are suppressed until `scrollend` or an 800 ms fallback (014's settle pattern).

**Stick-to-bottom**: while `stickToBottom` is true, the page force-scrolls to bottom on every
content resize (streaming flushes) — an outline jump would be yanked back within ~80 ms.
Outline jumps set a suppression flag on the chat page (the same role `scrolledToHash` plays
for hash jumps: once the user has expressed a destination, autoscroll stands down for the
life of the stream). The existing bottom-sentinel IO keeps `stickToBottom` false afterwards;
the next user turn restores normal behavior.

**Duplicate headings**: identity is `msgId:index` — the nth occurrence jumps to the nth
element. Text is never used to locate targets (FR-007).

## R4 — Where does the outline UI live, and how is expound kept safe?

**Decision**: The panel, toggle button, and mobile sheet are rendered at the **chat page
level, as siblings of the `viewport` scroller** (never inside `Highlighter` /
`.markdown-body`). Desktop (≥ xl, 1280px — the 014 cutover): floating panel docked right
inside the middle pane, `fixed`/`absolute` with `z-40`, dismissible to a small pill
(FR-009). Below xl: floating round button (`fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 size-12 rounded-full shadow-lg`, the 014 mobile convention) opening a
bottom Sheet (bits-ui) capped `max-h-[70dvh]`. The toggle/button is hidden entirely while no
assistant reply in the conversation has headings (FR-010).

**Why placement is the expound story**: `alignDomToCanonical` walks every Text node under
each Highlighter container and fails alignment on any unexpected non-whitespace text; the
container's MutationObserver re-runs `renderUnderlines()` on childList/characterData churn.
A sibling overlay injects zero nodes/text into message containers, so
`EXCLUDED_CHROME_SELECTORS` needs no change and alignment is safe by construction. Jump/
flash only toggle classes on existing heading elements — attribute mutations the
Highlighter observer does not subscribe to. Chat-specific overlays (ContextMenu,
ExpoundMarkPopover, selection pill) already establish the `fixed z-50 bg-popover` style; a
persistent panel at `z-40` stays beneath transient menus/poppers per the existing scale.

**Alternatives considered**:
- *bits-ui Popover for the desktop panel*: rejected — Popover content is transient/
  focus-trapped; the outline is a persistent, non-modal companion. Hand-built fixed panel
  matches ContextMenu/Highlighter chrome precedent. Sheet stays bits-ui (focus/Escape for
  free, matches MobileSectionJump).
- *Left-side dock*: rejected — the AppShell sidebar and chat left gutter already occupy
  that visual lane at width; right side mirrors settings and clears the composer.

## R5 — Streaming, retargeting, and refresh timing

**Decision**: While streaming, the live row's buffer (`chatStore.streamBufferRender`, ~12.5 Hz
throttled) feeds the same extractor (memoized on the string, so unchanged strings cost
nothing); entries update as headings appear (spec assumption). The flat spy retargets the
panel whenever the active key's `msgId` changes; `subscribeScroll` is used only where an
extra listener is genuinely needed (the spy already carries its own IO + `scrollend`).
Jumps during streaming land at the heading's current true position; later flushes may move
content *below* the target but never invalidate the landed position beyond normal streaming
reflow, and stick suppression (R3) prevents yanking.

**Perf instrumentation**: `mark('outline:extract', …)` around extraction,
`incRender('ReplyOutline')` on panel renders — the established probe conventions
(`markdown:render`, `layout:flush`, `incRender('TimelineRow')`).

## R6 — URL, history, persistence

**Decision**: No URL or history writes of any kind (spec FR-008 forbids history from spy
changes; jumps add nothing). Chat's `#m=<msgId>&b=<branchId>` grammar is untouched — 014's
`hash-sync.ts` is deliberately **not** reused (hard-wired to `pathname#id` and history
APIs; its duplicate-suppression problem doesn't exist here). Panel open/closed state and the
active target are session-scoped component state; nothing is persisted (FR-014), so no
schema/migration work exists.

## R7 — Testing approach

**Decision**: Follow the three in-repo Vitest patterns:
1. **Pure-function units** (node env): `headings.test.ts` (extraction over fixture markdown:
   ATX + setext headings, `#` inside fences, admonitions, math, gate fence, memoization) and
   `entries.test.ts` (active-heading resolver over rect-like inputs, mount-sync, at-bottom
   clamp, duplicate-name keys) — the `scroll-spy.test.ts` style.
2. **Source-contract tests**: outline components assert placement (`fixed`, safe-area), that
   presentation components contain no `scrollIntoView`/`history`/`pushState`, and that no
   outline markup lands inside `.markdown-body` — the `SettingsRail.render.test.ts` style.
3. **Existing real-DOM tests**: `selection.test.ts` must keep passing unchanged — its
   continued green run is the expound-safety regression net (plus a quickstart manual check).

## R8 — Dependencies & reuse inventory

| Need | Resolution | New dep? |
|---|---|---|
| Heading extraction | remarkParse (already installed) | No |
| Scroll-spy | `src/lib/settings/scroll-spy.ts` as-is | No |
| Flash | `.section-flash` keyframes in `src/app.css` + new tiny helper | No |
| Mobile sheet | `src/lib/components/ui/sheet` (bits-ui) + Button | No |
| Scroll listeners | `src/lib/chat/scroll-bus.ts` `subscribeScroll` | No |
| Slugs/ids | Not needed (positional mapping) | No (rejected rehype-slug) |
