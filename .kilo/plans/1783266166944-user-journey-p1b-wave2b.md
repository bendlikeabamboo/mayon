# Plan — User-journey Wave 2b (P1 fixes: UJ13–UJ20)

Execution plan for `refinement/user-journey-p1b.md`. The design doc is
authoritative for **product decisions and task scope**; **this file is
authoritative for mechanism** — every `file:line` below was verified against the
live code on 2026-07-06 (after Wave 2a / `user-journey-p1a` landed), and the
spots where the code disagrees with the design doc — or where line numbers
drifted because p1a shipped — are corrected in **Verification corrections**
below.

Eight independent phases (`UJ13`…`UJ20`), shipped as one wave. Order at the end;
the only coupling is that **UJ13, UJ14b, and UJ15 all touch the
streaming/markdown render path** and are sequenced `UJ14b → UJ13 → UJ15` so each
lands on a stable base. No phase blocks another.

---

## Verification corrections (code-vs-doc; plan wins on mechanism)

1. **All `chat.svelte.ts` `send()` anchors drifted (p1a added `lastFailedPrompt`
   + retry cleanup to `finally`).** Verified current anchors: `streamBuffer`
   `$state` at `:72`; streaming begins at `:201`; `updateStreamBuffer` callback
   at `:238`; `runAgentTurn` destructure `{ aborted }` at `:227`; `catch` at
   `:313-321`; `finally` at `:322-349`; `this.streamBuffer = ''` at `:328`;
   `controller = null` at `:330`; `lastFailedPrompt` clear at `:348`.

2. **`MessageList.svelte` anchors drifted (p1a added `failedMessageId`).**
   Verified: `{#each visibleMessages}` at `:58`; `id="msg-{message.id}"` at
   `:59`; streaming block at `:71-95`; live `<Markdown>` at `:86`; `{:else}`
   "Thinking…" at `:87-92`; `isHidden` helper at `:41-49`; props at `:12-39`
   (now includes `failedMessageId?: string | null` at `:22,38`).

3. **`MessageRow.svelte` anchors drifted (p1a added `failed` red-border prop +
   "Branch from this message" rename).** Verified: `parseMetadata` at `:47-57`;
   assistant `<Highlighter><Markdown>` at `:116-123`; user `<Markdown>` at
   `:125`; failed-border class appended at `:110`; props at `:12-31`.

4. **`+page.svelte` (chat) anchors drifted significantly (p1a + earlier waves
   grew the file).** Verified current anchors:
   - Mobile `<SheetTitle>Navigation</SheetTitle>`: doc `:687` → **actual
     `:763`**.
   - Header button group (Tree + Mayon console): doc `:431-450` → **actual
     `:487-506`**.
   - `onGenerateLab`/`onGenerateQuiz`: doc `:343-353` → **actual `:390-400`**.
   - `<MessageList>` call: doc `:543` → **actual `:596-621`** (already passes
     `streamBuffer={chatStore.streamBuffer}` at `:599`, `failedMessageId` at
     `:605`).
   - Hash-scroll logic: doc `:226-261` → **actual `:258-293`**; retry loop at
     `:285-292` (assumes the target `#msg-{id}` row is eventually in the DOM —
     UJ15 must preserve this).
   - Lucide import block: `:5-14` (already has `ChevronDown`, `SquareTerminal`,
     `Network`, `PanelRight*`, `Sparkles`, `Target`, `GraduationCap`).

5. **`Markdown.svelte` anchors drifted (p1a/UJ9 added the copy-button pass to
   the enhance `$effect`).** Verified: mermaid `onMount` at `:26-53`; enhance
   `$effect` at `:55-95` (now: external-link pass `:58-72`, focusable `:73-76`,
   copy-button pass `:77-94`); `:global(.markdown-body pre)` rule at `:184-192`
   (already `position: relative` — UJ9 added it); `.md-copy-btn` CSS at
   `:249-271`.

6. **`render.test.ts:24-29` ALREADY asserts `class="hljs"` and `language-js`.**
   → UJ14a's "add an assertion that the output contains `class="hljs"`" is
   **already satisfied** — no new render-pipeline test is needed; UJ14a's only
   automated check is the existing test continuing to pass. The visual theme is
   a manual gate.

7. **No `Collapsible`/`Accordion` UI component exists** (glob
   `src/lib/components/ui/{collapsible,accordion}/**` → none). → UJ18 uses a
   **local `$state` toggle** (chevron + conditional render), not a shadcn
   component. No new dependency.

8. **The app's dark-mode mechanism is a `.dark` class** (`app.css:4`
   `@custom-variant dark (&:is(.dark *));`; `.dark { … }` block at `:123-155`).
   → UJ14a scopes the dark hljs theme under `.dark`, not `prefers-color-scheme`.

9. **`DbStatus` is rendered at THREE call sites with a `collapsed` prop**:
   `Sidebar.svelte:79` (expanded footer), `Sidebar.svelte:81` (`collapsed` — the
     `w-16` rail), and `AppShell.svelte:116` (mobile sheet footer, not
   collapsed). → UJ17's inline error strip renders **only when
   `!collapsed`**; in the collapsed rail the existing icon-only badge + `title`
   tooltip is kept (a `w-16` pane cannot fit a message + Reload button). The
   strip replaces the badge in both `Sidebar.svelte:79` and
   `AppShell.svelte:116` contexts.

