# Chat Reasoning Display + UX Polish

Show the model's reasoning (chain-of-thought) inline in chat as a **collapsible
block, collapsed by default**, rendered **only when a message actually has
reasoning content** (per-message, presence-based → appears only for turns
generated with thinking on). Plus four UX-polish items: two distinct "quirky"
60 fps spinners for the chat loading states, full-width assistant bubbles, and
responsive+persisted collapsible panes.

## Verified context (in code today)

- Reasoning is **already captured** into the agent trace/diagnostics:
  - `src/lib/agent/loop.ts` `consumeStream` (lines ~66–93) iterates
    `result.fullStream` and forwards every part to `onTrace`.
  - `src/lib/agent/trace.ts` already accumulates `reasoning` from
    `reasoning-delta`/`reasoning` parts via `payload.text` (line ~142).
  - `DiagnosticsPanel.svelte` already renders live + persisted reasoning.
- **The gap:** `consumeStream` only feeds `text-delta` into the live
  `streamBuffer` (via `onTextDelta`). Reasoning never reaches the chat store, is
  never persisted onto the message, and never renders in `MessageRow`/`MessageList`.
- AI SDK `fullStream` emits `reasoning-delta` parts shaped
  `{ type: 'reasoning-delta', id, text, providerMetadata }` (verified in
  `node_modules/ai/dist/index.d.ts:2970`) → read `part.text` (matches trace.ts).
- Assistant **text** rows never use the `messages.metadata` column today (only
  tool-call rows use it for args; MessageRow's `parseMetadata` reads
  `{artifact?}`). So `{reasoning}` in metadata is conflict-free. **No schema
  change → no migration.**
- Spinners: every existing spinner is generic `Loader2`/`LoaderCircle` +
  `animate-spin`. The two new ones need custom `@keyframes`.
- Panes **already collapse**: left `Sidebar` (via `AppShell` header `PanelLeft`,
  `w-60`↔`w-16`) and right `ChatRail` (internal `PanelRight` toggle). Real gaps:
  (a) left sidebar is rendered unconditionally — no mobile drawer / auto-collapse,
  eats the viewport < lg; (b) right rail collapse only hides content but the chat
  page still reserves `w-72` (dead space); (c) neither state persists (both local
  `$state`); (d) the two collapse mechanisms are inconsistent.
- Persist precedent: `src/lib/stores/theme.svelte.ts` uses **localStorage** for
  instant-boot UI state (DB is the durable source for theme only). Pane-collapse
  is pure cosmetic UI state → mirror localStorage (sync read = no width flash,
  no DB write churn).
- Mobile drawer primitive: `src/lib/components/ui/sheet` already used for the
  chat page's mobile right rail; has built-in slide/fade animations.

## Decisions (confirmed)

1. **Reasoning** — collapsed-by-default collapsible block; per-message
   presence-based gating (block renders iff `reasoning.trim()` non-empty).
   Persisted in assistant text-row `metadata = {reasoning}`. Main chat replies
   only (labs/quizzes/grading out of scope).
2. **Spinners** — pulse-ring family, GPU-only (`transform`/`opacity`) custom
   `@keyframes` in `app.css`: FAST ripple ~0.7 s (waiting for first token) +
   SLOW orbit/comet ~1.6 s (receiving stream); `prefers-reduced-motion` fallback.
3. **Width** — assistant bubbles full-width within the `max-w-3xl` conversation
   column; only user bubbles stay `max-w-[75%]`.
