# Phased plan — User-journey audit, Wave 2b: P1 perf + robustness + discoverability

- **Source spec:** `refinement/2026-07-05 user-journey-audit.md` (findings C2, C3, C1, C5, D1, B2, B7, B8).
- **Status:** Execution-ready breakdown. This file covers the **performance P1s** (streaming render throttle, mermaid/shiki, message-list virtualization, interrupted-turn marker), the **robustness P1** (DB error badge), and the **discoverability P1s** (brief progressive disclosure, expound selection toolbar, ChatRail hoisting/labeling).
- **Phase keys:** `UJ13` … `UJ20`. Each is independently shippable.
- **Conventions:** same cross-cutting rules as `user-journey-p0.md` (two runtimes, one storage seam, keys never in DB, `pnpm lint && pnpm check` before done, Vitest + manual gate per phase).

## Phase dependency graph

```
UJ13 (stream render throttle) ──┐
UJ14 (shiki CSS + mermaid idle) ├─ independent; all touch different files
UJ15 (MessageList virtualize)   │
UJ16 (interrupted-turn marker)  ┤
UJ17 (DB error badge strip)     ┤
UJ18 (brief progressive disclose)┤
UJ19 (expound selection toolbar)┤
UJ20 (ChatRail hoist + label)   ┘
```

All eight are independent. UJ13 and UJ15 both touch the streaming/render hot path and are best understood together (and both feed the "does the chat feel smooth" question), but neither blocks the other. UJ16 depends *conceptually* on UJ10's failed-turn work from `p1a` (both mark anomalous last rows) but is technically independent.

---

## UJ13 — Throttle streaming markdown render (C2)

> *"`MessageList.svelte:77`: `<Markdown raw={stripGateFence(streamBuffer)} />` inside the streaming block. `chat.svelte.ts:237`: `updateStreamBuffer: (n) => (this.streamBuffer = n)` — direct `$state` assignment per delta, no throttle. The unified pipeline runs synchronously on every token."*

This is the single biggest perceived-performance fix in the audit. At 100+ tokens/sec with tables/KaTeX/code, the whole buffer is re-parsed and re-rendered on every token.

**Mechanism (decided):**
- Coalesce `streamBuffer` updates onto a `requestAnimationFrame` cadence. The store keeps receiving deltas fast (the agent loop calls `updateStreamBuffer` per chunk), but the *rendered* value the UI binds to is updated at most once per frame.
- Introduce a second piece of state: `streamBufferRender` (the throttled, render-facing copy). The agent loop writes to the raw `streamBuffer`; a rAF loop copies `streamBuffer → streamBufferRender` at frame rate. `MessageList` binds to `streamBufferRender`, not `streamBuffer`.
- On stream end (the `finally` in `send`), do one final synchronous flush so the last token is never dropped.

**Decision surfaced while planning — rAF vs raw-text mid-stream**

The audit offers two options: (a) throttle the full-markdown render to rAF, or (b) render lightweight raw text mid-stream and run the full pipeline once on completion. **Decided: option (a) (rAF throttle).** Reasons:
- Option (b) introduces a visible "raw text → formatted" swap at the end, which is jarring in a learning app where tables/code formatting is part of the value. The user wants to see formatting materialize.
- rAF throttle caps re-renders at ~60/sec (vs 100+ today) and the markdown pipeline is fast enough per-frame for typical message sizes. For very large buffers, UJ15 (virtualization) + the natural end-of-stream flush keep it bounded.
- Keep a single source of truth (`streamBufferRender`) rather than a debounce timer (timers add latency; rAF is frame-aligned and feels live).

**Files modified**
- `src/lib/stores/chat.svelte.ts`
  - Add `streamBufferRender = $state('')` alongside `streamBuffer` (`:72`).
  - In `send()`, start a rAF loop when streaming begins (`:200`): schedule a function that sets `streamBufferRender = streamBuffer` and re-schedules until streaming ends. Use a `rafId` stored on the instance; cancel it in `finally`.
  - In `finally` (`:320-346`): do a final `this.streamBufferRender = this.streamBuffer` before clearing both, so the last frame is exact. Then `streamBufferRender = ''`.
  - Keep `updateStreamBuffer` (`:237`) writing to `streamBuffer` (unchanged) — the rAF loop is the only reader that promotes it to the render copy.
