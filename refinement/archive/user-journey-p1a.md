# Phased plan — User-journey audit, Wave 2a: P1 definitiveness + chat core

- **Source spec:** `refinement/2026-07-05 user-journey-audit.md` (findings A6, A4, A5, B6, B5, B3, B4).
- **Status:** Execution-ready breakdown. This file covers the **definitiveness P1s** (runtime label, dev console rename, branch/expound honesty) and the first half of the **chat-core ease-of-use P1s** (code copy, failed-send retry, composer auto-resize + draft, jump-to-latest).
- **Phase keys:** `UJ6` … `UJ12`. Each is independently shippable.
- **Conventions:** same cross-cutting rules as `user-journey-p0.md` (two runtimes, one storage seam, keys never in DB, `pnpm lint && pnpm check` before done, Vitest + manual gate per phase).
- **Prerequisite:** none of these depend on `user-journey-p0.md` landing first, though UJ8 (model chip context) and UJ12 (composer area) sit alongside UJ3/UJ2 from P0 and read best together.

## Phase dependency graph

```
UJ6  (runtime label)      ─┐
UJ7  (dev console rename)  ├─ independent; all touch different files
UJ8  (branch/expound text) │
UJ9  (code copy button)    │
UJ10 (failed-send retry)   │
UJ11 (composer resize+draft)─┘
UJ12 (jump-to-latest) ── pairs with UJ11 (both touch the composer/scroll area)
```

All seven are independent. UJ11 and UJ12 are listed adjacent because they both touch the composer/scroll region and benefit from being read (optionally implemented) together, but they do not block each other.

---

## UJ6 — Readable runtime label (A6)

> *"`AppShell.svelte:114`: `{dbStatus.runtime}` rendered at `text-muted-foreground/50` (50% opacity), unlabeled. The user has no clear sense of whether they're in the desktop or browser runtime."*

**Mechanism (decided):**
- Replace the raw `tauri`/`browser` token with a readable label ("Desktop app" / "Web"), at full opacity, in the sidebar footer.
- Keep the reactive CORS guidance (`errors.ts:48-53`) unchanged — it's already good. This phase only fixes the *proactive* signal.

**Files modified**
- `src/lib/components/AppShell.svelte`
  - Desktop sidebar footer (`:114`): replace
    `<span class="px-2 text-xs text-muted-foreground/50">{dbStatus.runtime}</span>`
    with a helper-driven label at full opacity:
    ```svelte
    <span class="px-2 text-xs text-muted-foreground">{runtimeLabel(dbStatus.runtime)}</span>
    ```
  - Add a local pure helper (or inline `$derived`):
    ```ts
    function runtimeLabel(r: DbRuntime): string {
      switch (r) {
        case 'tauri': return 'Desktop app';
        case 'browser': return 'Web';
        case 'memory': return 'Web';   // in-memory is a dev/test fallback; surface as Web to users
        case 'unknown': return '';
      }
    }
    ```
  - Import `DbRuntime` from `$lib/stores/db.svelte.js`.
- `src/lib/components/Sidebar.svelte` — check whether the desktop sidebar renders the runtime via `Sidebar` or directly in `AppShell`. Per the audit citation it's `AppShell.svelte:114` (the mobile sheet's `<aside>`); confirm the desktop `<Sidebar>` component doesn't *also* render it. If `Sidebar` has its own footer with the same token, apply the same change there. (Verify on read.)

**Decision surfaced while planning — the `memory` runtime**

`DbRuntime` includes `'memory'` (the in-memory fallback used when neither OPFS nor Tauri is available — effectively a broken-browser/dev path). Surfacing "Memory" to a user is meaningless. **Decided:** map `memory` → `"Web"` so the label is always one of "Desktop app" / "Web" / (empty while initializing). The underlying `dbStatus.runtime` value is unchanged for diagnostics.

**Optional (defer unless trivial):** a subtle contextual hint near the Anthropic provider config in Settings ("Works best in the desktop app"). This is a nice-to-have; skip in this phase unless the Settings provider card already has a description slot to drop it into without layout work.

**Tests**
- Unit-test `runtimeLabel` (pure): all four `DbRuntime` values → expected label, no empty string except `unknown`.

