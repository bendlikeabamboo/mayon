# Chat UX Fixes: Approve/Deny card, auto-send goal, expound card

Three independent UX fixes to the chat flow, each resolving a user-reported issue.
They share a small refactor to `chatStore.pendingPrompt` (gains an optional
`hidden` flag), so #2 and #3 should land together after #1.

## Background / root causes

- **#1 (Approve/Deny card on first chat):** `save_brief` is in the tool manifest
  whenever tools are enabled (`src/lib/agent/capability.ts`). The capabilities
  preamble (`src/lib/chat/brief.ts:239`) invites the model to "adjust the
  learning brief." On a chat already briefed via the intake form, the model
  re-calls `save_brief` → it is `risk: 'high'`
  (`src/lib/agent/deterministic-tools.ts:55`) → the high-risk gate
  (`src/lib/agent/loop.ts:301-308`) blocks the turn on `ApprovalCard`
  (`src/lib/stores/chat.svelte.ts:440`) → on Approve a redundant brief is merged
  → the brief summary chip appears at the top of the view
  (`src/routes/chat/[id]/+page.svelte:393`). `save_brief` is redundant with the
  intake form and the inferred-brief flow; only `goal` matters to it.
- **#2 (no auto-send after the brief form):** Saving a brief never sends a
  message (`/chat/+page.svelte:29` `onSaveBrief`; `[id]/+page.svelte:296`
  `onSaveIntakeBrief`). The `pendingPrompt` + `loadAll` drain mechanism already
  exists (`[id]/+page.svelte:206`) and can carry the goal.
- **#3 (expound prompt shows as a chat bubble):** `buildExpoundPrompt`
  (`src/lib/chat/expound.ts:40`) builds the verbose "Summarize the current
  discussion…" text; it is staged as `pendingPrompt`, sent as the first user
  message, and rendered as a normal "You" bubble by `MessageRow`. Today
  `branch_sources` stores the excerpt + offsets but NOT the custom instructions
  or format toggles — they are lost after `buildExpoundPrompt` runs.

## Decisions (all resolved)

- **#1:** prompt rewrite + hard-hide `save_brief` from the tool manifest when the
  root already has a brief. Compute the check in `chatStore.send()`. The Approve/
  Deny card is KEPT for `branch_chat`, `create_quiz`, `create_lab`.
- **#2:** auto-send the **verbatim goal**; **first-turn only** (no auto-send on
  brief edit). Brief-less / "Just start chatting" roots are NOT auto-sent — wait
  for the user (the inferred-brief "Heard:" flow still backstops them).
- **#3:** hidden first message + card (model behavior unchanged); new
  `branch_sources` columns for instructions/formats; deep-link to the excerpt on
  the parent.

---

## #1 — Kill the first-chat Approve/Deny card (scoped to `save_brief`)

### 1a. Prompt rewrite (soft)
- File: `src/lib/chat/brief.ts`, `buildCapabilitiesPreamble()` (line ~239).
- Replace the `save_brief`-related guidance so it states, clearly:
  - Call `save_brief` **only on the first turn, only when no learning goal has
    been set yet** (i.e. a brief-less "Just start chatting" chat).
  - Pass **only** the `goal`; leave `level`, `mode`, `scope`, `context` unset —
    they have sensible defaults and are not important.
  - **Never rewrite an existing goal** or re-save a brief that already has one.
- Keep the rest of the preamble (other tools, approval wording for the remaining
  high-risk tools) intact.
- No content test currently exists for this preamble, so rewriting is safe; ADD a
  content assertion test (see validation).

### 1b. Hard guarantee — hide `save_brief` from the manifest when briefed
- File: `src/lib/agent/loop.ts`:
  - Add optional `disabledToolIds?: string[]` to `AgentTurnDeps` (line ~16).
  - In `buildSdkTools(enabled)` (line ~58), filter out any id in
    `deps.disabledToolIds`.
  - In the `toolNames` trace array (line ~190), apply the same filter so traces
    stay accurate.
  - The filter must be backward-compatible: missing/empty `disabledToolIds` → no
    filtering (all 26 existing loop tests stay green).