- `src/lib/components/chat/MessageList.svelte`
  - Change the streaming block (`:62-86`) to bind `streamBuffer={streamBufferRender}` instead of `streamBuffer`. Add `streamBufferRender` to the props.
  - Update the `showLiveBubble`-equivalent: the live bubble should show when `streamBufferRender.length > 0` (the throttled copy), which is the right call — if no frame has flushed yet, showing "Thinking…" (the `{:else}` at `:78-82`) is correct.
- `src/routes/chat/[id]/+page.svelte`
  - Pass `streamBuffer={chatStore.streamBufferRender}` to `<MessageList>` (`:543`).

**Tests** (Vitest)
- Store-level (with fake rAF / `vi.useFakeTimers`): given rapid `updateStreamBuffer` calls, `streamBufferRender` is updated at most once per frame and ends equal to the final `streamBuffer` after the flush. The raw `streamBuffer` still holds every intermediate value (so the final persisted message is unaffected — persistence reads from `appendAssistantText`, not the render copy).

**Manual gate**
- Stream a long, markdown-heavy reply (tables, KaTeX, multiple code blocks) → the UI stays responsive (no main-thread freeze); formatting appears progressively; the final rendered message matches a non-streamed render of the same content (no truncation from a dropped last frame).

### UJ13 — decisions / open items
- **RESOLVED:** rAF-throttle via a `streamBufferRender` copy (option a), not raw-text-mid-stream (option b). Final flush on stream end.

---

## UJ14 — Shiki/highlight.js theme + deferred Mermaid (C3)

> *[!NOTE on C3]: "Let's defer Mermaid render until idle. Let's also add a spinner (but ideally the |/− animation to signal that it is code right now and it says 'Generating Diagram…'). I also don't see Shiki working? I don't see any highlighting being done to my renders."*

Two distinct problems, one phase (both are markdown-render polish):

### UJ14a — Syntax highlighting is invisible (missing theme CSS)

**Root cause (verified):** the pipeline uses **`rehype-highlight` (highlight.js)**, not Shiki (`render.ts:24,71`). It correctly emits `<code class="hljs language-xxx">` and `<span class="hljs-keyword">` etc., and the sanitizer passes them through (`render.ts:45-54`). **But no highlight.js theme stylesheet is imported anywhere** — `app.css` imports KaTeX CSS but not an hljs theme, so the token spans have no color rules. The highlighting *is* computed; it just has no visible style.

**Mechanism (decided):**
- Import a highlight.js theme that adapts to light/dark. `highlight.js/styles/github.min.css` (light) and `github-dark.min.css` (dark) are both shipped by the `highlight.js` package (already a dep at `package.json:53`).
- Import both in `src/app.css`, scoped to the dark/light token, so the theme follows the app's existing theme toggle. Pattern (Tailwind v4 CSS-first):
  ```css
  @import 'highlight.js/styles/github.min.css';
  @import 'highlight.js/styles/github-dark.min.css';
  ```
  …then wrap the dark one so it only applies in dark mode. highlight.js's `github-dark.css` targets `.hljs` directly, so scope it: import the dark theme and nest its rules under the app's dark selector (the app uses a `.dark` class or `prefers-color-scheme` — match whichever `ThemeToggle` already uses). Simplest robust approach: import both raw, then add a small override block in `app.css` that hides the light theme's colors under `.dark` and vice versa. **Decided:** import both and add a scoping wrapper.
- Fix the stale comment in `LabRunner.svelte:54` ("KaTeX / Shiki / GFM") → "KaTeX / highlight.js / GFM" (it never was Shiki).

**Files modified**
- `src/app.css` — add the two hljs theme imports + a light/dark scoping block. Confirm the app's dark-mode mechanism (class vs media query) and scope accordingly.
- `src/lib/components/labs/LabRunner.svelte:54` — comment fix (Shiki → highlight.js).

**Tests**
- `render.ts` already asserts hljs classes are emitted (`render.test.ts:24-29`); add an assertion that the output contains `class="hljs` if not already. The *visual* theme is a manual gate.

### UJ14b — Defer Mermaid render + "Generating Diagram…" indicator

**Root cause:** `Markdown.svelte:26-53` renders mermaid blocks in `onMount` (eagerly, per message). On a page with several diagrams this blocks; and there's a flash of raw fenced code before the SVG swaps in (the audit's note).