**Manual gate**
- `pnpm dev` (browser): sidebar footer reads "Web" at full opacity (not "browser", not 50%).
- `pnpm tauri dev` (desktop): footer reads "Desktop app".
- Theme toggle + DbStatus badge still render correctly alongside.

### UJ6 — decisions / open items
- **RESOLVED:** `memory` runtime maps to "Web" for the user-facing label.

---

## UJ7 — Rename Diagnostics → "Mayon console" + developer icon (A4)

> *"Keep the diagnostic panel but maybe name it as 'developer' or 'dev console' or 'Mayon console' and replace the tool icon with the developer icon."*

**Mechanism (decided — per the `[!NOTE]` on audit A4):**
- Keep the panel user-facing (do **not** gate behind `import.meta.env.DEV` — the user explicitly disagreed with the audit's recommendation).
- Rename the toggle: **"Mayon console"** (the user offered three options; this reads least jargony and matches the app's identity).
- Replace the `Wrench` icon with a developer/console icon. Lucide offers `Terminal` and `SquareTerminal` — **decided: `SquareTerminal`** (it's the "console/terminal" glyph and distinct from any existing icon in the app).
- Update the panel's own header/title to match (it currently takes a `title` prop like `"Diagnostics — Lab"`).

**Decision surfaced while planning — the token-usage estimate**

The audit's `[!NOTE]` also asks: *"if it's possible, let's also have an estimate of the tokens being used vs. what the model supports, presented as a toggle-able text switching between percentage (25%) and actual amount (250k/1.0M)."*

This is **not possible today** without new plumbing: `DiagnosticsPanel.svelte` (629 lines) has **zero** token/usage data — it shows messages, system prompt, reasoning, tool calls, raw output, duration, and trace kinds, but no `usage` object (prompt_tokens / completion_tokens) and no model max-context. The SDK does expose usage on finish, but it's not currently captured.

**Decided:** split this into two steps.
1. **This phase (UJ7):** rename + icon swap only. Do **not** block the honesty fix on the token feature.
2. **Token estimate → new phase `UJ7b` (this file, below):** the plumbing to capture + display usage. It's a real feature, not a rename, so it gets its own scoping. See UJ7b.

**Files modified**
- `src/lib/stores/diagnostics.svelte.ts`
  - The toggle button title/aria is set at the call sites (not the store), so no store change needed beyond confirming `toggle()` is unchanged.
- `src/routes/chat/[id]/+page.svelte` (`:441-449`)
  - Swap `<Wrench class="size-4" />` → `<SquareTerminal class="size-4" />`.
  - Change `title="Diagnostics"` / `aria-label="Diagnostics"` → `title="Mayon console"` / `aria-label="Mayon console"`.
  - Update the import: drop `Wrench`, add `SquareTerminal` from `@lucide/svelte`.
- `src/lib/components/labs/LabRunner.svelte` (`:34-42`) — same icon + label swap. Pass `title="Mayon console — Lab"` to `<DiagnosticsPanel>` (`:91`).
- `src/lib/components/quizzes/QuizRunner.svelte` (`:35-43`) — same swap. Pass `title="Mayon console — Quiz"` (`:151`).
- `src/lib/components/diagnostics/DiagnosticsPanel.svelte`
  - If it renders its own header from the `title` prop, the new titles already say "Mayon console"; no internal rename needed beyond what the call sites pass. If it has a hardcoded "Diagnostics" string anywhere, update it.

**Tests**
- None automated (presentational icon/label swap).

**Manual gate**
- `/chat/[id]`, `/lab/[id]`, `/quiz/[id]`: the console toggle is now a terminal icon titled "Mayon console"; clicking opens the same panel (renamed header). Behavior unchanged.

### UJ7 — decisions / open items
- **RESOLVED:** keep user-facing; rename to "Mayon console"; icon = `SquareTerminal`.
- **DEFERRED:** token-usage estimate → UJ7b (needs usage plumbing).

---

## UJ7b — Token-usage estimate in the Mayon console (from A4 `[!NOTE]`)

> *"An estimate of the tokens being used vs. what the model supports, toggle-able between percentage (25%) and actual amount (250k/1.0M)."*

This is gated on capturing usage data that the app does not currently persist. It is **optional** and can ship independently of UJ7.

**Mechanism (decided):**
- Capture `usage` from the SDK's `streamText`/`generateText` finish reason. The AI SDK emits a `usage` object (`{ promptTokens, completionTokens, totalTokens }`) in the final stream chunk / result. Surface it through the agent loop's `onTrace`/finish path into `diagnosticsStore` and the `agent_traces` row.
- Display in the Mayon console as a compact line: *"Context: 12.4k / 128k (10%)"* with a click-to-toggle between percentage and raw amounts.
- Max-context: resolve from a small static table keyed by model id prefix (`glm-5.2` → 128k, `gpt-4o` → 128k, `claude-3-5-sonnet` → 200k, etc.) with an "unknown" fallback. This is necessarily approximate; label it "est." in the UI. Do **not** call a provider API to get the real limit.

**Decision surfaced while planning — where usage lives**

Two storage options:
1. Add a `usage_json` column to `agent_traces` (additive migration) and read it back in the console.
2. Keep usage purely in-memory in `diagnosticsStore` (live only, not historical).

**Decided:** option 2 for this phase (in-memory, live turn only). The console already shows the *live* turn; persisting usage history is a nice-to-have but adds a migration and is not what the `[!NOTE]` asked for (it asked for a live estimate). If the user later wants per-turn usage in the trace history, upgrade to option 1 then.

**Files modified**
- `src/lib/agent/loop.ts` — on stream finish, read `result.usage` (the AI SDK's finish metadata) and emit it through the existing `onTrace` channel as a new trace event kind `{ kind: 'usage', usage }`. Confirm the SDK version exposes this; if it's on `fullStream`'s `'done'`/`'finish'` part, read it there.
- `src/lib/stores/diagnostics.svelte.ts` — hold `lastUsage: { promptTokens; completionTokens; totalTokens } | null` (live, reset per turn).
- `src/lib/ai/model-limits.ts` **(new)** — `estimateContextLimit(modelId: string | undefined): number | null` (static prefix table; returns null for unknown).
- `src/lib/components/diagnostics/DiagnosticsPanel.svelte` — render the usage line with a click-toggle (local `$state<'pct' | 'raw'>`). Hide the line when `lastUsage` is null or the limit is unknown.

**Tests** (Vitest)
- `estimateContextLimit` for known prefixes → expected cap; unknown → null.
- (If the loop's usage emit is unit-testable with a mock stream) the trace event fires with the expected token counts.

**Manual gate**
- Stream a reply in `/chat/[id]` → open the Mayon console → see *"Context: ~12.4k / 128k (10%)"* (est.) → click → toggles to raw. For an unknown model, the line is hidden (no misleading number).

### UJ7b — decisions / open items
- **RESOLVED:** usage is live-only (in-memory `diagnosticsStore`), not persisted. Max-context is a static prefix table, labeled "est."
- **[DECISION? — for sign-off]:** ship UJ7b in this wave, or defer to a later polish wave? **Recommendation: defer** — UJ7 (rename) is the honesty fix; UJ7b is a feature and the usage plumbing touches the agent loop, which is riskier. Land UJ7 now, slot UJ7b after the perf wave.

---

## UJ8 — Honest Branch vs Expound labeling (A5)

> *"`MessageRow.svelte:87-95`: every assistant message has a 'Branch' ghost button. `ContextMenu.svelte:86`: right-clicking shows 'Expound…'. Both create child chats. Nowhere is the distinction surfaced."*

**Mechanism (decided — per the audit's fix option 1, "rename for honesty"):**
- Rename for clarity rather than adding explainers (lower risk, no new UI surfaces):
  - The message-row button: "Branch" → **"Branch from this message"** (whole-message fork). Keep the `GitBranch` icon.
  - The context-menu action: "Expound…" → **"Branch from this text"** (focused sub-chat about the selected excerpt). Keep the `GitBranch` icon.
- Both now lead with "Branch from this …", making the parallel obvious; the noun after "this" is the distinction (the whole *message* vs the selected *text*).
- Add a one-line subtitle to the `ExpoundPromptConstructor` panel header (the floating prompt box that opens after "Branch from this text"): *"A focused sub-chat about the selected excerpt."* This is the only new copy and it lands at the moment the user is about to commit, exactly when the distinction matters.

**Files modified**
- `src/lib/components/chat/MessageRow.svelte` (`:87-95`)
  - Button label: `<GitBranch class="size-3" /> Branch` → `<GitBranch class="size-3" /> Branch from this message`.
  - Update `title` (`:91`) from "Branch a new chat from this whole message" → keep or shorten; the label now says it.
- `src/lib/components/chat/ContextMenu.svelte` (`:86`)
  - Action label: "Expound…" → "Branch from this text".
- `src/lib/components/chat/ExpoundPromptConstructor.svelte`
  - Add a subtitle line under the existing header: *"A focused sub-chat about the selected excerpt."*
- **Do not** rename internal symbols (`createExpoundBranch`, `ExpoundOptions`, `branch_sources`, etc.) — those are implementation names; only user-facing strings change.

**Tests**
- None automated (string changes). The `ExcerptOverlapError` message in `chat.svelte.ts:60-64` is an error string, not a button label — leave it.

**Manual gate**
- `/chat/[id]`: assistant message shows "Branch from this message"; selecting text + right-click shows "Branch from this text"; opening the constructor shows the new subtitle. Both still create the correct kind of child chat (regression: whole-message branch has no `branch_source` row; text branch does).

### UJ8 — decisions / open items
- **RESOLVED:** rename (audit fix option 1), not explainers. "Branch from this message" / "Branch from this text" + a constructor subtitle.

---

## UJ9 — Copy button on code blocks (B6)

> *"`Markdown.svelte:159-178` styles `<pre>/<code>` but adds no copy button. In a learning app where runnable code is a first-class output, this is a notable gap."*

**Mechanism (decided):**
- A small copy button (top-right of each `<pre>`), fading in on hover, that copies the code text to the clipboard.
- Implemented as a post-render DOM enhancement in `Markdown.svelte` (same pattern as the existing mermaid post-processing at `:26-53` and the external-link enhancement at `:55-77`): after the sanitized HTML is in the container, query all `<pre>` elements, inject a button, wire `navigator.clipboard.writeText(codeText)`.
- A button-injected approach (rather than a Svelte component per block) keeps the single `{@html}` render path and avoids re-architecting markdown rendering.

**Files modified**
- `src/lib/components/chat/Markdown.svelte`
  - In the existing `$effect` (`:55-77`) that enhances links/tables, add a pass over `container.querySelectorAll('pre')`:
    - For each `<pre>` without an existing copy button (idempotency guard), inject a `<button class="md-copy-btn">` positioned top-right (CSS absolute within a relatively-positioned wrapper — or use the existing `.md-focusable-btn` sticky pattern at `:238-262` as a model).
    - On click: read `pre.textContent` (the code, without the button's own text), `navigator.clipboard?.writeText(code)`, briefly swap the icon/label to a "Copied" state (1.5s), then revert.
  - Add CSS for `.md-copy-btn` in the `<style>` block: `position: absolute; top: …; right: …; opacity: 0; transition: opacity 0.15s;` and `.markdown-body pre:hover .md-copy-btn { opacity: 1; }`. Make `<pre>` `position: relative` (it currently isn't — add to the existing `:global(.markdown-body pre)` rule at `:166`).
- `src/lib/markdown/focusable.ts` (the `enhanceFocusable` helper) — **not** modified. Keep copy-button logic local to `Markdown.svelte` for now (it's message-render-specific). If a later phase wants copy on focusable tables too, extract then.

**Decision surfaced while planning — clipboard fallback**

`navigator.clipboard` can be undefined in non-secure contexts or older WebViews. **Decided:** guard with `?.` and, on failure, fall back to a transient `document.execCommand('copy')` via a hidden textarea — but only if it's already used elsewhere in the app. The existing `onCopy` in `chat/[id]/+page.svelte:334-336` uses plain `navigator.clipboard?.writeText` with no fallback, so for consistency **this phase uses the same one-liner with no fallback**. If clipboard is unavailable, the button is a no-op (the selection-copy path via the context menu still works). Match the existing pattern; don't over-engineer.

**Tests**
- None automated (DOM enhancement). The `renderMarkdown` pipeline already has tests; this is purely a client-side post-process.

**Manual gate**
- A chat reply with a fenced code block: hover the block → copy button fades in top-right → click → "Copied" → paste elsewhere yields the exact code. Multiple blocks each get their own button. Mermaid blocks (which get swapped to SVG) are unaffected (their `<pre>` is replaced before the copy pass, or the button is skipped for `language-mermaid` — verify and skip if needed).

### UJ9 — decisions / open items
- **RESOLVED:** button injected post-render in `Markdown.svelte`; clipboard uses `navigator.clipboard?.writeText` (no fallback, matching existing `onCopy`). Skip mermaid `<pre>` blocks.

---

## UJ10 — Failed-send retry + prompt restore (B5)

> *"`Composer.svelte:60-65`: `send()` reads `prompt`, then clears it before the async `onSend` resolves. If `chatStore.send` throws, the composer is already empty. The error card has no retry button."*

**Mechanism (decided — per the `[!NOTE]` on audit B5):**
- Don't clear `prompt` speculatively. Instead, keep a `lastPrompt` and restore it into the composer when a send fails.
- The error card for a failed chat send gets a **"Retry"** button. Clicking it restores `lastPrompt` into the composer (replacing whatever is there) and the user can edit/re-send. The user's exact words: *"if a chat failed to send, a retry button will appear for the failed chat (and also preferably a different color of the chat so the user quickly knows it failed). Once the retry button is clicked, the lastPrompt will replace whatever is in the composer."*

**Decision surfaced while planning — what "failed" means + the row color**

A failed send today persists the **user** row (`chat.svelte.ts:193`) before streaming starts, so the user's text is *not* lost from the DB — it's only lost from the composer. But there is no assistant reply, so the conversation shows a dangling user message. Two sub-decisions:

1. **The "different color of the chat" the user asked for:** this means the **last user message row** (the one whose reply failed) should get a distinct treatment so the user can see "this one didn't get a reply." **Decided:** add a `failedTurn` marker. The cleanest signal is: when `chatStore.error` is set **and** the last message is a `user` row with no following assistant/tool row, render that user row with a subtle red/left-border treatment. This is reactive and self-clears when the error clears or a retry succeeds.

2. **Retry flow:** "Retry" restores `lastPrompt` into the composer. The user then clicks Send again (we do **not** auto-resend — the user explicitly said "the lastPrompt will replace whatever is in the composer," implying they want to review/edit before re-sending). The existing dangling user row: on a successful retry, the new send appends a *second* user row (the user is re-sending). To avoid a duplicate, **decided:** on Retry, delete the dangling user row (the one with no reply) before restoring the text, so the conversation stays clean. This mirrors "edit and retry" semantics.

**Files modified**
- `src/lib/components/chat/Composer.svelte`
  - Add `let lastPrompt = $state('')`.
  - In `send()` (`:60-65`): capture `const text = prompt.trim()`; set `lastPrompt = text` **before** clearing; then `prompt = ''`. (If the send later fails, `lastPrompt` holds the text.)
  - Add an exported method or a bindable so the chat page can trigger restore. Cleanest: a bindable `restoreSignal` or a simple imperative ref. **Decided:** expose `restoreLastPrompt()` via `export function` from the component instance using a bindable ref — but Svelte 5 components don't easily expose methods. Instead, **lift `lastPrompt` to the chat page**: the Composer calls `onSend(text, effort)` and the page tracks `lastPrompt`. This keeps the Composer dumb.
  - **Revised decision:** keep `lastPrompt` in `chatStore`, not the Composer. Add `lastFailedPrompt = $state<string | null>(null)` to `ChatState`. Set it in `send()`'s `catch` (only on non-abort errors). Clear it on the next successful send. The Composer is unchanged except it no longer needs to manage this.
- `src/lib/stores/chat.svelte.ts`
  - Add `lastFailedPrompt = $state<string | null>(null)`.
  - In `send()`: on the non-abort error branch (`:312-319`), set `this.lastFailedPrompt = prompt` (the trimmed text captured at the top). On a successful finish (the `finally` when `!aborted && !this.error`), clear `this.lastFailedPrompt = null`.
  - Add `restoreFailedPrompt(): string | null` that returns and clears it (the page puts it into the Composer).
- `src/routes/chat/[id]/+page.svelte`
  - Composer: add a bindable for the prompt text so the page can write to it. Change `<Composer>` to `bind:value`-style or add a `prompt` bindable prop. **Decided:** add `prompt` as a `$bindable` on Composer (`let { prompt = $bindable(''), … }`) and bind it from the page: `<Composer bind:prompt={composerPrompt} … />`. The page holds `composerPrompt = $state('')`.
  - Error card (`:589-601`): add a **"Retry"** button (not just for Missing API key — for any non-abort error). On click: `composerPrompt = chatStore.lastFailedPrompt ?? ''` then `chatStore.lastFailedPrompt = null` then focus the textarea. The user reviews and hits Send.
  - On Retry, also delete the dangling user row: the page calls a new `chatStore.deleteLastDanglingUser()` that removes the last message if it's a `user` row with no subsequent assistant/tool row. (Implemented in the store; re-reads messages after delete.)
- `src/lib/components/chat/MessageList.svelte` / `MessageRow.svelte`
  - The "different color" for the failed-turn user row: compute `const lastRowFailed = chatStore.error && last message is user with no reply` (in the page or store) and pass a flag to `MessageRow` to add a `border-l-2 border-red-500/60` class to that user bubble. Keep it subtle.

**Tests** (Vitest, in-memory driver)
- `chatStore.send` that throws a non-abort error → `lastFailedPrompt` equals the sent text; a subsequent successful send clears it.
- `deleteLastDanglingUser` removes a trailing user row only when no assistant/tool row follows; no-op otherwise (doesn't delete a legitimate last user message in a healthy thread).

**Manual gate**
- Configure a bad key (or go offline) → send a prompt → composer clears, error card appears with **Retry**, last user bubble has a red left border. Click Retry → composer refills with the prompt, dangling row removed → fix the key → Send → reply streams, red border gone, `lastFailedPrompt` cleared.
- Abort (Stop button) does **not** set `lastFailedPrompt` (abort is intentional, not a failure).

### UJ10 — decisions / open items
- **RESOLVED:** `lastFailedPrompt` lives in `chatStore` (not the Composer); Retry restores it into a bound `prompt`; dangling user row deleted on retry; failed user row gets a subtle red left border.
- **[DECISION? — for sign-off]:** should Retry **auto-resend**, or just restore-into-composer (user hits Send)? **Recommendation: restore-into-composer** (matches the `[!NOTE]`: "the lastPrompt will replace whatever is in the composer"). Auto-resend is a one-line toggle later if desired.

---

## UJ11 — Composer auto-resize + draft persistence (B3)

> *"`Composer.svelte:86-92`: `<textarea rows="2" class="resize-none">`. Long prompts scroll inside a tiny box. `prompt` is local `$state`; navigating away loses the draft."*

**Mechanism (decided):**
- **Auto-grow:** the textarea grows with content up to a max height (~12 lines), then scrolls. Use a `$effect` that watches `prompt` and sets `textarea.style.height = 'auto'` then `= scrollHeight + 'px'`, capped.
- **Draft persistence:** persist a per-chat draft to the `settings` KV, keyed by chat id (`draft:<chatId>`), debounced on input; restore on mount. This survives navigation away and back (Settings, chat list, another chat) and a reload.

**Decision surfaced while planning — draft keying & cross-chat isolation**

Each chat has its own draft. The key is `draft:<chatId>`. The Composer today is chat-agnostic (it doesn't know the chat id). **Decided:** pass `chatId` as a prop to Composer; the restore/save `$effect`s key off it. On chat switch, the new chat's draft loads (replacing the textarea). A draft for a chat that gets deleted is orphaned in the KV — add a cleanup in `chatStore.deleteChat`/`deleteBranch` that deletes `draft:<id>` for the deleted subtree (best-effort; cheap).

**Files modified**
- `src/lib/components/chat/Composer.svelte`
  - Add `chatId: string` prop.
  - Add `let textareaEl = $state<HTMLTextAreaElement | null>(null)`.
  - Auto-grow `$effect`: watch `prompt`; if `textareaEl`, reset height to `auto`, set to `Math.min(scrollHeight, MAX_HEIGHT)`. `MAX_HEIGHT` ≈ `12 * line-height` (~22rem). When `prompt` is empty, reset to the base 2 rows.
  - Draft restore in `onMount`: `const saved = await repos.settings.get<string>('draft:' + chatId); if (saved) prompt = saved;` (only if `prompt` is currently empty — don't clobber a retry-restore).
  - Draft save: a debounced `$effect` on `prompt` (debounce ~400ms via a timeout cleared on each change) → `repos.settings.set('draft:' + chatId, prompt)` when non-empty, or `repos.settings.delete(...)` when empty.
- `src/routes/chat/[id]/+page.svelte`
  - Pass `chatId={chatStore.chat.id}` to `<Composer>` (paired with the UJ10 `bind:prompt` change — they land together).
- `src/lib/stores/chat.svelte.ts`
  - In `deleteChat` and `deleteBranch`, after the subtree delete, best-effort delete `draft:<id>` for each deleted chat id. The subtree id set is already computed by the repo delete; expose it or re-derive. **Keep it simple:** since drafts are tiny KV rows, just delete `draft:<deletedChatId>` for the directly-deleted id; orphaned drafts for deeper descendants are harmless and can be GC'd later. **Decided:** delete only the direct id's draft (cheap, covers the common case).

**Tests** (Vitest, in-memory driver)
- The settings KV round-trip: set `draft:<id>`, get it back, delete it. (Likely already covered; add if missing.)
- Composer component test is out of scope; the KV contract is the unit.

**Manual gate**
- Type a long prompt → textarea grows up to ~12 lines, then scrolls internally.
- Type a prompt, navigate to `/settings`, return to the chat → draft restored.
- Type a prompt, reload the tab → draft restored.
- Send the prompt → draft cleared (the save `$effect` fires with empty `prompt` after send and deletes the KV row).
- Delete the chat → its draft KV row is gone (inspect via a dev SQL peek or just confirm a recreated same-id chat starts empty — though ids are UUIDs, so this is effectively "no observable leak").

### UJ11 — decisions / open items
- **RESOLVED:** per-chat draft keyed `draft:<chatId>`; restore on mount (don't clobber retry-restore); debounced save; delete on send; best-effort delete on chat delete.

---

## UJ12 — "Jump to latest" during/after streaming (B4)

> *"No scroll-to-bottom during streaming; no 'jump to latest' button. During a stream the live bubble grows but the viewport does not follow."*

**Mechanism (decided — per the `[!NOTE]` on audit B4: the user does NOT want auto-follow):**

> *"I don't like auto-follow of the bottom because I read slow and when I start reading, I want to follow my own reading speed, not the token/second speed of the LLM."*

So: **no auto-follow.** Instead, a floating **"Jump to latest ↓"** button that appears when the user is scrolled up (the viewport bottom is above the content bottom), and disappears when they're at the bottom. Clicking scrolls to the bottom smoothly. This respects the user's reading speed while still offering a one-click way back.

**Decision surfaced while planning — reusing the existing scroll infrastructure**

The chat page already tracks `bottomVisible` (`chat/[id]/+page.svelte:84`, updated in the scroll handler at `:102-109`) and has fade gradients at top/bottom (`:566-577`). The auto-scroll `$effect` at `:87-93` currently fires on `chatStore.messages.length` change (new persisted message) — **keep it for the initial-scroll-on-new-message case**, but it does not fire per-token (it watches `messages.length`, not `streamBuffer`), which is exactly why the viewport doesn't follow the stream. That's the behavior the user wants to **keep** (no per-token follow).

**Decided:** add only the floating button, driven by the existing `bottomVisible` flag (inverted: show when `!bottomVisible`).

**Files modified**
- `src/routes/chat/[id]/+page.svelte`
  - In the middle-wrapper region (where the fade gradients live, `:566-578`), add a floating button anchored bottom-center, shown when `!bottomVisible`:
    ```svelte
    {#if !bottomVisible}
      <button class="jump-latest …" onclick={() => viewport?.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })}>
        <ChevronDown class="size-4" /> Jump to latest
      </button>
    {/if}
    ```
  - Position: absolute, bottom-center of the `middleWrapper`, above the fade gradient's z-index, with a pill style. Add `ChevronDown` to the lucide import.
  - The button must update `bottomVisible` correctly: the existing scroll handler already recomputes it on scroll and on resize (`:102-134`), so after the smooth scroll lands, `bottomVisible` flips true and the button hides. No new scroll wiring needed.
  - Edge: during streaming, `scrollHeight` grows; if the user is scrolled up, `bottomVisible` stays false (correct) and the button stays visible (correct). Good.
- No `MessageList` or store changes.

**Tests**
- None automated (DOM/scroll). The `bottomVisible` logic is already exercised manually.

**Manual gate**
- Stream a long reply while scrolled up (read the earlier content) → the "Jump to latest" button stays visible; the viewport does **not** auto-follow the tokens (user reads at their own pace). Click the button → smooth-scrolls to the bottom → button disappears. Scroll up again → button reappears.

### UJ12 — decisions / open items
- **RESOLVED:** no auto-follow (per `[!NOTE]`); floating "Jump to latest ↓" button driven by the existing `!bottomVisible` flag; smooth scroll on click.

---

## Decisions surfaced & made while planning (summary)

| # | Decision | Status |
|---|----------|--------|
| G | **UJ6:** `memory` runtime maps to "Web" in the user-facing label. | Decided |
| H | **UJ7:** keep the console user-facing; rename to "Mayon console"; icon = `SquareTerminal`. | Decided |
| I | **UJ7b:** token estimate is live-only (in-memory), max-context is a static prefix table labeled "est." | Decided |
| J | **UJ7b:** defer UJ7b out of this wave (it's a feature touching the agent loop; UJ7 is the honesty fix). | **[DECISION?]** — recommend defer |
| K | **UJ8:** rename (not explainers): "Branch from this message" / "Branch from this text" + a constructor subtitle. | Decided |
| L | **UJ9:** copy button injected post-render in `Markdown.svelte`; `navigator.clipboard?.writeText`, no fallback; skip mermaid blocks. | Decided |
| M | **UJ10:** `lastFailedPrompt` in `chatStore`; Retry restores into a bound `prompt` + deletes the dangling user row; failed user row gets a red left border. | Decided |
| N | **UJ10:** Retry restores-into-composer (user hits Send); no auto-resend. | **[DECISION?]** — recommend restore-into-composer |
| O | **UJ11:** per-chat draft keyed `draft:<chatId>`; debounced save; restore on mount (don't clobber retry-restore); delete on send + on chat delete. | Decided |
| P | **UJ12:** no auto-follow (per `[!NOTE]`); floating "Jump to latest ↓" button on `!bottomVisible`. | Decided |

## Verification gates (per phase)

| Phase | Automated (`pnpm test`, in-memory) | Manual (OPFS + Tauri) |
|-------|------------------------------------|------------------------|
| UJ6 | `runtimeLabel` unit | "Web" / "Desktop app" at full opacity in sidebar footer |
| UJ7 | n/a (icon/label swap) | terminal icon + "Mayon console" title on chat/lab/quiz |
| UJ7b | `estimateContextLimit` unit | (deferred) live usage line with pct/raw toggle |
| UJ8 | n/a (strings) | "Branch from this message" / "Branch from this text" + constructor subtitle; both branch kinds still correct |
| UJ9 | n/a (DOM enhancement) | hover a code block → copy button → paste yields code; mermaid unaffected |
| UJ10 | `lastFailedPrompt` set/clear; `deleteLastDanglingUser` | failed send → red border + Retry → restores prompt, removes dangling row → re-send succeeds |
| UJ11 | settings KV draft round-trip | textarea auto-grows; draft survives nav + reload; cleared on send |
| UJ12 | n/a (scroll DOM) | scroll up during stream → no follow, "Jump to latest" visible → click → smooth to bottom |

## Suggested order of work

1. **UJ6** (one helper + two lines; fastest definitiveness win).
2. **UJ8** (string renames + one subtitle; low risk, high clarity).
3. **UJ9** (self-contained DOM enhancement in `Markdown.svelte`).
4. **UJ7** (icon/label swap across three call sites; mechanical).
5. **UJ12** (one floating button, reuses existing scroll flag).
6. **UJ11** (composer auto-resize + draft; touches Composer + store + KV).
7. **UJ10** (failed-send retry; the most involved — store state + bound prompt + dangling-row cleanup + row styling; do last in this wave).
8. **UJ7b** (token estimate) — only if not deferred.

## Needs sign-off

- **J** — defer UJ7b (token estimate) out of this wave (recommend: defer).
- **N** — Retry = restore-into-composer vs auto-resend (recommend: restore-into-composer).