- File: `src/lib/stores/chat.svelte.ts`, `send()` (line ~161):
  - At turn start, compute `rootHasBrief`. Add a small pure helper for
    testability, e.g. `disabledToolsForBrief(rootBrief: string | null): string[]`
    returning `['save_brief']` when `parseBrief(rootBrief) != null`, else `[]`.
    For a branch the root's own `brief` column is always null (branches inherit
    via `rootId`), so fetch the root once: `repos.chats.getById(this.chat.rootId)`
    and parse its `brief`. (This root read is already in the hot path via
    `assembleContext`, so cost is negligible.)
  - Pass `disabledToolIds: disabledToolsForBrief(rootBrief)` into the
    `runAgentTurn({...})` call (line ~209).

### 1c. Notes
- `save_brief` writes to `ctx.rootChatId` (`deterministic-tools.ts:82`), so the
  rule "hide when the root has a brief" is correct for branches too.
- The inferred-brief "Heard:" card and the brief summary chip are NOT removed by
  #1; they are left as-is (out of scope).

---

## #2 — Auto-send the verbatim goal as the first chat

### 2a. `pendingPrompt` gains an optional `hidden` flag
- File: `src/lib/stores/chat.svelte.ts`:
  - Change `pendingPrompt` from `string | null` to `{ text: string; hidden?: boolean } | null`.
  - Update `clearPendingPrompt()` (no change to behavior).