**Mechanism (decided — per the `[!NOTE]`):**
- Defer mermaid rendering until idle: wrap the per-block `renderMermaidBlock` call in `requestIdleCallback` (with a `setTimeout` fallback where rIC is unavailable).
- Replace the raw-fenced-code flash with a **"Generating Diagram…"** placeholder using a `|/−` (rotating-bar) spinner, exactly as the user asked. The placeholder shows in place of the `<pre>` until the SVG is ready, then swaps.

**Files modified**
- `src/lib/components/chat/Markdown.svelte`
  - In `onMount` (`:26-53`), for each `code.language-mermaid` block:
    - Immediately replace the `<pre>` with a placeholder `<div class="mermaid-pending">` containing the `|/−` spinner + "Generating Diagram…" text. (This kills the raw-code flash instantly.)
    - Schedule `renderMermaidBlock(source)` via `requestIdleCallback` (fallback `setTimeout(…, 0)`). On resolve, swap the placeholder for the SVG wrapper (existing logic at `:37-44`); on reject, swap for the error note (existing `:46-51`).
  - Add a small `MermaidPending` inline markup + CSS for the `|/−` animation (a CSS keyframe rotating a bar, or reuse `Spinner` with a new `variant="bar"` if trivial). Keep it lightweight.
- `src/lib/components/chat/Spinner.svelte` — add a `bar` variant (the `|/−` glyph) if reused; otherwise inline the animation in `Markdown.svelte`.

**Decision surfaced while planning — idle callback + streaming**

During streaming (UJ13), the markdown re-renders per frame on the *live* buffer. Mermaid blocks in the live buffer would re-trigger `onMount`? No — `MessageList` renders the live bubble's markdown via a single `<Markdown>` instance whose `raw` prop updates; `onMount` runs once. But the `:55-77` `$effect` (link/table enhancement) re-runs on each `raw` change. **Decided:** the mermaid `onMount` is once-per-instance (correct); but the live bubble's mermaid blocks should **not** render to SVG mid-stream (wasteful, and the source is incomplete). Guard: in the streaming `<Markdown>`, skip mermaid post-processing entirely (render the fenced code as-is, or show the "Generating Diagram…" placeholder without scheduling the render). Only the *persisted* `MessageRow` `<Markdown>` runs the full mermaid pipeline. This is already naturally the case if the live bubble's `<Markdown>` is a separate instance — verify and add the guard if needed.

**Tests**
- None automated (DOM/animation). The `hasMermaid`/`renderMermaidBlock` helpers in `src/lib/markdown/mermaid.ts` are already unit-tested; this phase changes only *when* they're called.

**Manual gate**
- A reply with fenced code (e.g. a JS snippet) → **syntax colors now appear** (light in light mode, dark in dark mode). Toggle theme → colors swap.
- A reply with a mermaid block → "Generating Diagram…" with the `|/−` spinner shows immediately (no raw-code flash), then the SVG swaps in when idle. Multiple diagrams don't jank the page.

### UJ14 — decisions / open items
- **RESOLVED (UJ14a):** the highlighter is highlight.js (not Shiki); import `github` + `github-dark` themes scoped to the app's dark-mode mechanism.
- **RESOLVED (UJ14b):** defer mermaid to `requestIdleCallback`; show a `|/−` "Generating Diagram…" placeholder; skip mermaid rendering in the live streaming bubble (persisted rows only).

---

## UJ15 — Virtualize the message list (C1)

> *"`MessageList.svelte:56`: a flat `{#each visibleMessages}` renders every message row into the DOM. A long conversation puts the full tree in the DOM."*

**Mechanism (decided):**
- Window the rendered message rows: only rows near the viewport are in the DOM, with sentinel/intersection-based paging. Keep the reference-based context assembly unchanged (this is purely a render concern — `assembleContext` reads from the DB, not the DOM).
- Use a lightweight `IntersectionObserver`-based windowing wrapper rather than pulling in a heavy virtual-list dependency. Each row is already keyed by `message.id` (`MessageList.svelte:56`) and wrapped in `<div id="msg-{message.id}">` (`:57`), which the hash-scroll logic (`chat/[id]/+page.svelte:226-261`) depends on — virtualization must preserve these ids for deep-linking (`?m=`/hash scroll).

**Decision surfaced while planning — keep it simple; defer full virtualization if risky**

