# Chat: remove encompassing border, sticky top/bottom, directional edge fade

## Scope

- **Route:** `/chat/[id]` only (`src/routes/chat/[id]/+page.svelte` + `src/lib/components/chat/MessageList.svelte`).
- **In scope:** (1) remove the outer "encompassing" message-area border while keeping the assistant bubble border; (2) make the top region (breadcrumb + goal/brief) and the bottom region (composer + status banners) sticky (always visible, non-scrolling); (3) progressive edge fade of the message area as content approaches the top/bottom sticky boundaries, fully transparent at the boundary.
- **Out of scope (separate plans):** the other items in `refinement/ui-refinement-02.md` — left-bar scrollbar placement, thinking-flash follow-on-scroll, extra spacing above the "Thought process" UI.

## Confirmed from code

- The encompassing border to remove: `MessageList.svelte:51` (`rounded-lg border border-border bg-background p-4` wraps every message).
- The assistant border to keep: `MessageRow.svelte:38` (`assistant: 'border border-border bg-background text-foreground'`).
- Scroll chain today: `<main class="min-h-0 flex-1 overflow-auto">` (`AppShell.svelte:124`) is the only real scroll container. The `/chat/[id]` inner column (`max-w-3xl flex-col gap-3 p-4`, `[id]/+page.svelte:240`) is **not** height-bounded, so `MessageList`'s own `overflow-auto` is a no-op and the whole column (breadcrumb + messages + composer) scrolls together inside `<main>`. This is why the breadcrumb and composer currently scroll away.
- No UI/snapshot tests reference these components (all Vitest suites are logic/db/ai), so there is nothing to update beyond type-check + lint + manual gates.

## Decisions

- **Sticky via flex regions, not `position: sticky`.** Restructure the column into three flex children — top `shrink-0`, middle `flex-1 min-h-0` (the only scroller), bottom `shrink-0`. Only the middle scrolls, so top/bottom are always visible. This is more robust than CSS sticky.
- **Bottom pane contents:** Composer + all status banners (approval cards; chat/labs/quizzes error banners; lab raw-offer banner; gate progress text). Suggested-reply chips already live inside `Composer`.
- **Directional fade via opacity-toggled gradient overlays** (not CSS `mask-image`): two `pointer-events-none` overlays pinned to the top/bottom of the middle wrapper, each a `var(--background) → transparent` gradient. Overlay presence is toggled by JS based on scroll overflow direction; CSS transitions `opacity` (smooth, no mask-transition jank). Solid `var(--background)` makes overlay blending match the panel.
- **Fade region size:** `--fade-top` / `--fade-bottom` = ½ of the respective pane height, updated live by `ResizeObserver` on each pane. Plus an optional absolute cap of **80px** (never exceeds ½ pane height) so a very tall bottom pane (many banners) does not produce an oversized fade.
- **Easing:** linear gradient across the fade region. Opacity transition 200ms; disabled (instant) under `prefers-reduced-motion`.

## Implementation tasks

### 1. `src/lib/components/chat/MessageList.svelte` — become pure content

- Remove the outer `border border-border`, `rounded-lg`, `overflow-auto`, `min-h-0 flex-1`, and the `bind:this={viewport}` binding from the root div (line 49-52). Keep `bg-background p-4` (or drop bg to inherit; overlays use `var(--background)` either way — keep `bg-background` to stay a clean panel).
- Remove the `viewport` state (line 34) and the auto-scroll `$effect` (lines 41-46) — this responsibility moves to the page.
- The component now renders only the inner `flex flex-col gap-4` content (messages, streaming bubble, empty state). Its props are unchanged.

### 2. `src/routes/chat/[id]/+page.svelte` — three-region layout + scroll + fade

**a. Bound the column height (so only the middle scrolls, `<main>` no longer scrolls for this route):**
- Line 240 container: change `mx-auto flex max-w-3xl flex-col gap-3 p-4` → add `h-full min-h-0` (i.e. `mx-auto flex h-full min-h-0 max-w-3xl flex-col gap-3 p-4`).

**b. Top pane (`shrink-0`):** wrap the existing breadcrumb row (lines 241-275) and the brief/intake/inferred block (lines 277-336) in a single `<div class="flex shrink-0 flex-col gap-3">`. Bind a ref, e.g. `bind:this={topPane}`.

**c. Middle pane (`relative flex-1 min-h-0`):** replace the bare `<MessageList …/>` (lines 338-346) with:
```
<div class="relative min-h-0 flex-1" bind:this={middleWrapper}
     style="--fade-top:{fadeTop}px; --fade-bottom:{fadeBottom}px;">
  <div bind:this={viewport} class="h-full overflow-auto bg-background p-4">
    <MessageList … />            <!-- all existing props -->
  </div>
  <!-- top fade overlay -->
  <div class="pointer-events-none absolute inset-x-0 top-0 z-10 transition-opacity duration-200
              {topVisible ? 'opacity-100' : 'opacity-0'}"
       style="height:var(--fade-top);
              background:linear-gradient(to bottom, var(--background), transparent);"></div>
  <!-- bottom fade overlay -->
  <div class="pointer-events-none absolute inset-x-0 bottom-0 z-10 transition-opacity duration-200
              {bottomVisible ? 'opacity-100' : 'opacity-0'}"
       style="height:var(--fade-bottom);
              background:linear-gradient(to top, var(--background), transparent);"></div>
</div>
```
- Add `motion-reduce:transition-none` (or a `prefers-reduced-motion` guard) to both overlays so the fade toggles instantly when reduced motion is requested.