- File: `src/routes/chat/[id]/+page.svelte`, `loadAll()` (line ~194):
  - Drain: `const p = chatStore.pendingPrompt;` then `chatStore.send(p.text, { hidden: p.hidden })`.
  - `send()` must accept and store the `hidden` flag (see #3b).

### 2b. Path A — `/chat` list intake (`onSaveBrief`)
- File: `src/routes/chat/+page.svelte`, `onSaveBrief()` (line ~29):
  - After `const id = await chatStore.createAndNavigate({ brief });`, before
    `await goto(...)`, set `chatStore.pendingPrompt = { text: brief.goal }`.
  - `loadAll` drains it after navigation (the target root has zero messages, so
    the first-turn rule holds).

### 2c. Path B — inline intake on an empty root (`onSaveIntakeBrief`)
- File: `src/routes/chat/[id]/+page.svelte`, `onSaveIntakeBrief()` (line ~296):
  - After `await chatStore.saveBrief(brief);`, call `await chatStore.send(brief.goal);`
    directly (chat is already loaded, zero messages). No `pendingPrompt` needed.
  - `send()` already no-ops on empty input via the guard at line ~163, so a
    whitespace-only goal is safe; but the intake requires a non-empty trimmed
    goal (`canSubmit`), so this path always has a real goal.

### 2d. Untouched paths
- Brief **edit** on a chat that already has messages (`onSaveBrief` at
  `[id]/+page.svelte:291`) → NO auto-send (first-turn-only rule).
- **"Just start chatting"** skip (`onSkipBrief`, `onSkipIntake`) → brief-less
  root, no goal → NO auto-send. The inferred-brief flow remains the backstop.
- Brief-inference only runs on null-brief roots (existing behavior, covered by
  the test "briefed root does not trigger inference"), so it never competes with
  an auto-sent goal.

### 2e. Robustness note
- `pendingPrompt` is a singleton, drained only when `loadAll` runs on the target
  chat (same pre-existing pattern as the expound branch). No new cross-chat
  contamination is introduced beyond what exists today.

---

## #3 — Expound card instead of verbose prompt bubble + deep-link

### 3a. Store the expound intent in `branch_sources`
- File: `src/lib/db/schema.ts`, `branchSources` table (line ~64):
  - Add `customInstructions: text('custom_instructions')` (nullable).
  - Add `addFormats: text('add_formats')` (nullable; JSON string of the toggle
    list, e.g. `["diagrams","tables"]`).
- Run `pnpm db:generate` to create the migration, then **`pnpm bundle:migrations`**
  (required so the SPA can run it offline — see AGENTS.md).
- File: `src/lib/db/repositories/branch-sources.ts`:
  - Extend `create()` opts with `customInstructions?: string` and
    `addFormats?: string`; insert them.
  - Add a typed accessor if helpful (the existing `getByBranchChat` returns the
    full row, which now carries the new columns).
- File: `src/lib/chat/expound.ts`:
  - Keep `buildExpoundPrompt(o: ExpoundOptions)` unchanged (it still produces the
    model-facing text). Optionally add a helper `serializeAddFormats(toggles)` /
    `parseAddFormats(raw)` for the JSON column round-trip.

### 3b. Hidden first message
- File: `src/lib/stores/chat.svelte.ts`:
  - `send(text, opts?: { reasoning?; hidden? })`: when `opts.hidden`, append the
    user row with `metadata: JSON.stringify({ hidden: true })` (via
    `repos.messages.append(..., { metadata })`). Context assembly still includes
    it (model sees it); only the UI filters it.
  - `createExpoundBranch(...)`: after computing the branch, stage
    `this.pendingPrompt = { text: prompt, hidden: true }` (replacing the current
    `this.pendingPrompt = prompt`).

### 3c. Hide hidden rows from the message list
- File: `src/lib/components/chat/MessageList.svelte`:
  - Compute `visibleMessages = messages.filter(m => !isHidden(m))` where
    `isHidden(m)` parses `m.metadata` and returns true for `{hidden:true}`. Keep
    the `{#each}` and the empty-state check on `visibleMessages` (not `messages`).
  - The empty-state ("No messages yet") should still show when the only row is a
    hidden expound prompt.
- File: `src/routes/chat/[id]/+page.svelte`:
  - Pass `messages={visibleMessages}` to `MessageList` (compute it in the route,
    OR keep filtering inside `MessageList` — pick ONE place; recommend inside
    `MessageList` to keep the route simple). The live-bubble (`streaming`) logic
    is unaffected (the hidden row is the seed; the streamed reply renders
    normally).

### 3d. New `ExpoundCard.svelte`
- File: `src/lib/components/chat/ExpoundCard.svelte` (new):
  - Props: `excerpt`, `customInstructions` (string | null), `addFormats`
    (`ExpoundToggle[]` | null), `parentChatId: string`, `sourceMessageId: string`,
    `childId: string`.
  - Renders: a compact card (matches existing `border-border bg-card` styling):
    - The excerpt (quoted, truncated/expandable).
    - "Additional instructions": the custom instructions, or "(none)".
    - "Items to add": format chips (using `TOGGLE_LABELS`), or "(none)".
    - A deep-link back to the parent:
      `href="/chat/{parentChatId}#m={sourceMessageId}&b={childId}"`, styled as a
      button/link (reuse `<Button variant="outline">`).
- File: `src/routes/chat/[id]/+page.svelte`:
  - In `loadNav(chat)` (line ~171), also load
    `const branchSource = await repos.branchSources.getByBranchChat(chat.id);`
    and keep it in component state (e.g. `let branchSource = $state(...)`).
  - In the topPane (near the brief chip area, lines ~382-461), add a branch:
    `{#if chatStore.chat?.parentId !== null && branchSource}` → render
    `<ExpoundCard ... />` with the parsed fields. Parse `addFormats` JSON and map
    to `ExpoundToggle[]` defensively (ignore unknown values).

### 3e. Deep-link to the excerpt on the parent
- File: `src/lib/components/chat/MessageList.svelte` (or `MessageRow.svelte`):
  - Anchor each rendered row with `id="msg-{message.id}"`.
- File: `src/routes/chat/[id]/+page.svelte`:
  - On mount / chat load, parse `location.hash` for `m=` (source message id) and
    `b=` (branch child id). If `m=` is present:
    - After messages render, find the element `#msg-{m}` and
      `scrollIntoView({ block: 'center' })`.
      - Guard the existing auto-bottom-scroll `$effect` (lines ~83-88) so it does
        not override a hash-driven scroll on the first render. Track a flag like
        `let scrolledToHash = $state(false)` set when a hash scroll runs; the
        bottom-scroll effect skips when `scrolledToHash` is true and not yet
        "released" (release on the next user scroll, or simply skip for the first
        layout pass).
    - Flash the matching `.expound-mark[data-branch-chat="{b}"]` element via a
      transient CSS pulse (e.g. add a class that animates `background-color`,
      removed after ~1.5s). This is best-effort: the underline wrap happens in
      `Highlighter.renderUnderlines()` after DOM mutation, so retry briefly
      (e.g. a couple of `requestAnimationFrame` checks) before giving up.
- Note: excerpt-level offset precision (scrolling to the exact char span within a
  message) is NOT required; scrolling to the message + flashing the underline is
  sufficient and matches the "go back to the parent" intent.

---

## Failure modes
- **No provider configured** (for #2/#3 auto-send): the existing `send()` error
  path surfaces the "Missing API key" card with an "Open Settings" link
  (`[id]/+page.svelte:509`). Acceptable.
- **Hash handling:** SvelteKit does not manage `#` fragments by default, so read
  `window.location.hash` on mount/chat-load manually. If the target message id no
  longer exists (deleted), the scroll silently no-ops.
- **Excerpt flash timing:** the `.expound-mark` wrap is async/best-effort; if it
  never resolves, the link still scrolls to the message — graceful degradation.
- **Migration safety:** the two new columns are nullable, so old `branch_sources`
  rows get `null` and the card renders "(none)" for the new fields — no breakage.

## Validation
- `pnpm test`:
  - Loop: a manifest-filtering test proving `disabledToolIds` excludes a tool id
    from both the SDK tools object and the trace `toolNames` (generic, not tied
    to `save_brief`).
  - `disabledToolsForBrief` helper unit test (briefed → `['save_brief']`;
    null-brief → `[]`).
  - Content assertion on the rewritten `buildCapabilitiesPreamble` (asserts the
    new save_brief wording; asserts it no longer encourages rewriting an existing
    brief).
  - `MessageList`/route: a hidden user row is filtered out of render and out of
    the empty-state check.
  - `branch_sources`: round-trip of `customInstructions` + `addFormats` through
    `create()`/`getByBranchChat()`.
- `pnpm check` (svelte-check) + `pnpm lint` (ESLint + Prettier `--check`).
- Manual gates:
  - #1: create a chat via the intake form (goal filled) → send first message →
    NO Approve/Deny card, NO change to the brief chip. Then a brief-less "Just
    start chatting" chat → `save_brief` MAY legitimately appear (goal-only) and
    that is acceptable.
  - #2: fill the brief form on both intakes → the verbatim goal auto-sends as
    turn 1 and a reply streams. Click "Just start chatting" → nothing auto-sends;
    the inferred-brief "Heard:" card may appear on the first typed message.
  - #3: select an excerpt → Expound → fill instructions + toggles → Send. The new
    branch shows an `ExpoundCard` (excerpt, instructions, format chips, parent
    link) with NO verbose prompt bubble. Click the parent link → the parent chat
    scrolls to the message and the excerpt underline flashes.

## Out of scope
- Removing the brief summary chip at the top (it remains the edit affordance).
- Removing the inferred-brief "Heard:" card.
- Replacing the remaining high-risk Approve/Deny card (`branch_chat`,
  `create_quiz`, `create_lab`) — kept intentionally.
- Making `save_brief`-vs-inferredBrief non-redundant on brief-less chats
  (pre-existing redundancy, untouched).
