# Expound context-menu branching (excerpt → prompt constructor → underlined branch)

## Goal

Highlight an excerpt of an assistant reply → right-click → context menu (`Expound…`,
`Copy`). `Expound…` opens a floating **prompt constructor** (Custom Instructions textarea +
multi-select toggles: Diagrams / Comparison Tables / Code Examples + Send). On Send, build
an expound prompt, open a **new branch chat linked to that excerpt**, auto-send + auto-stream
the expanded reply, and render a persistent **underline** on the source excerpt.

Hard constraints: **one branch per excerpt** and **no overlapping excerpts** (a word can't
belong to two expounds).

## Context (what already exists — reuse, don't rebuild)

- `branchSources` table + `branchSourcesRepo` (`create`, `getByBranchChat`,
  `listBySourceMessage`) — stores `sourceMessageId`, `startChar`, `endChar`, `excerpt`,
  `branchChatId`.
- `chatStore.branchFromSelection()` — resolves raw offsets via `resolveSelectionOffsets`
  (with full-span fallback) and creates a child chat + `branch_source` row.
- `assembleContext()` — already injects the branch excerpt as a leading system note.
- `Highlighter.svelte` — owns the assistant-message container + a DOM text-walk; today shows a
  floating **"Branch from here"** button on selection.
- `MessageRow.svelte` / `MessageList.svelte` — thread `onBranchSelection` / `onBranchWhole`;
  whole-message `Branch` button stays.
- Navigation: `goto('/chat/${childId}')`; route reloads on `[id]` change.