10. **`repos.messages` has NO `update` method** (only `append`/`appendToolResult`/
    `listByChat`/`listUpToOrd`/`getById`/`delete`/`deleteByChat`). → **Per
    sign-off, UJ16 DELETES the interrupted row on regenerate** (reuses
    `repos.messages.delete`, mirroring UJ10's `deleteLastDanglingUser`), rather
    than hiding it via a new `updateMetadata` method. This **overrides the
    design doc's explicit "Decided: hide"** (doc `:198`, `:209`). No new repo
    method, no migration; the partial reply is removed when the user regenerates
    (the fresh full reply replaces it).

11. **Abort detection in `send()`'s `finally` (UJ16):** the doc's "hoist
    `let aborted = false`, set it from the `runAgentTurn` result" is
    **insufficient** — if `runAgentTurn` *throws* an `AbortError` (the common
    Stop-button path), the destructure at `:227` never completes, `aborted`
    stays `false`, and no interrupted row is ever persisted. → UJ16 detects
    abort from the controller signal **captured as the first line of `finally`**
    (before `controller = null` at `:330`): `const wasAborted =
    this.controller?.signal.aborted ?? false;`. Robust whether `runAgentTurn`
    resolves `{aborted:true}` or throws.

All other `file:line` citations in the design doc verified accurate (see
**Verified anchors** at the end).

---

## UJ17 — DB error badge → inline error strip + Reload *(do first: one component, smallest, user-trust fix)*

**Root cause (verified):** `DbStatus.svelte` renders the error message only in
the outer `div`'s `title` attribute (`:32`); the visible text is just
`"DB error"` (`statusLabel` `:13`). No inline message, no recovery affordance.
`dbStatus.error` (string | null) is already held at `db.svelte.ts:8`.

**Mechanism (decided):** when `status === 'error'` **and `!collapsed`**, render
an expanded inline strip (message + Reload) instead of the compact badge. In
collapsed mode, keep the existing icon-only badge + `title` (a `w-16` rail can't
fit it). `initializing`/`ready` are unchanged.

**Tasks** — `src/lib/components/DbStatus.svelte`
- Wrap the current return in an `{#if dbStatus.status === 'error' && !collapsed}`
  branch that renders the inline strip:
  ```svelte
  <div class="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs">
    <div class="flex items-center gap-1.5 font-medium text-red-700 dark:text-red-400">
      <AlertCircle class="size-3.5 shrink-0" /> Database error
    </div>
    <p class="mt-1 text-red-700/90 dark:text-red-400/90">
      {dbStatus.error ?? 'Unknown error'}
    </p>
    <Button variant="outline" size="sm" class="mt-2" onclick={() => location.reload()}>
      Reload
    </Button>
  </div>
  ```
- `{:else}` keeps the existing compact badge markup verbatim (`:32-43`).
- Add imports: `Button` from `$lib/components/ui/button/index.js`. `AlertCircle`
  is already imported (`:2`).
- The strip is auto-width within the sidebar footer (`Sidebar.svelte:69-83`
  footer is a flex column; the strip sits where the badge was).

**Tests:** none automated (presentational; `dbStatus` state machine is already
exercised by the boot path).

**Manual gate:** force a DB error (point OPFS at an unwritable path, or simulate
in dev) → expanded sidebar shows the inline strip with the real message + Reload
→ click → app reboots. `ready`/`initializing`: footer unchanged (compact badge).
Collapsed rail (`w-16`): icon-only red badge + tooltip (no strip).

### UJ17 — decisions
- **RESOLVED:** inline strip + Reload only on `error && !collapsed`; collapsed
  keeps icon badge. No migration-rollback work (out of audit scope; Reload lets
  the user retry after an external fix).

---

## UJ20 — ChatRail labeling + hoist generate-lab/quiz *(mechanical; high discoverability win)*

### UJ20a — Mobile Sheet title
- `src/routes/chat/[id]/+page.svelte:763`:
  `<SheetTitle>Navigation</SheetTitle>` →
  `<SheetTitle>Branches · Labs · Quizzes</SheetTitle>`.

### UJ20b — Header generate-lab / generate-quiz buttons
- `src/routes/chat/[id]/+page.svelte`
  - Import (`:5-14`): add `FlaskConical`, `ListChecks`, `Plus` (none are
    currently imported in this file).
  - Header button group (`:487-506`, inside the `flex shrink-0 items-center
    gap-1` div, alongside Tree + Mayon console): add two buttons, each
    icon+plus-composed per the user's `[!NOTE]`, wired to the existing
    `onGenerateLab`/`onGenerateQuiz` (`:390-400`), each `disabled` while either
    is generating (reuse the UJ4 split: `labsStore.generating ||
    quizzesStore.generating`), each showing its own inline `LoaderCircle`
    spinner when its flag is true:
    ```svelte
    <Button variant="ghost" size="sm" class="shrink-0"
      title="Generate lab" aria-label="Generate lab"
      onclick={onGenerateLab}
      disabled={labsStore.generating || quizzesStore.generating}>
      {#if labsStore.generating}
        <LoaderCircle class="size-4 animate-spin" />
      {:else}
        <span class="relative inline-flex">
          <FlaskConical class="size-4" />
          <Plus class="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-background" />
        </span>
      {/if}
    </Button>
    ```
    Symmetric for quiz with `ListChecks`, `onGenerateQuiz`,
    `quizzesStore.generating`. Add `LoaderCircle` to the import too.
- `ChatRail.svelte` — **unchanged** (keeps its own generate buttons for the rail
  context).

**Tests:** none automated (layout/wiring; generate flow covered by stores).

**Manual gate:** mobile Sheet header reads "Branches · Labs · Quizzes". Desktop
+ mobile: header has generate-lab / generate-quiz (icon+plus); click generate-lab
→ that button spins, the other is disabled (UJ4 split), navigates to `/lab/[id]`
on success. Rail buttons still work independently.

### UJ20 — decisions
- **RESOLVED (a):** Sheet title → "Branches · Labs · Quizzes".
- **RESOLVED (b):** header buttons with icon+plus composition, reusing UJ4's
  split generate state; rail buttons retained.

---

## UJ14a — highlight.js theme CSS *(instant visible win; near-zero risk)*

**Root cause (verified):** the pipeline uses `rehype-highlight` (highlight.js,
`render.ts:24,71`), which emits `<code class="hljs language-xxx">` +
`<span class="hljs-keyword">` etc.; the sanitizer passes them through
(`render.ts:45-49`). **But no hljs theme CSS is imported** — `app.css:2`
imports KaTeX only. The highlighting is computed; it just has no color. The
comment in `LabRunner.svelte:54` ("KaTeX / Shiki / GFM") is stale (it was never
Shiki). `highlight.js ^11.11.1` is already a dep.

**Mechanism (decided):** import both `github` (light) and `github-dark` themes
and scope the dark one under `.dark` (correction #8). highlight.js's theme CSS
targets `.hljs` directly; both themes define the same selectors, so the dark
rules must win only in dark mode.

**Tasks**
1. `src/app.css` — after the KaTeX import (`:2`):
   ```css
   @import 'highlight.js/styles/github.min.css';
   @import 'highlight.js/styles/github-dark.min.css';
   ```
   The dark theme targets `.hljs` unconditionally, so it would override light
   in both modes. To scope it to dark mode only, **do not import
   `github-dark.min.css` directly**; instead, since both files set colors on
   bare `.hljs`, the simplest robust approach given Tailwind v4 CSS-first is:
   import `github.min.css` (light, applies everywhere), then import
   `github-dark.min.css` **wrapped**: hljs dark CSS is a flat block, so copy its
   effective rules under `.dark .hljs`. **Decided (lower-maintenance):** import
   only `github.min.css`, then add a small `@layer` override block that, under
   `.dark`, reapplies the github-dark palette by re-importing scoped — but CSS
   `@import` cannot be scoped. **Final decision:** import `github.min.css` for
   light; for dark, write a compact `.dark .hljs { … }` + `.dark .hljs-keyword
   {…}` … block **inline in `app.css`** using the github-dark color values
   (mirroring `highlight.js/styles/github-dark.css`). This avoids the
   un-scopable-import problem and keeps both palettes maintained in one file.
   Keep the override minimal (the ~10 most common token classes: `.hljs`,
   `.hljs-keyword`, `.hljs-string`, `.hljs-comment`, `.hljs-number`,
   `.hljs-title/function`, `.hljs-attr`, `.hljs-built_in`, `.hljs-type`,
   `.hljs-meta`).
2. `src/lib/components/labs/LabRunner.svelte:54` — comment fix:
   `KaTeX / Shiki / GFM` → `KaTeX / highlight.js / GFM`.

**Tests:** none new — `render.test.ts:24-29` already asserts `class="hljs"`
(correction #6). Visual theme = manual gate.

**Manual gate:** a reply with fenced code (JS/Python/etc.) → syntax colors
appear (light palette in light mode). Toggle theme → colors swap to the dark
palette. A code block with no language stays unstyled (unchanged).

### UJ14a — decisions
- **RESOLVED:** light theme via `@import 'highlight.js/styles/github.min.css'`;
  dark theme via an inline `.dark .hljs {…}` override block in `app.css`
  (un-scopable-import workaround), not a bare `@import` of `github-dark`.
  `LabRunner.svelte:54` comment fixed.

---

## UJ14b — Defer Mermaid + "Generating Diagram…" placeholder *(self-contained in `Markdown.svelte`)*

**Root cause (verified):** `Markdown.svelte:26-53` renders each
`code.language-mermaid` block eagerly in `onMount`, with a flash of raw fenced
code before the async SVG swap and no loading indicator.

**Mechanism (decided, per the audit `[!NOTE]`):**
- For each mermaid block: immediately replace its `<pre>` with a
  `mermaid-pending` placeholder (the `|/−` rotating-bar spinner + "Generating
  Diagram…"), killing the raw-code flash instantly.
- Schedule the actual `renderMermaidBlock(source)` via `requestIdleCallback`
  (fallback `setTimeout(…, 0)` where rIC is unavailable). On resolve, swap the
  placeholder for the SVG wrapper (existing `:37-44` logic); on reject, swap for
  the error note (existing `:46-51`).
- **Skip mermaid rendering in the live streaming bubble** (correction: the live
  bubble is a *separate* `<Markdown>` instance in `MessageList.svelte:86`; its
  `onMount` runs once per instance, but rendering incomplete mermaid mid-stream
  is wasteful and the source is partial). Add a `live?: boolean` prop to
  `Markdown.svelte` (default `false`); when `live`, the mermaid `onMount` is a
  no-op (the fenced code renders as a plain code block until the persisted row
  takes over). `MessageList.svelte:86` passes `live={true}`; persisted
  `MessageRow` `<Markdown>` calls (`:122`, `:125`) pass nothing (default false).
  This composes cleanly with UJ13 (the live bubble binds the throttled render
  copy) and UJ15 (LazyMount wraps the persisted rows).

**Tasks** — `src/lib/components/chat/Markdown.svelte`
- Props (`:16`): add `live = false` →
  `let { raw, class: className = '', live = false }`.
- Rewrite the mermaid `onMount` (`:26-53`):
  - Early-return if `live` (no mermaid post-processing on the streaming bubble).
  - For each `code.language-mermaid`: create the `mermaid-pending` placeholder
    `<div>` (spinner + text) and `pre.replaceWith(placeholder)` immediately.
    Schedule via `(window.requestIdleCallback ?? ((cb) => setTimeout(() =>
    cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0)))`
    the existing `renderMermaidBlock(source)` → on resolve, `placeholder
    .replaceWith(wrapper)` (the existing SVG-wrapper logic); on reject,
    `placeholder.replaceWith(note)` (the existing error-note logic).
- Add the `|/−` rotating-bar spinner inline (CSS keyframe in the existing
  `<style>`): a 1ch-wide bar rotating on its center, ~0.8s linear infinite.
  Reuse `Spinner`? No — `Spinner.svelte` has no `bar` variant and its glyphs
  are fixed-size (p0 plan, correction #3, established the "don't extend Spinner"
  precedent); inline the bar animation here.
- `MessageList.svelte:86`: `<Markdown raw={stripGateFence(streamBuffer)} />` →
  add `live={true}`. (When UJ13 lands, this becomes `raw={stripGateFence
  (streamBufferRender)}` and keeps `live={true}`.)
- `MessageRow.svelte:122` and `:125`: no change (default `live=false`).

**Tests:** none automated (DOM/animation; `hasMermaid`/`renderMermaidBlock` in
`mermaid.ts` already unit-tested). This phase changes only *when* they're
called.

**Manual gate:** a reply with a mermaid block → "Generating Diagram…" with the
`|/−` spinner shows instantly (no raw-code flash), then the SVG swaps in when
idle. Multiple diagrams don't jank. A *streaming* reply with an in-progress
mermaid block shows the fenced code as a plain block (no SVG, no spinner) until
the persisted row renders it.

### UJ14b — decisions
- **RESOLVED:** defer mermaid to `requestIdleCallback`; `|/−` placeholder;
  `live` prop skips mermaid in the streaming bubble; persisted rows render full
  mermaid. No `Spinner` change (inline bar animation).

---

## UJ18 — Brief intake progressive disclosure *(self-contained in `BriefCard.svelte`)*

**Root cause (verified):** `BriefCard.svelte:124-250` renders all seven fields
at once with equal weight (goal at `:152-164`, level/mode at `:167-184`,
structure at `:187-199`, persona at `:202-209`, context/scope at `:212-235`).

**Mechanism (decided):** progressive disclosure. Goal full-width and prominent;
level/mode/structure/persona behind a "Calibration" disclosure; context/scope
behind an "Advanced" disclosure. Profile pre-fill (`:74-89`) still applies
silently. In edit mode, pre-open a disclosure if any of its fields are
non-default (so the user isn't surprised by hidden edits). No shadcn collapsible
exists (correction #7) → local `$state` toggle + chevron.

**Tasks** — `src/lib/components/chat/BriefCard.svelte`
- Add two toggles, seeded via `untrack` from the `brief` prop (mirroring the
  existing seed pattern at `:56-64`):
  ```ts
  let calibrationOpen = $state(untrack(() => isEdit && hasNonDefaultCalibration(brief)));
  let advancedOpen = $state(untrack(() => isEdit && (brief?.context?.trim() || brief?.scope?.trim())));
  ```
  where `hasNonDefaultCalibration(b)` returns true if any of `b.level !==
  DEFAULT_LEVEL`, `b.mode !== DEFAULT_MODE`, `b.scopeStrategy !==
  defaultStrategyFor(b.mode ?? DEFAULT_MODE)`, or `b.persona !== DEFAULT_PERSONA`.
  (These constants are already imported `:7-20`.)
- Restructure the form body (`:151-235`):
  1. **Goal** (`:152-164`) — unchanged, prominent.
  2. **Calibration disclosure** — a header row (chevron `ChevronDown` rotating
     on `calibrationOpen` + the label "Calibration") that toggles
     `calibrationOpen`; when open, render the level/mode grid (`:167-184`),
     structure (`:187-199`), persona (`:202-209`). Add a one-line plain-language
     hint under mode if none exists (structure already has one at `:194-198`).
  3. **Advanced disclosure** — same pattern, label "Advanced"; when open, render
     context/scope (`:212-235`).
- The submit/skip actions (`:237-249`) stay at the bottom (unchanged).
- `buildBrief` (`:97-105`) and the profile-apply `onMount` (`:74-89`) are
  unchanged — they read the same `$state` fields regardless of disclosure state.

**Tests:** none automated (layout; `buildBrief`/`applyProfile` unchanged).

**Manual gate:** new chat → intake shows Goal + two collapsed disclosures +
actions. Open Calibration → level/mode/structure/persona (pre-filled by
profile). Open Advanced → context/scope. Submit with only goal → works. Edit an
existing brief with a non-default persona → Calibration auto-opens; with
non-empty context → Advanced auto-opens; with all defaults → both collapsed.

### UJ18 — decisions
- **RESOLVED:** two local-toggle disclosures (Calibration, Advanced); silent
  profile pre-fill; edit mode pre-opens non-default sections; no new dependency.

---

## UJ19 — Expound selection toolbar *(self-contained in `Highlighter.svelte`)*

**Root cause (verified):** the only entry to Expound is the right-click context
menu (`Highlighter.svelte:112-119` → `ContextMenu`); no mouse-up toolbar, no
touch/long-press equivalent.

**Mechanism (decided):** a floating selection toolbar on mouse-up / long-press
with a "Branch from this" button (label consistent with UJ8's "Branch from this
text"). The toolbar reuses the existing `captureSelection()` (`:87-110`) and
opens the existing `ExpoundPromptConstructor` (the same path as `handleExpound`
`:135-143`). Right-click menu is kept as a secondary path; the two never show
simultaneously (on `contextmenu`, clear the toolbar).

**Tasks** — `src/lib/components/chat/Highlighter.svelte`
- Add `let selectionToolbar = $state<{ x: number; y: number; sel: SelectionInput } | null>(null);`
  alongside the existing `menu`/`constructorState` (`:45-51`).
- Add a `mouseup` listener on `container` (and a `selectionchange` fallback):
  when `captureSelection()` returns a non-null selection fully inside the
  container, set `selectionToolbar` to the selection's bounding rect
  (`sel.getRangeAt(0).getBoundingClientRect()`), positioned above the selection
  (clamp to viewport). Clear when the selection collapses or on scroll
  (`svelte:window onscroll` → `selectionToolbar = null`).
- Touch: a `touchstart`→`touchend` timer (≥500ms); if a selection exists on
  `touchend`, show the same toolbar.
- Render the toolbar (inline markup — small enough not to extract) when
  `selectionToolbar` is set: a pill positioned `fixed` at `(x, y)` with a
  "Branch from this" button. Clicking it calls the same path as `handleExpound`:
  ```ts
  function handleToolbarExpound() {
    if (!selectionToolbar) return;
    const { x, y, sel } = selectionToolbar;
    selectionToolbar = null;
    window.getSelection()?.removeAllRanges();
    constructorState = { sel, x, y };
  }
  ```
- `onContextMenu` (`:112-119`): add `selectionToolbar = null;` (the menu
  supersedes the toolbar; they never coexist).
- `handleExpound`/`handleCopy`/`closeMenu`/`cancelConstructor`: also clear
  `selectionToolbar` for safety.

**Tests:** none automated (selection/DOM; `captureSelection`/
`resolveSelectionOffsets` pure helpers already unit-tested).

**Manual gate:** select text in an assistant reply → toolbar appears above the
selection with "Branch from this" → click → `ExpoundPromptConstructor` opens
(same as right-click). Right-click while a selection exists → toolbar hides,
menu shows. Touch (mobile devtools): long-press → selection + toolbar.

### UJ19 — decisions
- **RESOLVED:** floating toolbar on mouse-up/long-press reusing
  `captureSelection` + the existing constructor flow; right-click menu kept;
  the two never coexist.

---

## UJ13 — Throttle streaming markdown render *(touches store + MessageList + page; do after UJ14b)*

**Root cause (verified):** `MessageList.svelte:86` binds
`<Markdown raw={stripGateFence(streamBuffer)} />`; `chat.svelte.ts:238`
`updateStreamBuffer: (n) => (this.streamBuffer = n)` is a direct `$state`
assignment per delta. The unified markdown pipeline runs synchronously on every
token.

**Mechanism (decided):** coalesce `streamBuffer` updates onto a
`requestAnimationFrame` cadence. The store keeps receiving deltas fast (the
agent loop calls `updateStreamBuffer` per chunk unchanged), but the *rendered*
value the UI binds to — `streamBufferRender` — is updated at most once per frame
by a self-scheduling rAF loop. On stream end, one final synchronous flush. A
single source of truth (`streamBufferRender`), no debounce timer.

**Tasks**
1. `src/lib/stores/chat.svelte.ts`
   - Add `streamBufferRender = $state('');` alongside `streamBuffer` (`:72`).
   - Add a private rAF handle + scheduler:
     ```ts
     private rafId: number | null = null;
     private startRenderFlush() {
       const tick = () => {
         this.streamBufferRender = this.streamBuffer;
         if (this.streaming) this.rafId = requestAnimationFrame(tick);
         else this.rafId = null;
       };
       this.rafId = requestAnimationFrame(tick);
     }
     ```
   - In `send()`, immediately after `this.streaming = true` (`:201`): call
     `this.startRenderFlush()`.
   - In `finally` (`:322-349`), **before** `this.streamBuffer = ''` (`:328`):
     - `if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }`
     - `this.streamBufferRender = this.streamBuffer;` // final exact frame
   - `updateStreamBuffer` (`:238`) is **unchanged** — it writes `streamBuffer`;
     only the rAF loop promotes to `streamBufferRender`.
   - Mirror every `streamBuffer = ''` reset with `streamBufferRender = ''`:
     `send()` start (`:202`), `finally` (after the flush), `load()` (`:119`),
     `clearActiveView()` (`:374`).
   - Update `showLiveBubble` (`:101-103`) to key off `streamBufferRender`:
     `return this.streaming && this.streamBufferRender.length > 0;` (so the
     bubble shows once the first frame has flushed — before that, "Thinking…"
     is correct).
2. `src/lib/components/chat/MessageList.svelte`
   - Props (`:15`): the `streamBuffer` prop already exists; **repurpose it as
     the render copy** — the page will pass `chatStore.streamBufferRender` into
     it. No new prop name needed (keeps the component's public API stable).
     Update the streaming-block guard (`:76`) and the `<Markdown>` bind (`:86`)
     to use `streamBuffer` as today (they already do — the value they receive is
     now the throttled copy). Also keep the UJ14b `live={true}` on that
     `<Markdown>`.
3. `src/routes/chat/[id]/+page.svelte`
   - `<MessageList>` call (`:599`): `streamBuffer={chatStore.streamBuffer}` →
     `streamBuffer={chatStore.streamBufferRender}`.

**Tests** (`pnpm test`, extend `chat.svelte.test.ts` with `vi.useFakeTimers` +
a fake rAF)
- Rapid `updateStreamBuffer` calls during a mocked stream → `streamBufferRender`
  is updated at most once per frame and, after the `finally` flush, equals the
  final `streamBuffer`.
- The raw `streamBuffer` still holds every intermediate value (persistence is
  unaffected — it reads from `appendAssistantText`, not the render copy).

**Manual gate:** stream a long, markdown-heavy reply (tables, KaTeX, multiple
code blocks) → UI stays responsive (no main-thread freeze); formatting appears
progressively; the final rendered persisted message matches a non-streamed
render of the same content (no truncation from a dropped last frame).

### UJ13 — decisions
- **RESOLVED:** rAF-throttle via a `streamBufferRender` copy; self-scheduling
  rAF started on stream begin, cancelled + final-flushed in `finally`;
  `showLiveBubble` keys off the render copy; raw `streamBuffer` unchanged for
  persistence.

---

## UJ16 — Interrupted-turn marker *(store + MessageRow + regenerate wiring; do after UJ13)*

**Root cause (verified):** on abort/navigation mid-stream, `send()`'s `finally`
(`:322-349`) clears `streamBuffer` (`:328`) without persisting it. The user row
is already persisted (`:194`); the partial assistant reply is silently lost.

**Mechanism (decided — audit's "lighter fix", + correction #10/#11):** on abort
**with non-empty buffer**, persist the partial buffer as an assistant row
marked `metadata: { interrupted: true }`, rendered with a "Regenerate"
affordance. Regenerate **deletes** the interrupted row (per sign-off) and
re-sends the last user prompt. Abort is detected from the controller signal
captured at the top of `finally` (robust to both resolve-with-aborted and
throw-AbortError). Hard tab-close mid-stream is still accepted (the `finally`
may not run on unload) — matching the existing, now-narrowed, contract.

**Tasks**
1. `src/lib/stores/chat.svelte.ts` — in `send()`'s `finally` (`:322-349`),
   **before** `this.streamBuffer = ''` (`:328`):
   ```ts
   const wasAborted = this.controller?.signal.aborted ?? false; // capture before :330 nulls it
   if (wasAborted && this.streamBuffer.trim()) {
     try {
       const row = await repos.messages.append(chatId, 'assistant', this.streamBuffer, {
         metadata: JSON.stringify({ interrupted: true })
       });
       this.messages = [...this.messages, row];
     } catch { /* best-effort */ }
   }
   ```
   (Must run before the buffer is cleared. `this.controller` is still non-null
   here — it's nulled at `:330`, after.) On a normal completion `wasAborted` is
   false → no row. On abort with empty buffer → no row (don't litter).
2. `src/lib/components/chat/MessageRow.svelte`
   - `parseMetadata` (`:47-57`): widen the return type to include
     `interrupted?: boolean` (currently `{ artifact?; reasoning? }`).
   - Add `let interrupted = $derived(parsedMeta?.interrupted === true);` near
     `:66-70`.
   - In the assistant branch (inside the bubble div, after the `<Highlighter>`
     block at `:116-123`), when `interrupted`, render a subtle footer:
     ```svelte
     {#if interrupted}
       <div class="mt-2 flex items-center gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
         This reply was interrupted.
         <Button variant="outline" size="sm" class="h-6 px-2"
           onclick={() => void onRegenerate(message.id)}>Regenerate</Button>
       </div>
     {/if}
     ```
   - Add `onRegenerate` to the props (`:12-31`): an optional
     `(messageId: string) => void | Promise<void>`.
3. `src/lib/components/chat/MessageList.svelte` — thread `onRegenerate` through
   props (`:12-39`) to `<MessageRow>` (`:60-67`).
4. `src/routes/chat/[id]/+page.svelte`
   - Pass `onRegenerate` to `<MessageList>` (`:596-621`).
   - Implement it: find the interrupted message's **preceding user message**
     (walk back from the interrupted row), delete the interrupted row
     (`repos.messages.delete`), update `chatStore.messages`, then
     `chatStore.send(userText)`:
     ```ts
     async function onRegenerate(interruptedId: string) {
       const msgs = chatStore.messages;
       const idx = msgs.findIndex((m) => m.id === interruptedId);
       if (idx < 0) return;
       let userText = '';
       for (let i = idx - 1; i >= 0; i--) {
         if (msgs[i].role === 'user') { userText = msgs[i].content; break; }
       }
       await repos.messages.delete(interruptedId);
       chatStore.messages = chatStore.messages.filter((m) => m.id !== interruptedId);
       if (userText) void chatStore.send(userText);
     }
     ```

**Tests** (`pnpm test`, in-memory driver)
- A `send` aborted after buffer accumulates → an assistant row with
  `metadata.interrupted === true` is appended; the buffer text is preserved in
  it. A normal-completion `send` → no interrupted row. An aborted `send` with an
  empty buffer → no interrupted row.
- (`onRegenerate` logic is route-level; covered by the manual gate. The store
  contract — append-on-abort-with-buffer — is the unit.)

**Manual gate:** start a stream → Stop mid-stream → an interrupted assistant
row appears with the partial text + "Regenerate". Click Regenerate → the
interrupted row is removed, the last user prompt re-sends, a fresh reply
streams. Navigate from chat A (mid-stream) to chat B → A's partial reply is
saved as interrupted; return to A → see it with the affordance.

### UJ16 — decisions
- **RESOLVED (overrides doc):** persist partial buffer as `metadata.interrupted`
  on abort-with-non-empty-buffer; **DELETE** (not hide) the interrupted row on
  Regenerate (per sign-off; reuses `repos.messages.delete`, no new repo method).
  Abort detected from the controller signal at the top of `finally`.

---

## UJ15 — Lazy-mount heavy children *(perf polish; do last, after the render path is stable)*

**Root cause (verified):** `MessageList.svelte:58` flat-renders every row;
each row's `<Markdown>` (`MessageRow.svelte:122,125`) runs the full pipeline
(parse + KaTeX + highlight +, for persisted rows, mermaid) eagerly. The cost is
the heavy children, not the row shells.

**Mechanism (decided — option 2):** lazy-mount the expensive `<Markdown>`
children via `IntersectionObserver`, so off-screen rows skip the pipeline until
they scroll near. Full row windowing (option 1) is deferred — it would break the
`#msg-{id}` anchors and the hash-scroll retry loop (`+page.svelte:285-292`).
Row shells (avatar, label, branch button) always render cheaply.

**Tasks**
1. `src/lib/components/chat/LazyMount.svelte` **(new)** — tiny wrapper:
   ```svelte
   <script lang="ts">
     import { onMount, type Snippet } from 'svelte';
     let { children, rootMargin = '400px' }: { children: Snippet; rootMargin?: string } = $props();
     let el = $state<HTMLDivElement | null>(null);
     let visible = $state(false);
     onMount(() => {
       if (!el) return;
       const io = new IntersectionObserver((entries) => {
         if (entries.some((e) => e.isIntersecting)) { visible = true; io.disconnect(); }
       }, { rootMargin });
       io.observe(el);
       return () => io.disconnect();
     });
   </script>
   <div bind:this={el}>{#if visible}{@render children()}{/if}</div>
   ```
   (jsdom in Vitest lacks `IntersectionObserver` — gate the test behind a
   polyfill or skip; manual gate covers it.)
2. `src/lib/components/chat/MessageRow.svelte`
   - Import `LazyMount`.
   - Wrap both `<Markdown>` renders in `<LazyMount>`:
     - assistant: `<Highlighter …><LazyMount><Markdown raw={visible} live={false}/></LazyMount></Highlighter>`
       (`:116-123`) — **note:** `Highlighter` needs the raw text for
       selection/underlines regardless of mount, so `LazyMount` wraps only the
       `<Markdown>` *inside* `Highlighter`, not `Highlighter` itself. (UJ14b
       default `live={false}` is fine here; make it explicit for clarity.)
     - user: `<LazyMount><Markdown raw={message.content} /></LazyMount>`
       (`:125`).
   - The row shell (branch button, label, bubble border, `id="msg-{message.id}"`
     on the outer `MessageList` div at `:59`) is unchanged → anchors + hash-scroll
     survive.

**Tests:** `LazyMount` component test deferred to manual (IO in jsdom). The
hash-scroll retry loop (`+page.svelte:285-292`) is unchanged and still finds the
row shell immediately.

**Manual gate:** open a chat with 100+ messages → scroll is smooth; off-screen
rows don't run mermaid/KaTeX (DevTools: count `<svg class="mermaid">` — only
near-viewport ones). Deep-link `/chat/[id]?…#m=<early-id>` still scrolls and
flashes the right row (the shell is in the DOM; the markdown mounts as it
scrolls into view).

### UJ15 — decisions
- **RESOLVED:** lazy-mount heavy `<Markdown>` children via `IntersectionObserver`
  (option 2), not full row windowing, to preserve `#msg-{id}` anchors. Revisit
  full virtualization only if profiling demands it.

---

## Verification gates (per phase)

| Phase | Automated (`pnpm test`, in-memory) | Manual (OPFS + Tauri) |
|-------|------------------------------------|------------------------|
| UJ17 | n/a (presentational) | DB error → inline strip + Reload (expanded); icon badge (collapsed) |
| UJ20 | n/a (layout/wiring) | mobile Sheet titled; header generate-lab/quiz icon+plus + per-button spinners |
| UJ14a | existing `class="hljs"` test (no new test) | code blocks colored; theme swap on toggle |
| UJ14b | n/a (DOM/animation) | mermaid placeholder `|/−` then SVG, no flash; streaming bubble skips mermaid |
| UJ18 | n/a (layout) | intake = goal + 2 disclosures; profile pre-fills; edit pre-opens non-default |
| UJ19 | n/a (selection DOM) | select → toolbar → "Branch from this" → constructor; right-click still works; long-press on touch |
| UJ13 | rAF throttle: render copy ≤ once/frame, final flush exact | heavy markdown stream responsive; final render matches |
| UJ16 | interrupted row on abort-with-buffer; none on normal/empty-abort | Stop → interrupted row + Regenerate (deletes + re-sends); nav-away preserved |
| UJ15 | (defer to manual) LazyMount IO | 100+ msg chat scrolls smoothly; deep-link anchor still works |

**Every phase:** `pnpm lint && pnpm check` clean before done.

---

## Suggested order of work

1. **UJ17** (DB badge — one component, smallest, user-trust fix).
2. **UJ20** (rail label + header hoist — mechanical, high discoverability).
3. **UJ14a** (hljs theme — CSS + one comment; instant visible win, near-zero risk).
4. **UJ14b** (mermaid idle + placeholder + `live` prop — self-contained in `Markdown.svelte`; lands the `live` prop UJ13 builds on).
5. **UJ18** (brief disclosure — self-contained in `BriefCard.svelte`).
6. **UJ19** (expound toolbar — self-contained in `Highlighter.svelte`).
7. **UJ13** (stream throttle — store + MessageList + page; after UJ14b since both touch the live `<Markdown>` and UJ14b's `live` prop + UJ13's render copy compose).
8. **UJ16** (interrupted turn — store `finally` + MessageRow + regenerate wiring; after UJ13 so the render path is stable).
9. **UJ15** (lazy-mount — perf polish; last, after the render path is stable from UJ13/UJ14).

---

## Risks / edge cases

- **UJ13 rAF + persisted message:** the persisted assistant message comes from
  `appendAssistantText` during the stream, NOT from `streamBuffer`. Clearing
  `streamBufferRender` never loses the persisted row. The final flush is
  cosmetic (prevents a one-frame stale bubble before the persisted row renders).
- **UJ13 ordering in `finally`:** the final flush and `cancelAnimationFrame`
  must run **before** `this.streamBuffer = ''` (`:328`) and before
  `this.controller = null` (`:330`). Capturing `wasAborted` (UJ16) is also before
  `:330`. Both UJ13 and UJ16 insert into the same `finally` head — implement
  UJ13 first (it cancels the rAF + flushes), then UJ16 (reads `wasAborted` +
  persists), both before the existing buffer/controller clears.
- **UJ14a dark-theme scoping:** a bare `@import` of `github-dark.min.css` would
  override light in both modes (CSS `@import` can't be scoped). Use an inline
  `.dark .hljs {…}` override block instead.
- **UJ14b `live` prop + UJ13 + UJ15 composition:** the streaming bubble's
  `<Markdown live={true}>` skips mermaid; the persisted `MessageRow` `<Markdown>`
  (`live={false}`) renders mermaid and is itself wrapped by `LazyMount`. Three
  independent insertion points; verified non-conflicting.
- **UJ16 abort detection:** `runAgentTurn` may *resolve* `{aborted:true}` OR
  *throw* `AbortError`. Reading `this.controller.signal.aborted` at the top of
  `finally` (before `:330`) is robust to both. On a thrown non-abort error,
  `signal.aborted` is false → no interrupted row (the error-card + retry path
  from UJ10 handles that case).
- **UJ16 Regenerate preceding-user search:** walks back from the interrupted
  row to the nearest `user` message. If none exists (interrupted row is the
  first message — impossible in practice, since a user row always precedes an
  assistant stream), `userText` stays empty and no re-send happens (safe
  no-op; the interrupted row is still deleted).
- **UJ15 IO in jsdom:** `IntersectionObserver` is unavailable in the Vitest
  environment; the `LazyMount` test is deferred to the manual gate. The
  hash-scroll retry loop still works because the row shell (not the lazy
  markdown) carries `id="msg-{id}"`.
- **UJ17 collapsed rail:** the inline strip needs horizontal space; in the
  `w-16` collapsed rail it would overflow. Gated on `!collapsed`; the collapsed
  rail keeps the icon-only badge + `title` tooltip.

---

## Verified anchors (line refs confirmed 2026-07-06, post-p1a)

- `chat.svelte.ts`: `streamBuffer` `:72`; `showLiveBubble` `:101-103`; `send`
  `:169-350` (`streaming=true` `:201`, `streamBuffer=''` `:202`, controller new
  `:204`, `updateStreamBuffer` `:238`, `runAgentTurn` destructure `:227`, catch
  `:313-321`, finally `:322-349` with `streamBuffer=''` `:328`, `controller=null`
  `:330`, `lastFailedPrompt=null` `:348`); `load` `:109-140` (`streamBuffer=''`
  `:119`); `clearActiveView` `:363-377` (`streamBuffer=''` `:374`).
- `MessageList.svelte`: props `:12-39` (`failedMessageId` `:22,38`); `isHidden`
  `:41-49`; `visibleMessages` `:51`; `{#each}` `:58`; `id="msg-{message.id}"`
  `:59`; streaming block `:71-95` (Spinner/persona `:73-80`, reasoning `:81-83`,
  bubble `:84-93`, `<Markdown raw={stripGateFence(streamBuffer)}>` `:86`,
  Thinking… `:87-92`).
- `MessageRow.svelte`: props `:12-31` (`failed` `:18,30`); `parseMetadata`
  `:47-57`; `parsedMeta`/`artifact`/`reasoning` `:66-70`; failed-border class
  `:110`; assistant `<Highlighter><Markdown>` `:116-123`; user `<Markdown>`
  `:125`; Branch button (renamed) `:89-97`.
- `Markdown.svelte`: props `:16`; `html`/`needsMermaid` `:18-19`; mermaid
  `onMount` `:26-53`; enhance `$effect` `:55-95` (links `:58-72`, focusable
  `:73-76`, copy pass `:77-94`); `<pre>` rule `:184-192` (already
  `position:relative`); `.md-copy-btn` `:249-271`.
- `render.ts`: imports `:18-28` (`rehypeHighlight` `:24`); `sanitizeSchema`
  `:41-63` (code/span classes `:45-54`); processor `:65-74` (`rehypeHighlight`
  `:71`); `renderMarkdown` `:80-82`.
- `render.test.ts:24-29` already asserts `class="hljs"` + `language-js`.
- `mermaid.ts`: `hasMermaid` `:27-29`; `renderMermaidBlock` `:55-59`.
- `app.css`: KaTeX import `:2`; `@custom-variant dark` `:4`; `:root` `:88-121`;
  `.dark` `:123-155`.
- `BriefCard.svelte`: props `:38-50`; seed `untrack` `:56-64`; `modeStrategies`
  `:66`; `canSubmit` `:91`; `buildBrief` `:97-105`; profile `onMount` `:74-89`;
  form body `:124-250` (goal `:152-164`, level/mode `:167-184`, structure
  `:187-199`, persona `:202-209`, context/scope `:212-235`, actions `:237-249`).
- `Highlighter.svelte`: props `:23-39`; `container` `:41`; `pendingSel`/`menu`/
  `constructorState` `:45-51`; `existingSpans` `:54`; `captureSelection`
  `:87-110`; `onContextMenu` `:112-119`; `handleExpound` `:135-143`; underline
  render `:253-313` + `$effect` `:317-325`; template `:328-374`.
- `DbStatus.svelte`: imports `:2`; `collapsed` prop `:6`; `statusLabel` `:8-14`;
  `badgeClass` `:16-29`; root `<div title=…>` `:32`; badge markup `:33-43`.
- `Sidebar.svelte`: footer `:69-83` (`ThemeToggle` `:74`, runtime label `:76`,
  `<DbStatus />` `:79`, `<DbStatus collapsed />` `:81`).
- `AppShell.svelte:116`: `<DbStatus />` (mobile sheet footer, not collapsed).
- `db.svelte.ts`: `DbStatusValue`/`DbRuntime`/`SelfCheckValue` `:1-3`;
  `status`/`runtime`/`error`/`selfCheck` `:6-9`; `markReady`/`markError`
  `:11-19`.
- `+page.svelte` (chat): imports `:1-47`; `composerPrompt`/`draftTimer`
  `:82-83`; scroll `$effect`s `:100-147`; draft `$effect` `:149-157`;
  `failedMessageId` `:201-207`; `loadAll` `:236-256` (draft restore `:244`);
  hash-scroll `:258-293` (retry `:285-292`); `onGenerateLab`/`onGenerateQuiz`
  `:390-400`; header button group `:487-506`; `<MessageList>` `:596-621`
  (`streamBuffer` `:599`, `failedMessageId` `:605`); jump-to-latest `:635-645`;
  error card `:657-673`; mobile Sheet `<SheetTitle>` `:763`.
- `ChatRail.svelte`: imports `:2`; props `:7-35` (`generatingLab`/`generatingQuiz`
  `:17-18,31-32`); labs section/button `:108-143`; quizzes section/button
  `:145-180`.
- `LabRunner.svelte:54`: stale "KaTeX / Shiki / GFM" comment (→ highlight.js).
- `messages.ts`: `append` `:14-48` (opts.metadata `:23,45`); `delete` `:89-91`.
  **No `update` method.**