Two options:
1. Full windowing (only ~20 rows in the DOM at a time; replaces the flat each).
2. Progressive/partial: render all rows but lazy-mount heavy children (Markdown/KaTeX/mermaid) via `IntersectionObserver` so off-screen rows are cheap.

**Decided:** option 2 first (lazy-mount heavy children), with option 1 as a follow-up only if profiling shows it's needed. Reasons:
- Option 1 breaks the existing `#msg-{id}` anchors and the hash-scroll retry loop (`chat/[id]/+page.svelte:251-260`) which assumes the target row is eventually in the DOM — virtualization would need a "render-on-demand-then-scroll" path, which is real work and real risk.
- The actual perf cost today is the *heavy children* (markdown parse + KaTeX + mermaid per row), not the row wrappers themselves. Lazy-mounting those via IO gets most of the win without touching anchors.
- The audit rates this P1/M, and a learner's conversation rarely exceeds a few hundred rows; option 2 keeps those snappy.

**Files modified**
- `src/lib/components/chat/Markdown.svelte` (or a new `LazyMount.svelte` wrapper)
  - Add a tiny `LazyMount` component: renders a placeholder `<div>` until an `IntersectionObserver` fires, then renders its children snippet. Used to wrap the expensive bits.
- `src/lib/components/chat/MessageRow.svelte`
  - Wrap the `<Markdown>` render (both the assistant `Highlighter > Markdown` at `:112-119` and the user `Markdown` at `:121`) in `<LazyMount>` so off-screen rows skip the markdown pipeline until they scroll near. The row shell (avatar, label, branch button) still renders cheaply.
  - Keep `id="msg-{message.id}"` on the outer row div (unchanged) so anchors survive.
- `src/routes/chat/[id]/+page.svelte` — the hash-scroll retry loop is unchanged (the row shell is always in the DOM; only the markdown inside is deferred, and by the time the user scrolls to it, IO has fired).

**Tests**
- `LazyMount` component test (if feasible with vitest + jsdom + IO polyfill): renders placeholder until intersect, then children. If IO is hard to test in jsdom, defer to manual gate.

**Manual gate**
- Open a chat with 100+ messages → scroll is smooth; off-screen rows don't run mermaid/KaTeX (DevTools: count `<svg class="mermaid">` — only near-viewport ones). Deep-link `/chat/[id]?m=<early-id>` still scrolls and flashes the right row.

### UJ15 — decisions / open items
- **RESOLVED:** lazy-mount heavy children via `IntersectionObserver` (option 2), not full row windowing (option 1), to preserve `#msg-{id}` anchors. Revisit full virtualization only if profiling demands it.

---

## UJ16 — Interrupted-turn marker (C5)

> *"`chat.svelte.ts:9-11`: "A reload mid-stream loses the in-flight turn (accepted)." … After reload/navigation, the user sees their message with no reply and no indication a turn was interrupted. Silent data loss in a learning app erodes trust."*