**No schema change.** Overlap is a range condition (can't be a SQL unique index) → enforced
at the application level. One-branch-per-excerpt falls out of the same overlap check (an
exact span overlaps itself).

## Confirmed decisions

1. **Replace** the floating "Branch from here" button with the right-click context menu.
   Keep the whole-message "Branch" button.
2. **Auto-send + auto-stream**: the constructed prompt is sent as the first user message and
   the reply streams immediately on branch open.
3. **Underline via rendered DOM** (post-render text-node wrap). No `render.ts` / sanitize
   change.
4. On overlap, **disable "Expound…"** with a hint.

## New files

### `src/lib/chat/expound.ts` (pure, unit-testable)
- `export type ExpoundToggle = 'diagrams' | 'tables' | 'code';`
- `export const TOGGLE_LABELS: Record<ExpoundToggle, string> = { diagrams: 'Diagrams (prompt diagrams)', tables: 'Comparison Tables', code: 'Code Examples' };`
- `export interface ExpoundOptions { excerpt: string; customInstructions: string; toggles: ExpoundToggle[]; }`
- `export function buildExpoundPrompt(o: ExpoundOptions): string` — template:
  ```
  Summarize the current discussion.

  The user would like to expound on this excerpt:
  """
  <excerpt>
  """

  With the following instructions:
  <customInstructions.trim() || "(none provided)">

  Adding [<selected toggle labels joined by ", ">] whenever possible.
  ```
  - When `toggles` is empty, the last line reads `Adding no extra formats whenever possible.`
- `export function spansOverlap(a: {startChar:number; endChar:number}, b: {startChar:number; endChar:number}): boolean` — half-open `[start,end)` overlap: `a.startChar < b.endChar && b.startChar < a.endChar`.
- `export function selectionOverlapsExisting(sel: {startChar:number; endChar:number}, existing: {startChar:number; endChar:number}[]): boolean` — true if `sel` overlaps any entry in `existing`.

### `src/lib/chat/expound.test.ts`
- `buildExpoundPrompt`: all toggles, no toggles, custom instructions present/empty, excerpt
  embedded verbatim, ordering of toggles stable.
- `spansOverlap` / `selectionOverlapsExisting`: adjacent non-overlap (allowed), exact overlap
  (blocked), partial overlap (blocked), disjoint (allowed).

### `src/lib/components/chat/ContextMenu.svelte` (lightweight, custom)
- Props: `x: number`, `y: number`, `disabledExpound: boolean`, `disableHint?: string`,
  `onExpound: () => void`, `onCopy: () => void`, `onClose: () => void`.
- Fixed-position menu at `(x,y)` clamped to viewport; two items: `Expound…` (disabled +
  tooltip when `disabledExpound`), `Copy`.
- Closes on: outside pointerdown, `Escape`, scroll, window blur.
- Styling matches existing `border-border bg-background` chips (no new dependency; bits-ui
  available but a hand-built menu matches `Highlighter`/`CrossLinks` style).

### `src/lib/components/chat/ExpoundPromptConstructor.svelte` (floating panel)
- Props: `excerpt: string`, `x: number`, `y: number`, `onSubmit: (o: ExpoundOptions) => void`,
  `onCancel: () => void`.
- State: `customInstructions = $state('')`; `toggles = $state<Set<ExpoundToggle>>(new Set())`
  (all off by default).
- UI: read-only excerpt preview (truncated), `<textarea>` (Custom Instructions, Enter-to-send
  via ⌘/Ctrl+Enter like `Composer`), 3 toggle buttons that are **clear when off / highlighted
  (accent bg) when on**, and a `<Send>` icon button (disabled until something to send — allow
  empty instructions if ≥0 toggles, i.e. Send is always enabled since empty expound is valid).
- Clamped positioning; closes on Escape / outside click.

## Modified files

### `src/lib/components/chat/Highlighter.svelte` (biggest change)
- Remove the floating "Branch from here" button and `hasSelection` button block.
- Keep `captureSelection()` + the `textOffsetFromRange` DOM walk.
- Add `oncontextmenu` handler: if a valid non-empty selection exists inside the container,
  `e.preventDefault()` and open `ContextMenu` at `(e.clientX, e.clientY)`; otherwise let the
  native menu show.
- New props: `onExpound: (raw: string, sel: SelectionInput, opts: ExpoundOptions) => void | Promise<void>`,
  `onCopy: (text: string) => void`. (Replaces the old `onBranch`.)
- Load existing spans for this message: `$effect` calling
  `repos.branchSources.listBySourceMessage(...)` keyed to the message id (pass `messageId` as
  a new prop). Compute `disabledExpound` by resolving the live selection offsets and calling
  `selectionOverlapsExisting`.
- Own the `ExpoundPromptConstructor` mount: when the menu's `Expound…` fires (and not
  disabled), capture the selection, clear the native selection, and show the constructor at
  the menu position; on its `onSubmit` call `onExpound(raw, sel, opts)`.
- Render underline marks: a `$effect` keyed to the loaded spans + children that walks the
  container's text nodes, locates each `excerpt` (whitespace-normalized) preferring the
  occurrence nearest the stored `startChar`, and wraps it with
  `<span class="expound-mark" data-branch-chat="<branchChatId>">`. **Best-effort** (raw vs
  rendered offsets differ); acceptable as a visual hint. Re-run after streaming/mermaid
  settle (observe container mutation). Optionally make the mark clickable → `onCopy`-style
  callback is **not** required; navigation to the branch is already available via the
  "Branches from here" chips under the composer.

### `src/lib/components/chat/MessageRow.svelte`
- Replace `onBranchSelection` prop with `onExpound: (messageId, raw, sel, opts) => …` and add
  `onCopy: (text: string) => …`. Pass `messageId` into `Highlighter`. Keep `onBranchWhole`
  and the whole-message `Branch` button unchanged.

### `src/lib/components/chat/MessageList.svelte`
- Thread `onExpound` / `onCopy` in place of `onBranchSelection`.