4. **Panes** — fix responsive + persist: left sidebar auto-collapses on small
   screens + opens a mobile `Sheet` drawer; right-rail collapse frees the column
   to a thin strip (mirror sidebar's icon-strip); both states persist in
   localStorage.

---

## Section A — Reasoning display (data + UI)

### A1. `src/lib/agent/loop.ts` — capture reasoning into the turn

- Add `onReasoningDelta` callback param to `consumeStream`:
  ```ts
  consumeStream(fullStream, signal, onTextDelta, onToolCall, onReasoningDelta, onTrace?)
  ```
  In the part loop add a branch:
  ```ts
  } else if (p.type === 'reasoning-delta' && typeof p.text === 'string') {
      onReasoningDelta(p.text);
  }
  ```
  (Trace forwarding already happens via the generic `part` event — no trace change needed.)
- In `inner()`: declare `let reasoningBuf = '';` at turn scope (accumulate across
  iterations — full thought process). Reset only at turn start, not per iteration.
  Pass:
  ```ts
  onReasoningDelta: (t) => {
      reasoningBuf += t;
      deps.updateReasoningBuffer(reasoningBuf);
  }
  ```
- Extend `AgentTurnDeps`:
  ```ts
  updateReasoningBuffer: (next: string) => void;
  appendAssistantText: (content: string, opts?: { model?: string; reasoning?: string }) => Promise<Message>;
  ```
- Attach `reasoning: reasoningBuf` to the **two completion paths** only:
  - `finishReason !== 'tool-calls'` final persist (`appendAssistantText(finalBuf)`).
  - tool-budget-reached end persist (`appendAssistantText(finalBuf)`).
  - Leave the **interim text-before-tool-call** persist (`if (buf) appendAssistantText(buf)`)
    and the **aborted** persists WITHOUT reasoning (best-effort; keeps diff minimal).
  - The critic phase (`runCriticPhase`) streams separately and is NOT routed through
    `onReasoningDelta` → its reasoning stays out of the message block (it's a
    correction pass, not user-facing).

### A2. `src/lib/stores/chat.svelte.ts` — live buffer + persist

- Add `reasoningBuffer = $state('');`
- In `send()`: reset `this.reasoningBuffer = '';` alongside `this.streamBuffer = ''`
  (both at start and in `finally`).
- Pass to `runAgentTurn`:
  ```ts
  updateReasoningBuffer: (n) => (this.reasoningBuffer = n),
  ```
- Update the `appendAssistantText` impl to write metadata:
  ```ts
  appendAssistantText: async (content, opts) => {
      const row = await repos.messages.append(chatId, 'assistant', content, {
          model: opts?.model,
          metadata: opts?.reasoning ? JSON.stringify({ reasoning: opts.reasoning }) : undefined
      });
      ...
  }
  ```
  (`messagesRepo.append` already accepts `metadata`.)
- `load()` already resets transient state — ensure `reasoningBuffer = ''` is set there too.

### A3. `src/lib/components/chat/Reasoning.svelte` (NEW)

- Props: `reasoning: string`, `live = false`.
- Local `let open = $state(false)` (collapsed by default).
- Render the whole block **only if `reasoning.trim()`** (presence-based gating).
- Header button toggles `open`: `<Brain/>` icon + "Thought process" label; if
  `live`, show the SLOW streaming spinner (Section B) inline; `ChevronRight`→`ChevronDown`.
- Body: `<Markdown raw={reasoning} />` (reuse existing markdown renderer; muted styling,
  e.g. `text-muted-foreground italic`).
- Reuse the lightweight local-`$state` toggle pattern already used in
  `DiagnosticsPanel.svelte` (`expandedSystem`) — **do not** add a new shadcn
  Collapsible primitive.

### A4. `src/lib/components/chat/MessageRow.svelte` — persisted block + width

- Extend `parseMetadata` return type to `{ artifact?; reasoning?: string }`.
- Derive `reasoning = message.role === 'assistant' && !message.toolCallId
  ? parsedMeta?.reasoning : undefined` (gated off tool-call rows).
- Render `<Reasoning reasoning={reasoning} />` **above** the assistant bubble
  (inside the `items-start` column) when present.
- **Width (#3):** change the bubble `max-w-[75%]` to apply only to user:
  - assistant bubble → drop `max-w-[75%]` (full width of the conversation column).
  - user bubble → keep `max-w-[75%]`.

### A5. `src/lib/components/chat/MessageList.svelte` — live block + width

- Accept new prop `reasoningBuffer = ''`.
- Live assistant bubble: render `<Reasoning reasoning={reasoningBuffer} live />`
  above the streamBuffer markdown (collapsed by default). Make the live bubble
  full-width (drop `max-w-[75%]`).

### A6. `src/routes/chat/[id]/+page.svelte` — wire buffer

- Pass `reasoningBuffer={chatStore.reasoningBuffer}` to `<MessageList>`.

### A7. Tests

- `src/lib/agent/loop.test.ts`: make the mocked `fullStream` emit a
  `{type:'reasoning-delta', text:'thinking…'}` part before the text deltas; assert
  `appendAssistantText` is called with `opts.reasoning` containing it and that the
  interim tool-text persist omits reasoning. (Mirror existing stub-stream pattern.)
- `src/lib/stores/chat.svelte.test.ts`: assert `reasoningBuffer` resets on send/load,
  and that a turn with reasoning writes `metadata` JSON containing `reasoning` on the
  assistant row.

---

## Section B — Spinners (waiting vs receiving)

### B1. `src/app.css` — keyframes + reduced-motion

Add GPU-only keyframes (transform/opacity) — sample names/values (tune in impl):
```css
@keyframes mayon-pulse-ring {            /* FAST: waiting for first token */
  0%   { transform: scale(0.4); opacity: 0.9; }
  70%  { transform: scale(1.4); opacity: 0; }
  100% { transform: scale(1.4); opacity: 0; }
}
@keyframes mayon-orbit-spin {            /* SLOW: receiving stream */
  to { transform: rotate(360deg); }
}
```
- FAST: a dot with a `::before` ring running `mayon-pulse-ring 0.7s ... infinite`.
- SLOW: a ring (arc) running `mayon-orbit-spin 1.6s linear infinite` with a comet dot.
- Add `@media (prefers-reduced-motion: reduce)` to drop animations to a static
  element (mirror the existing `prefers-contrast` handling at `app.css:203`).

### B2. `src/lib/components/chat/Spinner.svelte` (NEW)

- Props: `variant: 'pulse' | 'orbit'`, `class?`.
- Pure presentational; renders the two structures. No JS animation.

### B3. `src/lib/components/chat/MessageList.svelte` — two states

- Waiting (`streaming && !streamBuffer`): replace the current
  `Waiting for the first token…` text with `<Spinner variant="pulse" />` +
  small "Thinking…" label. (Reasoning block from A5 may also show above it.)
- Receiving (`streaming && streamBuffer`): show `<Spinner variant="orbit" />`
  small, inline next to the "Mayon" label of the live bubble.

---

## Section C — Assistant full-width

Covered in **A4/A5** (assistant bubbles drop `max-w-[75%]`; user keeps it). No
separate task.

---

## Section D — Panes: responsive + persist

### D1. Left sidebar — mobile drawer + persist (`AppShell.svelte` + `Sidebar.svelte`)

- `Sidebar.svelte`: `collapsed` is already `$bindable`. Keep it.
- `AppShell.svelte`:
  - Read/write desktop collapse state to localStorage key
    `mayon:ui:sidebar` (`'1'` = collapsed). Hydrate synchronously on init (no flash).
  - Add a reactive `matchMedia('(min-width: 1024px)')` flag (`lg`).
  - **Desktop (lg):** render inline `<Sidebar bind:collapsed />` as today (persisted).
    The header `PanelLeft` button toggles the inline collapse.
  - **Mobile (<lg):** do NOT render the inline sidebar. The `PanelLeft` button
    toggles a left-side `<Sheet>` drawer containing the expanded nav (nav links +
    labels). Drawer-open is ephemeral `$state` (not persisted).
  - Auto-collapse behavior falls out naturally: on mobile the inline sidebar is
    absent (drawer instead); on desktop the persisted `collapsed` is honored.

### D2. Right rail — free the column + persist (`ChatRail.svelte` + `chat/[id]/+page.svelte`)

- `ChatRail.svelte`: make `collapsed` a `$bindable` prop (currently internal
  `$state(false)`). Keep the internal toggle button; when collapsed render the
  thin expand affordance (do NOT also keep a full empty column).
- `chat/[id]/+page.svelte` desktop rail column:
  - Lift `let railCollapsed = $state(localStorage … 'mayon:ui:rail')` (sync hydrate).
  - Apply reactive width: collapsed → `w-12` strip (expand button), expanded → `w-72`.
    Mirror the sidebar's icon-strip pattern for consistency. Persist on toggle.
  - Mobile: the existing `<Sheet>` right-rail (railOpen) stays as-is (already
    responsive) — no change there.

---

## Failure modes / caveats

- Reasoning is **best-effort**: if a provider ignores the thinking-disable param
  or emits none, the block simply doesn't render (presence-gated). Never breaks chat.
- Stock OpenAI / strict gateways may reject the `thinking` field (already the case
  pre-plan; this work doesn't change that).
- Reasoning text can be long; the collapsed-by-default + `Markdown` render keeps it
  unobtrusive. Consider a `max-h` + scroll on the expanded body.
- localStorage is per-origin/per-profile; pane state is device-local (acceptable
  for cosmetic UI; theme is the only thing that needs cross-device durability).
- No schema/migration. Run `pnpm check`, `pnpm lint`, `pnpm test` after changes;
  **no** `db:generate` / `bundle:migrations`.
- Animations are transform/opacity only (GPU) for 60 fps; reduced-motion users get
  a static fallback.

## Validation (acceptance gates)

- `pnpm test` green (updated `loop.test.ts` + `chat.svelte.test.ts`).
- `pnpm check` + `pnpm lint` clean.
- **Reasoning:** `pnpm dev` → new chat → send a prompt with Thinking ON → a
  collapsed "Thought process" block appears above the reply while streaming and
  after persist; click expands it. Toggle Thinking OFF → next reply has no block.
  Reload → block persists on the message.
- **Spinners:** before the first token a FAST ripple shows; once text streams a
  SLOW orbit shows by the label. `prefers-reduced-motion` → static.
- **Width:** assistant bubbles span the full conversation column; user bubbles stay ~75%.
- **Panes:** shrink to <lg → left sidebar becomes a `PanelLeft` drawer (no inline
  sidebar eating the viewport); collapse the right rail → column shrinks to a thin
  strip (not dead space). Reload → both collapse states persist (desktop).