**d. Bottom pane (`shrink-0`):** wrap everything currently between `MessageList` and `Composer` — approval cards (348-354), chat error (356-369), labs error (371-379), quizzes error (381-392), raw-offer (394-411), gate progress (413-415) — plus `<Composer/>` (417-422) in a single `<div class="flex shrink-0 flex-col gap-3">`. Bind a ref, e.g. `bind:this={bottomPane}`.

**e. State + reactive logic (Svelte 5 runes):**
```
let viewport = $state<HTMLDivElement | null>(null);
let topPane = $state<HTMLElement | null>(null);
let bottomPane = $state<HTMLElement | null>(null);
let middleWrapper = $state<HTMLDivElement | null>(null);
let topVisible = $state(false);
let bottomVisible = $state(false);
let fadeTop = $state(0);
let fadeBottom = $state(0);

const FADE_CAP_PX = 80;   // optional absolute cap
function halfCapped(h: number) { return Math.min(FADE_CAP_PX, Math.max(0, Math.floor(h / 2))); }

function updateFadeHeights() {
  if (topPane) fadeTop = halfCapped(topPane.offsetHeight);
  if (bottomPane) fadeBottom = halfCapped(bottomPane.offsetHeight);
}

function updateVisibility() {
  const el = viewport;
  if (!el) return;
  topVisible = el.scrollTop > 1;
  bottomVisible = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
}
```

**f. Auto-scroll (moved here from `MessageList`):** keep the existing semantics (pin to bottom only when a new message is added/loaded, not on every streamed token):
```
$effect(() => {
  void chatStore.messages.length;   // re-run on message add / chat load
  if (viewport) viewport.scrollTop = viewport.scrollHeight;
});
```

**g. Scroll + resize wiring (`$effect` with cleanup, runs once refs exist):**
- Add `scroll` listener on `viewport` → `requestAnimationFrame(updateVisibility)` (rAF-throttled; reuse a pending flag).
- `ResizeObserver` on `topPane` and `bottomPane` → `updateFadeHeights()` (also re-run `updateVisibility()` since pane resize changes layout).
- `ResizeObserver` on `viewport.firstElementChild` (the message content) → `updateVisibility()` (so streaming token growth updates bottom fade even without a scroll event).
- Call `updateFadeHeights()` and `updateVisibility()` once initially and after auto-scroll lands.
- Disconnect observers + remove listener in the `$effect` cleanup.
- Use an `$effect` (not `onMount`) bound to the refs so it (re)attaches when the chat becomes available (the whole tree is behind `{#if chatStore.chat}`).

### 3. Edge cases to handle/verify

- **Empty / intake state:** when `showBriefIntake` is true there are no messages; the middle pane is empty, both overlays stay hidden (no overflow). Top pane (with the intake card) and bottom pane (composer) still render.
- **Streaming growth:** tokens append without scroll events; the content `ResizeObserver` re-runs `updateVisibility`, so the bottom fade reflects new overflow correctly. When a persisted message triggers the auto-scroll-to-bottom, `bottomVisible` becomes `false` (pinned to bottom → no bottom fade), matching desired behavior.
- **Very tall panes on small screens:** top + bottom panes may exceed viewport height; the middle can shrink toward 0 and `<main>`'s `overflow-auto` remains the graceful fallback (page scrolls). Acceptable degradation; do not hard-cap pane heights.
- **Chat navigation:** the `$effect` keyed on `chatStore.messages.length` re-pins to bottom on chat switch; refs persist across switches because the tree stays mounted under `{#if chatStore.chat}`.
- **Other routes unaffected:** `/chat` list, `/settings`, etc. still rely on `<main>` scrolling; only `/chat/[id]` now fills `h-full`.

## Validation

1. `pnpm check` (svelte-check type-check) — must pass.
2. `pnpm lint` (ESLint + Prettier check) — must pass.
3. Manual (per AGENTS.md gates, real machine — UI cannot be verified headless):
   - Open a multi-message conversation: breadcrumb (top) and composer (bottom) stay fixed while only messages scroll.
   - Confirm the encompassing border around all messages is gone; the assistant bubble still has its own border.
   - Scroll up mid-conversation: top **and** bottom fades appear (content hidden in both directions); messages progressively vanish at each sticky boundary and are fully gone at the edge.
   - Scrolled to the very top: no top fade; scrolled to the very bottom: no bottom fade.
   - Stream a reply while pinned to bottom: no bottom fade; scroll up during streaming: bottom fade appears as content grows below.
   - Empty / first-run intake state: layout still renders (intake card on top, empty middle, composer on bottom), no stray fades.
   - Toggle theme + reload (existing persistence gate) still works.
   - Visit `/chat`, `/settings`: they still scroll normally (regression check).
   - `prefers-reduced-motion`: fade appears/disappears instantly (no 200ms transition).

## Risks / notes

- Overlays blend content toward `var(--background)`; this matches the opaque message panel. If the panel background is later made transparent or textured, switch the technique to CSS `mask-image` (same directional var logic) — flagged here for the implementer.
- The auto-scroll lift changes ownership from `MessageList` to the page; keep the exact "only on message count change, not per token" semantics to preserve current scroll-during-stream behavior.
- Fade height uses an optional 80px absolute cap on top of the ½-pane-height rule (still ≤ ½ pane height). Remove the cap if a larger fade is preferred.
