# Scroll Smoothness Remediation Plan

## Problem
Scrolling feels unsmooth across the app, both during live message streaming and
on long idle chats. Traced root causes (with evidence):

1. **Per-frame full markdown re-render while streaming.**
   `src/lib/components/chat/Markdown.svelte:22` — `html = $derived(renderMarkdown(raw))`
   re-runs the entire unified pipeline on every `raw` change. During streaming,
   `src/lib/stores/chat.svelte.ts:115-122` flushes `streamBuffer → streamBufferRender`
   once per rAF (~60 Hz), so the full pipeline in `src/lib/markdown/render.ts:65-74`
   — including **rehype-highlight** (highlight.js over the whole growing buffer) and
   **rehype-sanitize** — runs over the *entire* accumulated string every frame → O(n²)
   over a stream.
2. **Markdown `$effect` DOM post-processing every frame.**
   `Markdown.svelte:72-112` runs `querySelectorAll('a')`, `querySelectorAll('pre')`,
   creates/attaches copy buttons + external-link icons on every render → DOM churn
   ~60×/sec during streaming.
3. **Unthrottled ResizeObserver force-scroll + sync layout reads.**
   `src/routes/chat/[id]/+page.svelte:132-141` — `contentObserver` fires on every
   content resize (every frame while streaming), force-sets `scrollTop = scrollHeight`
   and calls `updateVisibility()` (`:99-106`) which reads `scrollTop`/`clientHeight`/
   `scrollHeight` synchronously → forced reflow, unthrottled (unlike the scroll handler
   at `:123-130` which is rAF-throttled).
4. **No list virtualization / DOM never shrinks.**
   `src/lib/components/chat/MessageList.svelte:61` renders all messages forever;
   `src/lib/components/chat/LazyMount.svelte` defers first mount but never unmounts.
   Each assistant row also runs `buildSourceMap` (`Highlighter.svelte:38`). Long
   chats → large DOM → scroll paint cost even when idle.
5. **N window scroll listeners.**
   `src/lib/components/chat/Highlighter.svelte:408` `<svelte:window onscroll>` is one
   per assistant message (dormant during inner-viewport scroll, but wasteful).

CSS is otherwise clean: the only `backdrop-filter` is on the Sheet overlay
(`src/lib/components/ui/sheet/sheet-overlay.svelte:15`), inactive during chat.

## Decisions (confirmed with user)
- **Streaming render:** skip `rehype-highlight` while live (keep `rehype-sanitize` for
  safety). Code shows as plain monospace while streaming, gets syntax colors once
  finalized. Persisted/finalized messages always use the full pipeline.
- **Long-chat fix:** off-screen unmount + measured-height spacers, extending the
  existing `LazyMount` IntersectionObserver pattern (no external virtual-list lib).
- **Tactical fixes** (uncontroversial, included): dedupe the Markdown `$effect` so it
  does not run while `live`; rAF-coalesce the `contentObserver`/`updateVisibility`
  path; consolidate the N window scroll listeners.

Non-goal: full virtual-list windowing; changes to the markdown pipeline output for
finalized messages; rehype-sanitize removal.

---

## Tasks

### A. Cheap live-render path (candidates 1 + 2)
1. In `src/lib/markdown/render.ts`, add a second cached processor **without**
   `rehype-highlight` (keep `remarkParse`, `remarkGfm`, `remarkMath`, `remarkRehype`,
   `rehypeKatex`, `admonition`, `rehypeSanitize`, `rehypeStringify`). Export
   `renderMarkdownLive(raw: string): string`.
2. In `src/lib/components/chat/Markdown.svelte`, change the derived HTML to branch on
   `live`:
   ```ts
   const html = $derived(live ? renderMarkdownLive(raw) : renderMarkdown(raw));
   ```
3. Gate the post-processing `$effect` (`Markdown.svelte:72-112`) on `!live` so copy
   buttons / external-link icons are NOT injected while streaming. They render once
   when the finalized `MessageRow` mounts `Markdown` without `live`.
4. Leave `MessageList.svelte:99` (`<Markdown raw={…} live={true} />`) as-is; it now
   hits the cheap path. (Reasoning bubble at `:94` stays full pipeline — lower frequency.)
5. Tests: extend `src/lib/markdown/render.test.ts` — assert `renderMarkdownLive`
   produces sanitized output and does **not** emit `hljs`/`language-` token classes
   for a fenced code block, while `renderMarkdown` does.