**Mechanism (decided — audit's "lighter fix"):**
- On abort/navigation mid-stream, persist the partial `streamBuffer` as a draft assistant row marked `metadata: { interrupted: true }`, rendered with an "interrupted — regenerate" affordance.
- This closes the trust gap (the user's spent tokens aren't silently lost) without the much heavier true-resumability fix.

**Decision surfaced while planning — where the partial buffer is saved**

Two moments the buffer can be lost:
1. **`stop()`** (user clicks Stop, or navigates away → `load()` calls `stop()`). Today `stop()` aborts; the `finally` in `send` clears `streamBuffer` without persisting.
2. **Reload** (tab close / F5). The whole JS state is gone; only what's in the DB survives.

For (2), persisting on every token is wasteful. **Decided:** persist the interrupted row in `send()`'s `finally`, **only when** the turn was aborted (`aborted === true`) **and** `streamBuffer` is non-empty. This covers both the Stop button and navigation-away (which calls `stop()` → abort). It does **not** cover a hard tab-close mid-stream (the `finally` may not run on unload) — that's accepted, matching the existing "reload mid-stream loses the turn" contract, now narrowed to "hard unload loses it; soft abort/navigation preserves it."

**Files modified**
- `src/lib/stores/chat.svelte.ts`
  - In `send()`'s `finally` (`:320-346`): capture whether the turn was aborted. The `runAgentTurn` result already returns `{ aborted }` (`:226`). hoist `let aborted = false;` before the `try`, set it from the result, and in `finally`:
    ```ts
    if (aborted && this.streamBuffer.trim()) {
      try {
        const row = await repos.messages.append(chatId, 'assistant', this.streamBuffer, {
          metadata: JSON.stringify({ interrupted: true })
        });
        this.messages = [...this.messages, row];
      } catch { /* best-effort */ }
    }
    ```
  - This must run *before* `this.streamBuffer = ''` (currently `:326`).
- `src/lib/components/chat/MessageRow.svelte`
  - Parse `interrupted` from metadata (extend `parseMetadata` at `:45-55`).
  - When `interrupted`, render a subtle banner at the bottom of the assistant bubble: *"This reply was interrupted."* + a **"Regenerate"** button.
- `src/routes/chat/[id]/+page.svelte` (or `MessageList`)
  - Wire the Regenerate action: it should re-send the *last user message's* text (the one that prompted the interrupted reply). Add `onRegenerate(messageId)` that finds the preceding user message, calls `chatStore.send(userText)`, and (optionally) deletes/hides the interrupted row. **Decided:** hide the interrupted row (set `metadata.hidden = true` via an update) rather than delete it — preserves history if the user wants to see what partial reply came through; the existing `isHidden` filter in `MessageList.svelte:39-47` already hides `hidden:true` rows.

**Tests** (Vitest, in-memory driver)
- A `send` that is aborted after some `streamBuffer` has accumulated → an assistant row with `metadata.interrupted === true` is appended; the buffer text is preserved in that row.
- A `send` that completes normally → no interrupted row. A `send` aborted with an empty buffer → no interrupted row (don't litter empty rows).

**Manual gate**
- Start a stream → click Stop mid-stream → an interrupted assistant row appears with the partial text + "Regenerate". Click Regenerate → the interrupted row hides, the last user prompt re-sends, a fresh reply streams.
- Navigate from chat A (mid-stream) to chat B → A's partial reply is saved as interrupted; return to A → see it with the affordance.

### UJ16 — decisions / open items
- **RESOLVED:** persist partial buffer as `metadata.interrupted` on abort-with-non-empty-buffer (covers Stop + navigation; hard unload still accepted). Regenerate hides the interrupted row and re-sends the last user prompt.

---

## UJ17 — DB error badge → inline error strip + reload (D1)

> *"`DbStatus.svelte`: the error path shows "DB error" text but the actual message lives in the `title` attribute — you must hover to see why. No inline message, no retry/reload button. A migration failure leaves the DB partially migrated and the user sees a red badge with no path forward."*

**Mechanism (decided):**
- When `status === 'error'`, expand the badge into an inline error strip: the message text is shown directly (not in a `title`), plus a **"Reload"** button.
- Keep the compact badge for `initializing` / `ready` states (don't bloat the sidebar footer for the common case).

**Files modified**
- `src/lib/components/DbStatus.svelte`
  - When `dbStatus.status === 'error'`, render an expanded block instead of the compact badge:
    ```svelte
    {#if dbStatus.status === 'error'}
      <div class="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs">
        <div class="flex items-center gap-1.5 font-medium text-red-700 dark:text-red-400">
          <AlertCircle class="size-3.5" /> Database error
        </div>
        <p class="mt-1 text-red-700/90 dark:text-red-400/90">{dbStatus.error ?? 'Unknown error'}</p>
        <Button variant="outline" size="sm" class="mt-2" onclick={() => location.reload()}>Reload</Button>
      </div>
    {:else}
      <!-- existing compact badge for initializing/ready -->
    {/if}
    ```
  - Keep the `title` attribute on the compact badge as a secondary path (harmless).
- `src/lib/stores/db.svelte.ts` — no change (`error` string is already held at `:8`).
- Note: migration failure has no rollback today (`migrator.ts:14-43`). The Reload button lets the user retry after an external fix (e.g., freeing disk, restoring a backup). It does **not** auto-recover a half-migrated DB; that's a separate robustness concern out of scope for this audit (the audit explicitly avoids schema/migration changes).

**Tests**
- None automated (presentational). The `dbStatus` state machine is already exercised by the boot path.

**Manual gate**
- Force a DB error (e.g., point the OPFS path at an unwritable location, or simulate in dev) → the sidebar shows the inline error strip with the real message + Reload. Click Reload → app reboots. In `ready`/`initializing` states the footer is unchanged (compact badge).

### UJ17 — decisions / open items
- **RESOLVED:** expand to inline strip + Reload only on `error`; leave `ready`/`initializing` compact. No migration-rollback work (out of audit scope).

---

## UJ18 — Brief intake progressive disclosure (B2)

> *"`BriefCard.svelte` presents, at once: goal (required), level, mode, structure, teacher persona, context, scope. Reads like a registration form. The jargon ('Socratic', 'Guided curriculum', 'Devil's advocate') is unexplained."*

**Mechanism (decided — per the audit's fix):**
- Progressive disclosure. Lead with **goal** only (full-width, prominent). Collapse level/mode/structure/persona behind a "Calibration" disclosure, and context/scope behind an "Advanced" disclosure.
- The profile pre-fill (`profile.ts`, `applyProfile`) still applies silently to the hidden fields; the user just doesn't *see* seven controls on first contact. The "Just start chatting" escape (`BriefCard.svelte:239-241`) stays.
- Both intake and edit modes get the disclosure treatment (edit pre-opens the disclosures if the brief already has non-default values in a section, so the user isn't surprised by hidden edits).

**Decision surfaced while planning — disclosure component**

The app already uses shadcn-svelte (bits-ui). **Decided:** use the shadcn `Collapsible` component (if present) or a minimal local disclosure (`<details>`-style with a chevron + `$state` toggle) to avoid a new dep. Check `src/lib/components/ui/` for an existing collapsible/accordion; if none, use a local toggle (consistent with the existing `ChevronDown` usage in `BriefCard.svelte:146`).

**Files modified**
- `src/lib/components/chat/BriefCard.svelte`
  - Restructure the form (`:124-249`):
    1. **Goal** (required) — full-width, prominent (unchanged control, more visual weight).
    2. **"Calibration" disclosure** (collapsed by default in intake; open in edit if any of level/mode/structure/persona is non-default) — contains level, mode, structure, persona (`:166-209`).
    3. **"Advanced" disclosure** (collapsed by default) — contains context, scope (`:211-235`).
  - Add two `$state<boolean>` toggles (`calibrationOpen`, `advancedOpen`) seeded from the brief's non-default-ness in edit mode.
  - The submit/skip actions (`:237-249`) stay at the bottom.
  - Add one-line plain-language hints under the jargon selects where they don't already exist (the structure select already has a hint at `:194-198`; add similar for mode and persona if missing — keep them short).

**Tests**
- None automated (layout). The `buildBrief`/`applyProfile` logic is unchanged.

**Manual gate**
- New chat → intake shows only Goal + the two collapsed disclosures + actions. Open "Calibration" → level/mode/structure/persona appear (pre-filled by profile). Open "Advanced" → context/scope. Submit with only goal → works (profile defaults applied). Edit an existing brief → disclosures auto-open if their fields are non-default.

### UJ18 — decisions / open items
- **RESOLVED:** two disclosures (Calibration, Advanced); profile pre-fill still applies silently; edit mode pre-opens non-default sections. Use existing collapsible or a local toggle (no new dep).

---

## UJ19 — Expound selection toolbar (B7)

> *"The only entry [to Expound] is a right-click context menu on a selection. The sole hint is an aria-label. No selection toolbar appears on mouse-up. No mobile/long-press equivalent. Expound is the flagship dense-content feature and it's hidden behind an interaction most users won't try."*

**Mechanism (decided):**
- A floating selection toolbar that appears above the selection on mouse-up / long-press, with a **"Branch from this"** button (consistent with UJ8's renamed action).
- Keep the right-click context menu as a secondary path (don't remove it — power users expect it).
- The toolbar reuses the existing selection-capture logic (`Highlighter.svelte:87-110`) and the existing expound flow (`createExpoundBranch`).

**Decision surfaced while planning — toolbar vs reuse of the constructor**

Today: select → right-click → "Expound…" → opens `ExpoundPromptConstructor` (the floating prompt box). The toolbar should be the *first* step (select → toolbar → "Branch from this" → opens the same constructor). **Decided:** the toolbar's button is exactly equivalent to the context menu's "Branch from this text" — both open `ExpoundPromptConstructor`. No new flow; just a more discoverable entry point.

**Files modified**
- `src/lib/components/chat/Highlighter.svelte`
  - Add a `selectionToolbar = $state<{ x; y; sel } | null>(null)` alongside the existing `menu`/`constructorState` (`:45-51`).
  - Add a `mouseup`/`selectionchange` listener on the container: when a non-collapsed text selection fully inside the container appears (reuse `captureSelection()` at `:87-110`), set `selectionToolbar` to the selection's bounding rect (positioned above it). Clear it when the selection collapses or on scroll.
  - Render a new `SelectionToolbar` (inline markup or a tiny new component) when `selectionToolbar` is set: a pill with "Branch from this" (and optionally "Copy", mirroring the context menu). Clicking "Branch from this" calls the same `handleExpound` path (`:135-143`).
  - Long-press for touch: a `touchstart`→`touchend` timer (≥500ms) that, if it produces a selection, shows the same toolbar. This is the mobile equivalent the audit asks for.
- `src/lib/components/chat/SelectionToolbar.svelte` **(new, optional)** — if the inline markup grows, extract it. Keep it presentational: props `x, y`, snippets/callbacks for actions, `onClose`.

**Decision surfaced while planning — coexistence with the right-click menu**

If the toolbar is visible and the user right-clicks, both could show. **Decided:** on `contextmenu`, hide the toolbar (the menu supersedes it) — set `selectionToolbar = null` in `onContextMenu` (`:112-119`). The two never show simultaneously.

**Tests**
- None automated (selection/DOM). The `captureSelection`/`resolveSelectionOffsets` pure helpers are already unit-tested.

**Manual gate**
- Select text in an assistant reply → a toolbar appears above the selection with "Branch from this" → click → the `ExpoundPromptConstructor` opens (same as right-click → "Branch from this text"). Right-click still works (toolbar hides when the menu opens). On touch (mobile devtools), long-press → selection + toolbar.

### UJ19 — decisions / open items
- **RESOLVED:** floating toolbar on mouse-up/long-press, reusing `captureSelection` + the existing constructor flow. Right-click menu kept as secondary; the two never coexist.

---

## UJ20 — ChatRail labeling + hoist generate-lab/quiz (B8)

> *[!NOTE on B8]: "Yeah let's do the labelling. And also agree with adding buttons to generate labs & quizzes on the header. Maybe the icons of Labs and Quizzes but with a plus sign?"*

Two changes, one phase (both are ChatRail discoverability):

### UJ20a — Label the mobile Sheet + the rail

- The mobile Sheet header is just "Navigation" (`chat/[id]/+page.svelte:687`) — no hint it contains the generate-lab/quiz triggers. Change it to **"Branches · Labs · Quizzes"** so the mobile user knows what's behind the toggle.

### UJ20b — Hoist generate-lab/quiz into the chat header

- Add generate-lab and generate-quiz buttons to the chat header (the top pane of `chat/[id]/+page.svelte`, alongside the existing "Tree" and "Mayon console" buttons at `:431-450`).
- Use the Labs/Quizzes icons **with a plus sign**, per the user's note. Lucide doesn't ship a combined "FlaskConical+plus" glyph, so compose: a `FlaskConical` icon with a small `Plus` overlay (or use `FlaskConical` next to a `Plus` in a button). **Decided:** a button showing `<FlaskConical/> + <Plus class="size-3 -ml-1 …"/>` (overlaid), titled "Generate lab"; symmetric for quizzes with `ListChecks`. Reuse the existing `onGenerateLab`/`onGenerateQuiz` (`:343-353`) and the UJ4 split state (`generatingLab`/`generatingQuiz`).
- The rail keeps its buttons too (for browsing existing artifacts); the header buttons are the *creation* trigger that's reachable without the rail.

**Files modified**
- `src/routes/chat/[id]/+page.svelte`
  - Mobile Sheet header (`:686-688`): `<SheetTitle>Navigation</SheetTitle>` → `<SheetTitle>Branches · Labs · Quizzes</SheetTitle>`.
  - Header button group (`:431-450`): add two buttons (generate lab / generate quiz) with the icon+plus composition, wired to `onGenerateLab`/`onGenerateQuiz`, `disabled={labsStore.generatingLab || quizzesStore.generatingQuiz}` (reusing UJ4's split), each showing its own spinner when its flag is true.
- `src/lib/components/chat/ChatRail.svelte` — unchanged (keeps its own generate buttons for the rail context).

**Tests**
- None automated (layout/wiring). The generate flow is already covered by the stores.

**Manual gate**
- Mobile: open the right Sheet → header reads "Branches · Labs · Quizzes". Desktop + mobile: the chat header has generate-lab and generate-quiz buttons (icon+plus); clicking generate-lab starts lab generation (button spinners, other disabled — per UJ4) and navigates to `/lab/[id]` on success. The rail's buttons still work independently.

### UJ20 — decisions / open items
- **RESOLVED (UJ20a):** mobile Sheet title → "Branches · Labs · Quizzes".
- **RESOLVED (UJ20b):** header buttons with icon+plus composition, reusing UJ4's split generate state; rail buttons retained.

---

## Decisions surfaced & made while planning (summary)

| # | Decision | Status |
|---|----------|--------|
| Q | **UJ13:** rAF-throttle via a `streamBufferRender` copy (not raw-text mid-stream); final flush on stream end. | Decided |
| R | **UJ14a:** highlighter is highlight.js (not Shiki); import `github`+`github-dark` themes scoped to dark mode. | Decided |
| S | **UJ14b:** defer mermaid to `requestIdleCallback`; `|/−` "Generating Diagram…" placeholder; skip mermaid in the live streaming bubble. | Decided |
| T | **UJ15:** lazy-mount heavy children via IO (option 2), not full row windowing, to preserve `#msg-{id}` anchors. | Decided |
| U | **UJ16:** persist partial buffer as `metadata.interrupted` on abort-with-buffer; Regenerate hides the row + re-sends last user prompt. | Decided |
| V | **UJ17:** inline error strip + Reload on `error` only; no migration-rollback work (out of scope). | Decided |
| W | **UJ18:** two disclosures (Calibration, Advanced); silent profile pre-fill; edit pre-opens non-default sections. | Decided |
| X | **UJ19:** floating selection toolbar (mouse-up/long-press) reusing existing expound flow; right-click menu kept, never coexisting. | Decided |
| Y | **UJ20a:** mobile Sheet title → "Branches · Labs · Quizzes". | Decided |
| Z | **UJ20b:** header generate-lab/quiz buttons with icon+plus, reusing UJ4 split state. | Decided |

## Verification gates (per phase)

| Phase | Automated (`pnpm test`, in-memory) | Manual (OPFS + Tauri) |
|-------|------------------------------------|------------------------|
| UJ13 | rAF throttle: render copy updates ≤ once/frame, final flush exact | heavy markdown stream stays responsive; final render matches |
| UJ14 | hljs class assertion in render test | code blocks now colored (light/dark); mermaid shows placeholder then SVG, no flash |
| UJ15 | (defer to manual) LazyMount IO | 100+ message chat scrolls smoothly; deep-link anchor still works |
| UJ16 | interrupted row persisted on abort-with-buffer; no row on normal/empty-abort | Stop mid-stream → interrupted row + Regenerate; nav-away mid-stream → preserved |
| UJ17 | n/a (presentational) | DB error → inline strip + Reload; ready/init unchanged |
| UJ18 | n/a (layout) | intake shows goal + 2 disclosures; profile pre-fills silently; edit pre-opens |
| UJ19 | n/a (selection DOM) | select → toolbar → "Branch from this" → constructor; right-click still works; long-press on touch |
| UJ20 | n/a (layout/wiring) | mobile Sheet titled; header generate-lab/quiz buttons with icon+plus + spinners |

## Suggested order of work

1. **UJ17** (DB badge — self-contained, smallest, user-trust fix).
2. **UJ20** (rail label + header hoist — mechanical, high discoverability win).
3. **UJ14a** (hljs theme — a CSS import + a comment fix; instant visible win, near-zero risk).
4. **UJ14b** (mermaid idle + placeholder — self-contained in `Markdown.svelte`).
5. **UJ18** (brief disclosure — self-contained in `BriefCard.svelte`).
6. **UJ19** (expound toolbar — self-contained in `Highlighter.svelte`).
7. **UJ13** (stream throttle — touches store + MessageList + page; do after UJ14 since both touch the render path and UJ14's mermaid guard depends on understanding the live bubble).
8. **UJ16** (interrupted-turn — touches the send finally + MessageRow + regenerate wiring; the most involved robustness item).
9. **UJ15** (lazy-mount — perf polish; do last, after the render path is stable from UJ13/UJ14).

## Needs sign-off

- None blocking. (All decisions resolved inline; the two `[!NOTE]`-driven items — mermaid placeholder animation, header icon+plus — follow the user's stated preferences exactly.)
