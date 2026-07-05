# Plan — User-journey Wave 2a (P1 fixes: UJ6–UJ12 + UJ7b)

Execution plan for `refinement/user-journey-p1a.md`. The design doc is
authoritative for **product decisions and task scope**; **this file is
authoritative for mechanism** — every `file:line` below was verified against the
live code on 2026-07-05, and the spots where the code disagrees with the design
doc (or where line numbers have drifted since the doc was written) are corrected
in **Verification corrections** below.

Seven independent phases (UJ6–UJ12) shipped as one wave, plus **UJ7b** (token
estimate) which the doc offered as optional — **included in this wave per
sign-off** (decision J). UJ7b is the only phase that touches the agent loop; the
other six are UI/store-only and low-risk. Suggested order at the end; any order
is safe except UJ10 and UJ11 share the Composer's `prompt` binding and should be
implemented **together** (they land as one coherent change to the Composer).

---

## Verification corrections (code-vs-doc; plan wins on mechanism)

1. **UJ6 touches TWO render sites, not one.** The design doc flagged "verify on
   read" whether the desktop `<Sidebar>` also renders the runtime. It does:
   `Sidebar.svelte:75` (`{dbStatus.runtime}`, desktop footer, gated on
   `!collapsed`) **and** `AppShell.svelte:114` (the mobile sheet's `<aside>`
   footer). → **Both** swap to the readable label. To avoid duplicating a helper
   across two components, `runtimeLabel` is exported from a pure util
   (`$lib/utils/runtime.ts`, type-only import of `DbRuntime`) and imported by
   both. (The `DbRuntime` type lives in `src/lib/stores/db.svelte.ts`; components
   already import the store via the `$lib/stores/db.svelte.js` alias — TS bundler
   resolution maps the `.js` import to the `.ts` file, unchanged.)

2. **Chat-page line drift** (the page grew since the doc was written; the doc's
   citations are stale but the structures they point at are correct). Verified
   current anchors:
   - Diagnostics toggle button: doc `:441-449` → **actual `:465-473`**
     (`title="Diagnostics"`, `<Wrench class="size-4" />`).
   - `bottomVisible`: doc `:84` → **actual `:76`**. Auto-scroll `$effect`
     (watches `chatStore.messages.length`): doc `:87-93` → **actual `:96-102`**.
     The scroll/ResizeObserver `$effect` (updates `bottomVisible` on scroll +
     resize): doc `:102-109` → **actual `:104-143`** (handler `updateVisibility`
     at `:89-94`).
   - Fade gradients: doc `:566-577` → **actual top `:590-595`, bottom
     `:596-601`**, both inside `middleWrapper` (`bind:this` at `:560`,
     container `:558-602`). `viewport` bind at `:563`.
   - Chat error card: doc `:589-601` → **actual `:613-626`** (the
     `{#if chatStore.error}` block; it has a special-case "Open Settings" button
     for `error.title === 'Missing API key'` at `:620-624`).
   - Composer call: **actual `:676-684`** (already passes `supportsDeep`,
     `providerName`, `modelId` from the landed P0 wave; binds `streaming`).
   - `onCopy`: doc `:334-336` → **actual `:358-360`** — confirms
     `void navigator.clipboard?.writeText(text)` with **no fallback** (UJ9
     matches this pattern).
   - DiagnosticsPanel call: **`:737`** (`<DiagnosticsPanel chatId={...} />`) —
     passes **no `title`** prop.

3. **DiagnosticsPanel header has a hardcoded "Diagnostics" template**
   (`DiagnosticsPanel.svelte:160`):
   `{title ? `Diagnostics — ${title}` : 'Diagnostics'}`. The current call sites
   pass `title="Diagnostics — Lab"` / `title="Diagnostics — Quiz"`, which already
   double-prefix (`Diagnostics — Diagnostics — Lab`) — a latent cosmetic bug. →
   UJ7 replaces the template with `{title ?? 'Mayon console'}` and call sites
   pass the **full** title (`"Mayon console — Lab"`, `"Mayon console — Quiz"`,
   `"Mayon console"` for chat). No other hardcoded "Diagnostics" string exists
   in the panel.

4. **Composer: `prompt` is internal `$state`** (`Composer.svelte:34`); the doc's
   UJ11 put draft save/restore inside the Composer keyed on a `chatId` prop, but
   UJ10 makes `prompt` `$bindable` and page-owned. Those two conflict if kept
   separate. → **Unified mechanism (see UJ10 + UJ11):** `prompt` becomes
   `$bindable`; the **page** owns `composerPrompt` and does draft restore (in
   `loadAll`) + debounced save (`$effect`). The Composer keeps ONLY auto-resize
   (it owns the `<textarea>` ref) — it does **not** take a `chatId` prop and does
   **not** touch the settings KV. This fixes the doc's "restore on mount" design
   (Svelte `onMount` does not re-fire on chat switch, so a Composer-internal
   restore would only work for the first chat). Current Composer anchors:
   `send()` at `:66-71`; `<textarea>` at `:95-101`; `prompt` `$state` at `:34`.