### B. Throttle content-observer + layout reads (candidate 3)
In `src/routes/chat/[id]/+page.svelte`:
1. Rework the `contentObserver` callback (`:136-141`) to be rAF-coalesced (same
   `pending`/`requestAnimationFrame` pattern already used by the scroll handler at
   `:123-130`): one layout pass per frame max, doing both the stick-to-bottom
   force-scroll (gated on `stickToBottom && !scrolledToHash`) and `updateVisibility()`.
2. Do **not** remove the force-scroll — it is required for stick-to-bottom during
   streaming — just coalesce it.
3. `updateFadeHeights()` (`:95-98`) reads `offsetHeight`; fold it into the same
   coalesced callback instead of running on its own in the `resizeObserver`.

### C. Off-screen unmount + measured spacers (candidate 4)
Generalize `src/lib/components/chat/LazyMount.svelte` into a mount/unmount wrapper:
1. Add props: `unmountFar = false`, `rootMargin = '600px'` (generous so hash-scroll
   targets are mounted before they are scrolled to), and keep the existing one-shot
   behavior as the default (`unmountFar={false}`) to avoid changing other call sites.
2. When `unmountFar`, keep the IntersectionObserver attached (do not `disconnect()` on
   first intersection); toggle a `visible` state on intersect/leave.
3. When unmounted, render a spacer `<div>` whose `height` = the last-measured height
   of the row (tracked via a per-row `ResizeObserver` recording into a `height`
   state). First-ever mount (no height known) renders the content directly (current
   behavior) so there is no initial shift.
4. In `src/lib/components/chat/MessageList.svelte:61-73`, wrap each message row with
   `<LazyMount unmountFar>` (the `LazyMount` currently lives inside `MessageRow` at
   `MessageRow.svelte:140,143` — move the outer mount/unmount boundary to the row
   level in `MessageList`, and let `MessageRow` render `Markdown` directly without its
   own `LazyMount` to avoid double IO).
5. Edge cases to handle / verify:
   - **Hash-scroll target** (`chat/[id]/+page.svelte:263-289`): the 600 px `rootMargin`
     + the existing `attemptScroll` retry loop must converge so the target is mounted
     before `scrollIntoView`. Confirm by testing a deep-link to a far message.
   - **Stick-to-bottom during streaming**: the bottom (streaming) message is always in
     view → stays mounted. Confirm auto-scroll still pins.
   - **Stale spacer height after remount** (e.g. Mermaid finishes after remount):
     acceptable minor shift on next unmount; note in followups, do not block.

### D. Consolidate window scroll listeners (candidate 5)
1. Replace the per-instance `<svelte:window onscroll={onScrollClear} />` in
   `Highlighter.svelte:408` with a single shared listener: create a tiny module
   (e.g. `src/lib/chat/scroll-bus.ts`) that attaches **one** window `scroll` listener
   (passive) on first subscriber and dispatches to registered callbacks; Highlighter
   subscribes/unsubscribes in an `$effect`. Removes N listeners → 1.
   - Lower priority than A–C; only do if A–C leave residual jank on window-scroll
     (e.g. composer-grow causing page scroll).

---

## Risks / boundaries
- **Security:** `renderMarkdownLive` MUST keep `rehype-sanitize` (live HTML is still
  injected via `{@html}`). Do not drop sanitize.
- **No regression on finalized rendering:** `renderMarkdown` (full pipeline) is
  unchanged; only the live bubble and off-screen rows change behavior.
- **Scroll position integrity (C):** measured-height spacers must preserve scroll
  position when a row above the viewport unmounts; verify no jump on rapid scroll up.
- **Highlighter/expound (C):** `Highlighter.svelte:38` `buildSourceMap(raw)` is
  `$derived` from `raw` (not DOM), so it works whether or not the inner `Markdown` is
  mounted. Confirm expound selection still resolves after a remount.

## Validation
- `pnpm lint && pnpm check && pnpm test` green (root); extend
  `src/lib/markdown/render.test.ts` for `renderMarkdownLive`.
- `pnpm --filter @mayon/server test` green (no server changes expected, but keep CI
  honest).
- Manual (per AGENTS.md dev loop: `pnpm dev:deps` then `pnpm dev`):
  1. Stream a long reply with code blocks — scroll stays smooth during streaming;
     code gains syntax highlighting only after the reply finalizes.
  2. Open a long chat (many messages) and scroll rapidly up/down — no stutter, no
     scroll-position jumps when rows unmount/remount.
  3. Deep-link to a far message via `#m=<id>` — target mounts and scrolls into view.
  4. Expound: select text in a message that was unmounted and remounted — selection
     still resolves to correct source offsets.
  5. DevTools Performance: during streaming, the per-frame Markdown render + layout
     cost should drop sharply (no `rehype-highlight` in the live flamegraph; one
     coalesced layout pass per frame).