### `src/lib/stores/chat.svelte.ts`
- Add state: `pendingPrompt = $state<string | null>(null);` + `clearPendingPrompt()`.
- Add `async createExpoundBranch(messageId, rawContent, selection, prompt): Promise<string>`:
  1. resolve offsets (reuse `resolveSelectionOffsets` + full-span fallback, as in
     `branchFromSelection`);
  2. overlap guard: `const existing = await repos.branchSources.listBySourceMessage(messageId);`
     if `selectionOverlapsExisting(resolved, existing)` → throw `new ExcerptOverlapError(...)`
     (define a small typed error class in this file) — defense-in-depth (the menu already
     disables);
  3. create child chat + branch_source (reuse private `createBranchChild`);
  4. `this.pendingPrompt = prompt;`
  5. return childId.
- Keep `branchFromSelection` / `branchFromMessage` (whole-message branch still uses the
  latter).

### `src/routes/chat/[id]/+page.svelte`
- Replace `onBranchSelection` with `onExpound(messageId, raw, sel, opts)`:
  `const prompt = buildExpoundPrompt({ excerpt: sel.excerpt, ...opts });`
  `const childId = await chatStore.createExpoundBranch(messageId, raw, sel, prompt);`
  `await goto('/chat/${childId}');`
  (wrap in try/catch for `ExcerptOverlapError` → surface `chatStore.error`-style notice).
- `onCopy(text)`: `void navigator.clipboard.writeText(text)` (best-effort).
- In `loadAll`, after `loadNav`, drain: `if (chatStore.pendingPrompt) { const p = chatStore.pendingPrompt; chatStore.clearPendingPrompt(); void chatStore.send(p); }`
  — this auto-sends + auto-streams once the branch is loaded.

### `src/app.css`
- Add global `.expound-mark` style: subtle wavy/dotted underline (e.g.
  `text-decoration: underline; text-decoration-style: dotted; text-decoration-color: var(--primary);
  text-underline-offset: 3px;`), faint accent background, `cursor: pointer;` (clickable nav is
  optional/out of scope — the branch is reachable via composer chips).

## Tests to add / extend

- `src/lib/chat/expound.test.ts` (new) — as above.
- `src/lib/stores/chat.svelte.test.ts` — extend:
  - `createExpoundBranch` records a `branch_source`, the child's `assembleContext` leads with
    the excerpt, and `pendingPrompt` equals the built prompt.
  - Overlapping selection → `createExpoundBranch` throws `ExcerptOverlapError` and creates no
    chat/`branch_source` row; exact-span re-select is treated as overlap.
  - Draining `pendingPrompt` (simulating route load) sends exactly once.
- `src/lib/chat/highlight.test.ts` — unchanged (offset mapping reused as-is).

## Risks / edge cases

- **Underline match is best-effort** (raw offsets vs rendered HTML). Mitigated by
  nearest-occurrence heuristic; failure mode is highlighting nothing or the wrong identical
  substring — non-fatal (visual hint only).
- **Auto-stream ordering**: must load the branch before `send()`. The `pendingPrompt` drain
  in `loadAll` guarantees this.
- **Overlap race**: two near-simultaneous expounds on overlapping spans — app-level check +
  the menu disables; acceptable.
- **Context-menu positioning** near viewport edges → clamp `x`/`y`.
- **Touch / no-right-click devices** → out of scope (desktop-first app per `AGENTS.md`).
- **Whole-message "Branch"** is unaffected by overlap rules (it records no `branch_source`).

## Validation / acceptance

- `pnpm test` (new expound unit tests + store tests pass).
- `pnpm check` (svelte-check clean) · `pnpm lint` (eslint + prettier).
- Manual (`pnpm dev`, http://localhost:5173):
  1. Open a chat with an assistant reply; select an excerpt → right-click → menu shows
     `Expound…` + `Copy`.
  2. `Copy` writes the selected text to the clipboard.
  3. `Expound…` → constructor: toggle e.g. Diagrams + Code Examples, add custom instructions,
     Send → a new branch chat opens, the constructed prompt appears, and the reply streams.
  4. The source excerpt now shows the underline; **reload** → underline + branch persist.
  5. Select the same (or an overlapping) excerpt again → `Expound…` is disabled with the
     overlap hint; a disjoint selection re-enables it.
  6. The new branch appears under "Branches from here" and in the breadcrumb/tree.