5. **Mermaid `<pre>` is replaced asynchronously**, in `onMount`
   (`Markdown.svelte:26-53`), **after** the post-render `$effect` (`:55-77`)
   runs. So at copy-pass time the mermaid `<pre>` still exists. → UJ9's copy pass
   **must** explicitly skip `<pre>` blocks whose child `<code>` has class
   `language-mermaid` (the doc's "or" is resolved: they are NOT pre-replaced).
   An idempotency guard is required because the `$effect` re-runs whenever `html`
   changes.

6. **UJ7b: usage data rides on the stream's `finish` part**, which the loop
   currently discards. `consumeStream` (`loop.ts:73-103`) reads `finishReason`
   from the `'finish'` part (`:96-97`) but drops `usage`. → Capture `usage`
   there, return it, and have the loop emit a `{kind:'usage', usage, modelId}`
   trace event (modelId from `deps.model`). The panel derives the live usage
   from `diagnosticsStore.liveEvents` — which is **already cleared on
   `endTurn`** (`diagnostics.svelte.ts:35-37`) — so **no new store field** and no
   stale-leak risk. The implementer must confirm the AI SDK version's finish-part
   field name (`usage` vs `totalUsage`); read defensively (`p.usage ??
   p.totalUsage`).

All other `file:line` citations in the design doc verified accurate (see
**Verified anchors** at the end).

---

## UJ6 — Readable runtime label *(do first: pure helper + two one-liners)*

**Root cause (verified):** both sidebar footers render the raw `DbRuntime` token
(`'browser'` / `'tauri'`) at 50% opacity, unlabeled. `DbRuntime` also includes
`'memory'` (dev/test fallback) and `'unknown'` (initializing) — neither is a
useful label.

**Tasks**
1. `src/lib/utils/runtime.ts` **(new)** — pure, testable helper; type-only import
   so loading it in Vitest does not pull the runes store:
   ```ts
   import type { DbRuntime } from '$lib/stores/db.svelte.js';
   export function runtimeLabel(r: DbRuntime): string {
     switch (r) {
       case 'tauri': return 'Desktop app';
       case 'browser': return 'Web';
       case 'memory': return 'Web';   // dev/test fallback — never surfaced as "Memory"
       case 'unknown': return '';
     }
   }
   ```
2. `src/lib/components/AppShell.svelte`
   - Import: `import { runtimeLabel } from '$lib/utils/runtime';`
   - `:114`: `<span class="px-2 text-xs text-muted-foreground/50">{dbStatus.runtime}</span>`
     → `<span class="px-2 text-xs text-muted-foreground">{runtimeLabel(dbStatus.runtime)}</span>`
     (full opacity, labeled).
3. `src/lib/components/Sidebar.svelte`
   - Import: `import { runtimeLabel } from '$lib/utils/runtime';`
   - `:75`: same swap (stays inside the existing `{#if !collapsed}` block).

**Tests** (`pnpm test`)
- `src/lib/utils/runtime.test.ts`: all four `DbRuntime` values → expected label;
  `unknown` → `''`; no other value yields empty.

**Manual gate:** `pnpm dev` → sidebar footer reads **"Web"** at full opacity
(not "browser", not 50%). `pnpm tauri dev` → **"Desktop app"**. Theme toggle +
DbStatus badge render correctly alongside. (Initializing: empty while
`unknown`.)

### UJ6 — decisions
- **RESOLVED:** `memory` → "Web" (never surface "Memory"). Helper shared via a
  pure util (not duplicated per component).

---

## UJ7 — Rename "Diagnostics" → "Mayon console" + developer icon *(mechanical; three call sites)*

**Mechanism (decided):** keep the panel user-facing (do **not** gate behind
`import.meta.env.DEV`); rename toggle to **"Mayon console"**; swap `Wrench` →
`SquareTerminal`; fix the panel header template.

**Tasks**
1. `src/routes/chat/[id]/+page.svelte`
   - Import (`:5-13`): drop `Wrench` (`:11`); add `SquareTerminal` (and keep the
     other icons — `ChevronDown` is added by UJ12 in the same import block).
   - Toggle button (`:465-473`): `title="Diagnostics"` /
     `aria-label="Diagnostics"` → `"Mayon console"`; `<Wrench class="size-4" />`
     → `<SquareTerminal class="size-4" />`.
   - DiagnosticsPanel call (`:737`): add `title="Mayon console"`.
2. `src/lib/components/labs/LabRunner.svelte`
   - Import (`:2`): `import { ArrowLeft, Wrench }` → `import { ArrowLeft, SquareTerminal }`.
   - Toggle (`:34-42`): title/aria `"Diagnostics"` → `"Mayon console"`;
     `Wrench` → `SquareTerminal`.
   - Panel call (`:91`): `title="Diagnostics — Lab"` → `title="Mayon console — Lab"`.
3. `src/lib/components/quizzes/QuizRunner.svelte`
   - Import (`:2`): swap `Wrench` → `SquareTerminal`.
   - Toggle (`:35-43`): title/aria → `"Mayon console"`; icon swap.
   - Panel call (`:151`): `title="Diagnostics — Quiz"` → `title="Mayon console — Quiz"`.
4. `src/lib/components/diagnostics/DiagnosticsPanel.svelte`
   - Header template (`:160`):
     `<SheetTitle>{title ? `Diagnostics — ${title}` : 'Diagnostics'}</SheetTitle>`
     → `<SheetTitle>{title ?? 'Mayon console'}</SheetTitle>`.
   - With the call sites now passing full titles, this renders "Mayon console"
     (chat), "Mayon console — Lab", "Mayon console — Quiz" — and fixes the
     pre-existing double-prefix.

**Tests:** none automated (presentational).

**Manual gate:** `/chat/[id]`, `/lab/[id]`, `/quiz/[id]`: the console toggle is a
terminal glyph titled "Mayon console"; opening shows the renamed sheet header.
Behavior unchanged.

### UJ7 — decisions
- **RESOLVED:** keep user-facing; name = "Mayon console"; icon = `SquareTerminal`;
  header template simplified to `{title ?? 'Mayon console'}`.

---

## UJ7b — Token-usage estimate in the Mayon console *(the only loop-touching phase)*

> Per sign-off **J**, this is **included** in the wave (overrides the doc's
> "recommend defer").

**Mechanism (decided):** capture the AI SDK `usage` object from the stream
finish, surface it through the existing `onTrace`/`liveEmit` channel, and render
a compact "Context: ~12.4k / 128k (10%) est." line with a click-toggle between
percentage and raw amounts. **Live-only** (the console already shows the live
turn); not persisted (no migration). Max-context is a **static prefix table**
labeled "est."; never call a provider API for the real limit.

**Tasks**
1. `src/lib/agent/trace.ts`
   - Add a `TraceEvent` variant:
     `| { kind: 'usage'; usage: { promptTokens: number; completionTokens: number; totalTokens: number }; modelId: string }`
     (carry `modelId` so the panel can resolve the context limit without an extra
     prop).
   - `TraceBuilder.emit` (`:104-216`): add `case 'usage': break;` (no-op — usage
     is live-only, not persisted into `toJSON()`).
2. `src/lib/agent/loop.ts`
   - `consumeStream` (`:73-103`): when `p.type === 'finish'` (`:96-97`), also
     capture `const usage = (p.usage ?? p.totalUsage) as {...} | undefined`.
     Change the return type to `{ finishReason: string; usage: {...} | null }`
     and return it.
   - After the `consumeStream` call (`:247-260`), if `usage`, emit
     `deps.onTrace?.({ kind: 'usage', usage, modelId: (deps.model as { modelId?: string })?.modelId ?? '' })`.
     (Only the main-loop iterations call `consumeStream`; the critic correction
     loop at `:126-143` has its own inline stream and does not — capturing the
     final iteration's usage is sufficient and is what "live turn" means.)
3. `src/lib/ai/model-limits.ts` **(new)** —
   `export function estimateContextLimit(modelId: string | undefined): number | null`
   keyed by model-id prefix (e.g. `glm-5.2`/`glm-5.1` → 128k, `gpt-4o` → 128k,
   `claude-3-5-sonnet` → 200k, `gemini-1.5-pro` → 1M, …). Unknown prefix →
   `null`. Case-insensitive; trim bracket suffixes like `[1m]` before matching.
4. `src/lib/components/diagnostics/DiagnosticsPanel.svelte`
   - Derive the live usage from the (already-cleared-on-`endTurn`) event list:
     ```ts
     let liveUsage = $derived.by(() => {
       for (let i = diagnosticsStore.liveEvents.length - 1; i >= 0; i--) {
         const e = diagnosticsStore.liveEvents[i];
         if (e.kind === 'usage') return e;
       }
       return null;
     });
     ```
   - Local toggle: `let usageFmt = $state<'pct' | 'raw'>('pct');`
   - In the "In-flight turn…" section (`:192-235`), after the live parts/error,
     render (only when `liveUsage` **and** `estimateContextLimit(liveUsage.modelId)`
     are both present):
     `Context: ~{fmt(liveUsage.usage.totalTokens)} / {limit} ({pct}%) est.` —
     click toggles `usageFmt`. Hide entirely when either is absent (never show a
     misleading number).
   - This line is **chat-turn-only**: lab/quiz generation does not stream through
     `runAgentTurn`, so `liveEvents` has no `usage` event there → line hidden
     (correct).

**Tests** (`pnpm test`)
- `src/lib/ai/model-limits.test.ts`: known prefixes → expected cap; unknown/empty
  → `null`; bracket-suffix (`glm-5.2[1m]`) still matches.
- `src/lib/agent/loop.test.ts` (extend): a mock `fullStream` whose `finish` part
  carries `usage` → `onTrace` receives `{kind:'usage', usage, modelId}` with the
  expected counts.

**Manual gate:** stream a reply in `/chat/[id]` → open the Mayon console → see
`Context: ~12.4k / 128k (10%) est.` → click → toggles to raw amounts. For an
unknown model the line is hidden. Lab/quiz console: line absent.

### UJ7b — decisions
- **RESOLVED (was open item J):** ship UJ7b **in this wave** (per sign-off).
- **RESOLVED:** live-only (derived from `liveEvents`, no persistence, no
  migration); max-context is a static prefix table labeled "est."; chat-turn-only
  (lab/quiz hidden).

---

## UJ8 — Honest Branch vs Expound labeling *(string renames + one subtitle)*

**Tasks**
1. `src/lib/components/chat/MessageRow.svelte` (`:87-95`)
   - Button label (`:94`): `<GitBranch class="size-3" /> Branch` →
     `<GitBranch class="size-3" /> Branch from this message`.
   - `title` (`:91`): keep `"Branch a new chat from this whole message"` (now
     redundant with the label but harmless; or shorten to `"Whole-message branch"`).
2. `src/lib/components/chat/ContextMenu.svelte` (`:86`)
   - Action label: `Expound…` → `Branch from this text` (icon `GitBranch` stays
     at `:85`).
3. `src/lib/components/chat/ExpoundPromptConstructor.svelte`
   - Add a one-line subtitle under the header row (`:82-93`). After the
     `</div>` closing the header (`:93`), before the excerpt preview (`:95`):
     `<p class="text-xs text-muted-foreground">A focused sub-chat about the selected excerpt.</p>`
   - Keep the `<h3>Expound</h3>` heading (`:83`) — internal symbol; only the
     subtitle is new copy.
4. **Do not** rename internal symbols (`createExpoundBranch`, `ExpoundOptions`,
   `ExcerptOverlapError`, `branch_sources`, …) — implementation names; only
   user-facing strings change. (The `ExcerptOverlapError` message at
   `chat.svelte.ts:60-64` is an error string, not a button label — leave it.)

**Tests:** none automated (strings).

**Manual gate:** `/chat/[id]`: assistant message shows "Branch from this
message"; select text + right-click shows "Branch from this text"; opening the
constructor shows the new subtitle. Regression: whole-message branch creates no
`branch_source` row; text branch does.

### UJ8 — decisions
- **RESOLVED:** rename (audit fix option 1), not explainers.

---

## UJ9 — Copy button on code blocks *(self-contained DOM enhancement)*

**Tasks**
1. `src/lib/components/chat/Markdown.svelte`
   - In the existing `$effect` (`:55-77`) that enhances links/tables, add a
     `container.querySelectorAll('pre')` pass:
     - Skip if the `<pre>` already has a `.md-copy-btn` (idempotency — the effect
       re-runs on `html` change).
     - **Skip mermaid:** if the `<pre>`'s child `<code>` has class
       `language-mermaid`, skip it (correction #5 — the SVG swap is async and
       hasn't happened yet when this runs).
     - Otherwise inject a `<button class="md-copy-btn">` (top-right). On click:
       read `pre.textContent` (the code, not the button's label),
       `void navigator.clipboard?.writeText(code)` (no fallback — matches
       `onCopy` at `chat/[id]/+page.svelte:358-360`); briefly swap label to
       "Copied" (1.5s) then revert.
   - CSS (`<style>`, after the `pre code` rule at `:174-179`): make
     `.markdown-body pre` `position: relative` (it currently isn't — add to the
     existing `:global(.markdown-body pre)` rule at `:166`); add
     `.md-copy-btn { position:absolute; top:.25rem; right:.25rem; opacity:0;
     transition:opacity .15s; … }` and
     `:global(.markdown-body pre:hover .md-copy-btn){opacity:1;}`.
2. `src/lib/markdown/focusable.ts` — **not modified.** Copy logic stays local to
   `Markdown.svelte` (message-render-specific). If a later phase wants copy on
   focusable tables too, extract then.

**Tests:** none automated (DOM post-process; the `renderMarkdown` pipeline is
already tested). The mermaid-skip is verified by the manual gate.

**Manual gate:** a reply with fenced code blocks → hover each → copy button
fades in top-right → click → "Copied" → paste yields the exact code. Multiple
blocks each get their own button. A mermaid block renders to SVG with **no** copy
button. Re-rendering (new message) does not double-inject buttons.

### UJ9 — decisions
- **RESOLVED:** post-render injection in `Markdown.svelte`;
  `navigator.clipboard?.writeText` (no fallback, matching `onCopy`); skip
  mermaid `<pre>`; idempotency guard.

---

## UJ10 + UJ11 — Failed-send retry, composer auto-resize, draft persistence *(implemented together — shared `prompt` binding)*

> UJ10 and UJ11 both rework the Composer's `prompt`. They are specified together
> so the binding ownership is unambiguous. Do them as one change.

**Shared mechanism (decided):** `prompt` becomes a `$bindable` prop; the **page**
owns `composerPrompt = $state('')` and binds `bind:prompt={composerPrompt}`. The
Composer keeps only **auto-resize** (it owns the textarea ref). Draft I/O lives
in the page so it re-runs on every chat switch (correction #4). Failed-send
state (`lastFailedPrompt`) lives in `chatStore`; Retry restores it into the bound
`composerPrompt` (decision N — **restore-into-composer**, no auto-resend).

### Composer changes (`src/lib/components/chat/Composer.svelte`)
- Props (`:16-32`): change `let prompt = $state('');` (`:34`) to a bindable:
  add `prompt = $bindable('')` to the destructured props **and remove** the local
  `let prompt = $state('')`. (`send` `:66-71`, `sendChip` `:61-64`, `canSend`,
  `showChips`, the textarea `bind:value={prompt}` `:96` all keep working against
  the bindable.)
- Auto-resize (UJ11): add `let textareaEl = $state<HTMLTextAreaElement | null>(null);`
  and `bind:this={textareaEl}` on the textarea (`:95`). Add a `$effect`:
  ```ts
  const MAX_TEXTAREA_H = 22 * 16; // ~22rem ≈ 12 lines
  $effect(() => {
    void prompt;            // re-run on prompt change
    const el = textareaEl;
    if (!el) return;
    if (!prompt) { el.style.height = ''; return; } // back to rows="2"
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, MAX_TEXTAREA_H) + 'px';
  });
  ```
- **No `chatId` prop, no settings KV access, no `lastPrompt`** — all lifted out.

### Store changes (`src/lib/stores/chat.svelte.ts`)
- Add `lastFailedPrompt = $state<string | null>(null);` (near `error` `:74`).
- `send()` catch (`:312-319`): on the non-abort branch, set
  `this.lastFailedPrompt = prompt;` (`prompt` is `text.trim()` from `:169`, in
  scope).
- `send()` finally (`:320-346`): after the trace write, add
  `if (!this.error) this.lastFailedPrompt = null;` — clears on success **and** on
  abort (both leave `error` null; abort is intentional, not a failure).
- Add `async deleteLastDanglingUser(): Promise<void>`:
  ```ts
  const msgs = this.messages;
  if (msgs.length === 0) return;
  const last = msgs[msgs.length - 1];
  if (last.role !== 'user') return;          // only a trailing user row
  await repos.messages.delete(last.id);      // messages.ts:89
  this.messages = msgs.filter((m) => m.id !== last.id);
  ```
- Draft cleanup (UJ11): in `deleteChat` (`:375-380`) and `deleteBranch`
  (`:382-388`), best-effort `await repos.settings.delete('draft:' + chatId)` for
  the directly-deleted id (cheap; covers the common case — deeper descendants'
  orphaned drafts are harmless KV rows).

### Page changes (`src/routes/chat/[id]/+page.svelte`)
- Add `let composerPrompt = $state('');`
- Composer call (`:676-684`): add `bind:prompt={composerPrompt}`.
- **Draft restore (UJ11):** in `loadAll(chatId)` (`:214-233`), immediately after
  `await chatStore.load(chatId)` (`:221`) and **before** any other await, set
  `composerPrompt = (await repos.settings.get<string>('draft:' + chatId)) ?? '';`
  (synchronous relative to the effect — keeps the save effect from writing the
  old chat's text under the new key).
- **Draft save (UJ11):** debounced `$effect`:
  ```ts
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const text = composerPrompt;
    const id = chatStore.chatId;
    if (!id) return;
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      void (text ? repos.settings.set('draft:' + id, text) : repos.settings.delete('draft:' + id));
    }, 400);
  });
  ```
  (On send, the Composer sets `prompt=''` → flows to `composerPrompt=''` → after
  400ms the draft row is deleted. On chat switch, restore sets composerPrompt →
  effect re-saves the same value, harmless.)
- **Failed-turn marker (UJ10):**
  ```ts
  const failedMessageId = $derived.by(() => {
    if (!chatStore.error || !chatStore.lastFailedPrompt) return null;
    const msgs = chatStore.messages;
    if (msgs.length === 0) return null;
    const last = msgs[msgs.length - 1];
    return last.role === 'user' ? last.id : null;
  });
  ```
- **Retry (UJ10):** in the error card (`:613-626`), add a Retry button shown
  when `chatStore.lastFailedPrompt`:
  ```svelte
  {#if chatStore.lastFailedPrompt}
    <Button variant="outline" size="sm" class="mt-2" onclick={onRetry}>Retry</Button>
  {/if}
  ```
  and:
  ```ts
  async function onRetry() {
    const text = chatStore.lastFailedPrompt;
    if (text == null) return;
    await chatStore.deleteLastDanglingUser();   // remove the unanswered user row
    composerPrompt = text;                       // restore into the composer (decision N)
    chatStore.lastFailedPrompt = null;
    chatStore.error = null;
  }
  ```
  (Restore-into-composer: the user reviews/edits, then hits Send — no auto-resend.)
- **Red border (UJ10):** pass `failedMessageId={failedMessageId}` to
  `<MessageList>` (`:564`); thread it to `MessageRow` as
  `failed={message.id === failedMessageId}`.

### MessageList + MessageRow changes (UJ10 red border)
- `src/lib/components/chat/MessageList.svelte`: add `failedMessageId?: string | null`
  prop; pass `failed={message.id === failedMessageId}` to `<MessageRow>` (`:58`).
- `src/lib/components/chat/MessageRow.svelte`: add `failed = false` prop; on the
  user bubble div (`:104-109`), append `{failed ? 'border-l-2 border-red-500/60' : ''}`.

**Tests** (`pnpm test`, in-memory driver — extend `chat.svelte.test.ts`)
- `send` that throws a non-abort error → `lastFailedPrompt === sent text`;
  `error` set. A subsequent successful `send` → `lastFailedPrompt === null`.
- `send` aborted (Stop) → `lastFailedPrompt` stays whatever it was (abort is not
  a failure); `error === null`.
- `deleteLastDanglingUser`: removes a trailing `user` row; no-op when the last
  row is `assistant`/`tool` (doesn't delete a legitimate final user message in a
  healthy thread) or when messages is empty.
- Settings-KV draft round-trip: `set('draft:<id>', 'x')` → `get` returns `'x'`;
  `delete` → `get` returns `null` (likely already covered by settings repo tests;
  add if missing).

**Manual gate**
- **Retry + red border:** configure a bad key (or go offline) → send → composer
  clears, error card shows with **Retry**, last user bubble has a red left
  border. Click Retry → composer refills with the prompt, dangling row removed.
  Fix the key → Send → reply streams, red border gone, `lastFailedPrompt` null.
- **Abort ≠ failure:** Stop mid-stream → no error card, no Retry, no red border.
- **Auto-resize:** type a long prompt → textarea grows to ~12 lines then scrolls
  internally; clear it → snaps back to 2 rows.
- **Draft:** type a prompt → go to `/settings` → return → draft restored; reload
  the tab → restored; Send → draft cleared; delete the chat → its `draft:<id>`
  row gone.

### UJ10 + UJ11 — decisions
- **RESOLVED (was open item N):** Retry = **restore-into-composer** (per
  sign-off); user hits Send; no auto-resend.
- **RESOLVED:** `prompt` is `$bindable`, page-owned; `lastFailedPrompt` in
  `chatStore`; dangling user row deleted on retry; failed user row gets a subtle
  red left border; draft I/O in the page (restore in `loadAll`, debounced save
  `$effect`), Composer keeps only auto-resize.

---

## UJ12 — "Jump to latest" during/after streaming *(one floating button; no auto-follow)*

**Mechanism (decided):** per the audit `[!NOTE]`, the user does **not** want
auto-follow. Add only a floating "Jump to latest ↓" button, driven by the
existing `bottomVisible` flag (`:76`, updated by `updateVisibility` on scroll +
resize at `:104-143`). No new scroll wiring.

**Tasks**
1. `src/routes/chat/[id]/+page.svelte`
   - Import (`:5-13`): add `ChevronDown` (alongside UJ7's `SquareTerminal`).
   - Inside `middleWrapper` (`:558-602`), after the bottom fade div (`:601`):
     ```svelte
     {#if !bottomVisible}
       <button
         type="button"
         class="jump-latest pointer-events-auto absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full border border-border bg-background px-3 py-1.5 text-xs shadow-md hover:bg-accent"
         title="Jump to latest"
         onclick={() => viewport?.scrollTo({ top: viewport?.scrollHeight, behavior: 'smooth' })}
       >
         <ChevronDown class="size-4" /> Jump to latest
       </button>
     {/if}
     ```
   - `viewport` (`:71`) and `bottomVisible` (`:76`) already exist; after the
     smooth scroll lands, `updateVisibility` flips `bottomVisible` true and the
     button hides. During a stream, `scrollHeight` grows but the button stays
     visible while scrolled up (correct — respects reading speed).

**Tests:** none automated (DOM/scroll). `bottomVisible` logic already exercised
manually.

**Manual gate:** stream a long reply while scrolled up → "Jump to latest" stays
visible, viewport does **not** auto-follow; click → smooth-scrolls to bottom →
button disappears; scroll up → reappears.

### UJ12 — decisions
- **RESOLVED:** no auto-follow; floating button on `!bottomVisible`; smooth
  scroll on click; reuses existing scroll flag (no new wiring).

---

## Sign-off (both items resolved)

- **J — UJ7b scope:** **INCLUDE in this wave** (overrides the doc's "recommend
  defer"). Rationale (per sign-off): the token estimate is a high-value console
  feature and the loop change is contained (`consumeStream` return + one emit).
- **N — UJ10 retry:** **restore-into-composer** (per sign-off); user reviews then
  hits Send.

---

## Verification gates (per phase)

| Phase | Automated (`pnpm test`, in-memory) | Manual (OPFS + Tauri) |
|-------|------------------------------------|------------------------|
| UJ6 | `runtimeLabel` × {browser, tauri, memory, unknown} | "Web" / "Desktop app" at full opacity in sidebar footer |
| UJ7 | n/a (icon/label swap) | terminal icon + "Mayon console" title + header on chat/lab/quiz |
| UJ7b | `estimateContextLimit` known/unknown; loop emits `usage` on mock finish | live "Context … est." line with pct/raw toggle; hidden for unknown model + lab/quiz |
| UJ8 | n/a (strings) | "Branch from this message" / "Branch from this text" + constructor subtitle; both branch kinds still correct |
| UJ9 | n/a (DOM enhancement) | hover code block → copy → paste yields code; mermaid unaffected; no double-inject |
| UJ10 | `lastFailedPrompt` set/clear; abort no-set; `deleteLastDanglingUser` | failed send → red border + Retry → restores + removes dangling → re-send succeeds |
| UJ11 | settings-KV draft round-trip | textarea auto-grows; draft survives nav + reload; cleared on send; deleted with chat |
| UJ12 | n/a (scroll DOM) | scroll up during stream → no follow, "Jump to latest" visible → click → smooth to bottom |

**Every phase:** `pnpm lint && pnpm check` clean before done.

---

## Suggested order of work

1. **UJ6** (one pure helper + two one-liners; fastest definitiveness win).
2. **UJ8** (string renames + one subtitle; low risk, high clarity).
3. **UJ7** (icon/label swap across three call sites + header template; mechanical).
4. **UJ9** (self-contained DOM enhancement in `Markdown.svelte`).
5. **UJ12** (one floating button reusing the existing `bottomVisible` flag).
6. **UJ10 + UJ11 together** (shared `bind:prompt`; store state + bound prompt +
   dangling-row cleanup + row styling + auto-resize + draft KV).
7. **UJ7b** (the only loop-touching phase; do last so the rename lands first and
   the usage line renders inside the already-renamed console).

---

## Risks / edge cases

- **UJ7b SDK field name:** the `finish` part's usage field may be `usage` or
  `totalUsage` depending on AI SDK version. Read defensively
  (`p.usage ?? p.totalUsage`) and confirm in `loop.test.ts` with the version
  pinned in `package.json`.
- **UJ9 mermaid race:** the copy pass runs before mermaid's async SVG swap, so
  the `language-mermaid` skip is **required** (not optional) — without it a copy
  button is injected into a `<pre>` that then gets `replaceWith`'d, leaving a
  dangling listener. Idempotency guard prevents double-inject on re-render.
- **UJ10/UJ11 draft-vs-retry:** both write the bound `composerPrompt`. They never
  fire together (restore runs in `loadAll` on navigation; retry runs on click), so
  no clobber. The save `$effect` re-saving the restored value is harmless.
- **UJ10 abort semantics:** abort leaves `error === null`, so the finally clears
  `lastFailedPrompt` — correct (abort is intentional, not a failure; no Retry,
  no red border). Verified in the test gate.
- **UJ10 dangling-row delete:** only deletes a *trailing* user row (no following
  assistant/tool). A healthy thread whose last message is a legitimate user
  message (rare — usually an assistant replies) would be a false positive, but
  the failed-turn marker (`failedMessageId`) only lights when `error` **and**
  `lastFailedPrompt` are both set, so `deleteLastDanglingUser` is only ever
  called from `onRetry` in a genuine failure context.
- **UJ6 `memory` runtime:** surfaced as "Web" so the label is never "Memory";
  the raw `dbStatus.runtime` value is unchanged for diagnostics (`DbStatus`
  badge / console still see the truth).

## Verified anchors (line refs confirmed 2026-07-05)

- `AppShell.svelte`: runtime token `:114` (mobile sheet footer).
- `Sidebar.svelte`: runtime token `:75` (desktop footer, `{#if !collapsed}`).
- `db.svelte.ts`: `DbRuntime` `:2`, `dbStatus` `:22` (physical `.ts`; `.js` import
  alias resolves via bundler).
- `chat/[id]/+page.svelte`: lucide import `:5-13` (Wrench `:11`); diag toggle
  `:465-473`; `viewport` `:71`, `bottomVisible` `:76`, auto-scroll `$effect`
  `:96-102`, scroll/RO `$effect` `:104-143` (`updateVisibility` `:89-94`);
  `middleWrapper` bind `:560` (container `:558-602`), top fade `:590-595`, bottom
  fade `:596-601`; chat error card `:613-626` (Missing-key special-case
  `:620-624`); Composer call `:676-684`; DiagnosticsPanel call `:737` (no title);
  `onCopy` `:358-360`; `loadAll` `:214-233` (`chatStore.load` `:221`).
- `Composer.svelte`: props `:16-32`, `prompt` `$state` `:34`, `sendChip` `:61-64`,
  `send` `:66-71`, composer row `:91`, provider chip `:92-94`, textarea `:95-101`.
- `MessageRow.svelte`: Branch button `:87-95` (title `:91`, label `:94`), user
  bubble `:104-109`.
- `MessageList.svelte`: `<MessageRow>` render `:56-60` (call `:58`), props
  `:12-37`.
- `ContextMenu.svelte`: Expound action `:85-87` (label `:86`).
- `ExpoundPromptConstructor.svelte`: header `:82-93` (`<h3>` `:83`), excerpt
  preview `:95`.
- `Markdown.svelte`: mermaid onMount `:26-53`, enhance `$effect` `:55-77`,
  `pre` rule `:166-173`, `pre code` `:174-179`, `.md-focusable-btn` `:238-262`.
- `LabRunner.svelte`: import `:2`, diag toggle `:34-42`, panel call `:91`.
- `QuizRunner.svelte`: import `:2`, diag toggle `:35-43`, panel call `:151`.
- `DiagnosticsPanel.svelte`: `title` prop `:9-19`, header template `:160`,
  "In-flight turn" section `:192-235`.
- `diagnostics.svelte.ts`: `liveEvents` `:7`, `liveEmit` `:31-33`, `endTurn`
  `:35-37` (clears live events — UJ7b relies on this).
- `loop.ts`: `consumeStream` `:73-103` (finish part `:96-97`), single call site
  `:247-260`; critic inline stream `:126-143` (separate, no `consumeStream`).
- `trace.ts`: `TraceEvent` union `:1-14`, `TraceBuilder.emit` `:104-216`,
  `toJSON` `:218-230` (no usage field — UJ7b stays live-only).
- `chat.svelte.ts`: `error` `:74`, `send` `:168-347` (`prompt=text.trim()` `:169`,
  user-row persist `:193`, catch `:312-319`, finally `:320-346`), `ExcerptOverlapError`
  `:60-64`, `deleteChat` `:375-380`, `deleteBranch` `:382-388`.
- `repos`: `settings.get/set/delete` `settings.ts:17/27/38`;
  `messages.delete` `messages.ts:89`.
