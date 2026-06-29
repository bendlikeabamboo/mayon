# AG4 — Deterministic tools + consent

**Source of truth:** `refinement/agentic-capabilities.md` (design, decisions #1–12
locked) and `refinement/agentic-capabilities-phased.md` §AG4. Treat those as
authoritative; this is the implementation-ready breakdown grounded in the shipped
AG1–AG3 code.

**Prerequisite:** AG3 is shipped — `runAgentTurn` (`src/lib/agent/loop.ts`) runs the
live agent loop; readonly tools auto-run silently; the critic auto-fixes; the four
readonly tools are registered in `registry.ts`; `messagesRepo.appendToolResult`
exists; `toCoreMessages(ctx)` round-trips tool rows live; `ActiveProvider.config.
toolCapability` is resolved. The shipped loop dispatches tool-calls **sequentially
and auto-runs all of them** (`loop.ts:220-251`); `buildSdkTools` sends `readonly`
only (`loop.ts:45-56`); `AgentTurnDeps` has **no** `requestApproval`/`notifyLowRisk`.

**No schema migration this phase.** No `db:generate` / `bundle:migrations`. All new
tools reuse existing `repos.*`. The approval state is ephemeral (in-memory store
state), never persisted.

## Goal

The model can **act** on the learner's behalf via reversible / cheap deterministic
tools and **asks before** anything that changes artifacts. `branch_chat`,
`save_brief` (folds `edit_brief`), `draft_lab_skeleton` / `draft_quiz_outline`, and
`toggle_checklist_item` go live behind an inline-stacked approval surface. On an
incapable provider (or tools disabled) the loop is unchanged from AG3.

## Resolved decisions (for this phase)

| # | Decision | Resolution |
| - | -------- | ---------- |
| 1 | Approval surfacing (decision #6) | **Stack all high-risk cards at once.** Within one tool-calls iteration, all high-risk `requestApproval` calls fire together and are awaited via `Promise.all` (each card independent: approve one, decline another). Readonly + low tools auto-run on a **parallel track that never waits on approvals**. Approved high-risk tools run sequentially in emitted order so results are deterministic. |
| 2 | Low-risk confirmation | **New toast store + `<Toaster>`.** `src/lib/stores/toasts.svelte.ts` (small runes store: `push({title, description?, actionLink?})` with auto-dismiss) + `src/lib/components/Toaster.svelte` mounted once in `AppShell.svelte`. Decoupled from the chat route; reusable. |
| 3 | Navigation | **No standalone `navigate_to`.** `branch_chat` creates + reports the child chat; no mid-loop `goto`. Navigation is via a link rendered on the tool-result row (the existing "Branches from here" chip list is not reactive mid-turn). |
| 4 | `insert_note` | **Deferred.** Needs a real notes/pin concept (schema-bearing) — out of scope to keep AG4 migration-free. |
| 5 | `save_brief` vs `edit_brief` | **One tool `save_brief` (upsert).** `edit_brief` is the same handler (different framing); registering both doubles manifest tokens with no behavior gain. Note the consolidation. |
| 6 | Dispatch / abort semantics | **Risk-tiered concurrent dispatch that preserves AG3 behavior.** Auto-track (readonly+low) stays **sequential** in emitted order so AG3's abort-mid-tool-run synthesis is unchanged; high-track surfaces cards concurrently. Every emitted tool-call gets a persisted tool-result (no orphaned tool-call rows), even on decline/abort. |
| 7 | Tool-result row rendering | **Hide empty assistant tool-call rows; show tool-result rows compactly.** `MessageRow` skips `role:'assistant'` rows where `toolCallId != null && content === ''` (bookkeeping). `role:'tool'` rows parse `metadata`; if it carries `artifact:{kind,id}`, render the summary as a link. (Render-only; data unchanged.) |

## Ordered task list

### Task 1 — Risk-tiered concurrent dispatch in the loop
**Modify:** `src/lib/agent/loop.ts`

Add two DI callbacks to `AgentTurnDeps`:
```ts
requestApproval: (req: {
  toolCallId: string;
  toolName: string;
  description: string;
  args: unknown;
}) => Promise<{ approved: boolean; aborted?: boolean }>;
notifyLowRisk: (toolLabel: string, summary: string) => void;
```

Replace the sequential dispatch block (`loop.ts:220-251`) with risk-tiered
concurrent dispatch. After collecting `toolCalls` for the iteration:

1. **Persist all assistant tool-call rows up front**, in emitted order
   (`appendAssistantToolCall` per call) — the model emitted them as one logical
   set; this is required for concurrent high-risk cards.
2. Partition by risk via a new `getToolDefinition(id)` registry helper: `auto =
   [readonly, low]`, `high = [high]`. Unknown tool → result `{ok:false,
   summary:'unknown tool: <name>'}` (no throw).
3. Run two tracks in parallel: `const [autoResults, highResults] = await
   Promise.all([autoTrack(), highTrack()])`.
   - **autoTrack** (sequential, emitted order — preserves AG3 abort behavior):
     before each tool, if `signal.aborted` push an aborted result and `break`;
     else `runTool` → for `low` call `deps.notifyLowRisk(label, r.summary)`
     afterwards; `readonly` silent. (`runTool` = `toolsRun(name, args, ctx)` with
     the same `budget:{subCalls:0,maxSubCalls:1}` ctx as AG3.)
   - **highTrack**: `const decisions = await Promise.all(high.map(tc =>
     deps.requestApproval({toolCallId, toolName, description:def.description,
     args:tc.args})))` — **all cards surface at once**. Then run approved tools
     **sequentially in emitted order**: before each, if `signal.aborted` → aborted
     result; if `!decisions[i].approved` → `{ok:false, summary:'user declined'}`;
     else `runTool`. (Decline is non-fatal; the model is told via preamble + the
     tool-result to acknowledge, not re-spam.)
4. Merge results back in **emitted order**, then persist one tool-result row per
   call (`appendToolResult`) — guarantees every tool-call row has a matching
   tool-result (no orphans, incl. decline/abort).
5. `buf = ''` and loop (unchanged).

Update `buildSdkTools(enabled)` to send **all non-generative** registered tools
(replace `if (def.risk !== 'readonly') continue` with `if (def.generative)
continue`). No generative tools are registered yet (AG5), so the guard is
forward-looking. `tool()` definitions still carry **no `execute`** (we dispatch).

The critic, safety-net, exhaustion-note, and abort/partial-persistence paths are
unchanged. `MAX_ITERATIONS` (6) still bounds re-spam on decline.

### Task 2 — Registry helper + deterministic tools
**Modify:** `src/lib/agent/registry.ts`
- Add `export function getToolDefinition(id: string): ToolDefinition | undefined`
  (used by the loop for risk lookup).
- Import the new `deterministic-tools.ts` (below) for its side-effect
  registrations, at the bottom of the file (peer of the inline readonly tools).

**New file:** `src/lib/agent/deterministic-tools.ts` — registers the 6 tools via
`registerTool`. Each handler validates args and returns `{ok:false, summary}`
on bad input (never throws into the turn; `toolsRun` also wraps). Each reuses
`repos.*` only (never `db`).

- **`branch_chat`** (`risk:'high'`, `generative:false`), params
  `{ topic?: string }`. Resolve the last message in the chat
  (`repos.messages.listByChat(ctx.chatId)` → last), then
  `repos.chats.createChild({ parentId: ctx.chatId, branchPointMessageId:
  last.id, title: topic?.trim() || 'Deeper dive' })`. Summary
  ``Branched "<title>"``; `detail = { artifact: { kind:'chat', id: childId } }`.
  No auto-navigate (decision #3).
- **`save_brief`** (`risk:'high'`), params `{ goal: string, context?, level?,
  mode?, scope? }` (a `LearningBrief`). Validate non-empty `goal` → else
  `{ok:false,'missing goal'}`. Read existing root brief via
  `parseBrief((await repos.chats.getById(ctx.rootChatId)).brief)`; merge
  (explicit args override; fill from existing/default); `repos.chats.updateBrief
  (ctx.rootChatId, merged)`. Summary via `summarizeBrief(merged)`; `detail =
  { brief: merged }`. (Acts on the tree root — brief is a tree-level concept;
  branches inherit it. Decision #11 nuance, flagged.)
- **`draft_lab_skeleton`** (`risk:'low'`), params `{ topic?: string }`. **No LLM
  call.** Read root brief → `strategyForBrief`; emit a deterministic markdown
  scaffold (Objective, Prerequisites, Setup, N Steps from the strategy's unit
  count, Checkpoint, Reflection) seeded by `topic`. Summary
  ``Drafted a lab skeleton (N sections)``; `detail = { markdown }`.
- **`draft_quiz_outline`** (`risk:'low'`), params `{ topic?: string,
  questionCount?: number }`. Symmetric deterministic outline (topics + question
  types). `detail = { markdown }`.
- **`toggle_checklist_item`** (`risk:'low'`), params `{ labId: string, itemId:
  string }`. `const next = await repos.labs.toggleChecklistItem(labId, itemId)`;
  `null` → `{ok:false,'lab/item not found'}`. Summary includes the toggled step
  text + new state; `detail = { checklist: next }`.

> **`draft_*` value flag:** deterministic scaffolds are the lowest-value tools
> here (the model could emit a skeleton in prose). They are in-scope per the
> design ("propose structure only, no nested LLM call") and are low-risk /
> reversible / trivially removable (one registry entry each). If they prove
> noisy in dogfooding, drop them without touching anything else.

### Task 3 — Capabilities preamble
**Modify:** `src/lib/chat/brief.ts`
- Extend `buildCapabilitiesPreamble()` (currently inspection-only) to also state
  that the tutor can **act** — offer to branch a deeper dive, adjust the brief,
  draft a lab/quiz skeleton, toggle a checklist step — and that it **will ask
  before** creating or changing artifacts, prefers continuing the lesson over
  invoking tools, and **does not re-request** an action the learner declined.
  Keep it ~5–6 lines; still a pure string appended only when `toolCapability`
  is true (degraded providers omitted entirely → today's behavior).

### Task 4 — Toast store + Toaster
**New file:** `src/lib/stores/toasts.svelte.ts` — small runes singleton mirroring
`theme.svelte.ts`. `toasts = $state<Toast[]>([])`; `push(t)` appends and schedules
auto-dismiss (e.g. 5s) via `setTimeout`; `dismiss(id)`; `clear()`. `Toast = { id,
title, description?, action?: { label, href } }` (an optional link serves
artifact-creating confirmations). No persistence.
**New file:** `src/lib/components/Toaster.svelte` — fixed bottom-right stack;
each toast renders title/description + optional link + dismiss `×`. Auto-dismiss
handled by the store.
**Modify:** `src/lib/components/AppShell.svelte` — render `<Toaster />` once (after
`<main>`).

### Task 5 — Approval surface (store + component + route)
**Modify:** `src/lib/stores/chat.svelte.ts`
- Add reactive state `pendingApprovals = $state<ApprovalEntry[]>([])` where
  `ApprovalEntry = { toolCallId, toolName, description, args }` plus a private
  `resolve` promise hook.
- `private requestApprovalImpl(req): Promise<ApprovalDecision>`: push an entry,
  return a new Promise whose `resolve` is captured on the entry; register a
  one-shot `this.controller.signal` abort listener that resolves
  `{ approved:false, aborted:true }` (so mid-approval `Stop` never orphans a
  card).
- `approve(toolCallId)` / `decline(toolCallId)`: find the entry, call its
  `resolve({approved:true|false})`, remove it from `pendingApprovals`.
- `private notifyLowRiskImpl(toolLabel, summary)`: `toasts.push({ title: toolLabel,
  description: summary })`.
- Wire the two new deps into the `runAgentTurn({...})` call (alongside the
  existing AG3 deps).
- **Drain on end/abort:** in `send`'s `finally`, resolve any still-pending
  approvals as `{approved:false, aborted:true}` and clear `pendingApprovals`
  (safety net for errors/aborts mid-dispatch).
- **Brief-chip refresh:** after a `save_brief` tool result, if the affected root
  is the current chat, refresh `chatStore.chat.brief` so the collapsed chip
  updates without a reload. (Detect via the tool result's `toolName` in the
  `appendToolResult` callback, or a small `notifyToolResult` hook; keep minimal.)

**New file:** `src/lib/components/chat/ApprovalCard.svelte` — props
`{ entry, onApprove, onDecline }`; shows tool `description` + a compact,
read-only rendering of parsed `args` (JSON pretty-printed, scrollable if large)
+ Approve / Decline buttons. Pure presentational; logic lives in the store.

**Modify:** `src/routes/chat/[id]/+page.svelte` — between `<MessageList>` and the
error/composer region, render `{#each chatStore.pendingApprovals as a (a.
toolCallId)}<ApprovalCard entry={a} onApprove={() => chatStore.approve(a.
toolCallId)} onDecline={() => chatStore.decline(a.toolCallId)} />{/each}`. Cards
render in insertion (emitted) order; each is independent.

### Task 6 — Tool-row render polish
**Modify:** `src/lib/components/chat/MessageRow.svelte`
- Skip rendering rows where `message.role === 'assistant' && message.toolCallId !=
  null && message.content === ''` (pure tool-call bookkeeping; empty "Assistant"
  bubbles are noise once tools act).
- For `message.role === 'tool'`: render compactly (muted "Tool" label + summary).
  Parse `message.metadata`; if it parses to an object with `artifact:{kind,id}`,
  render the summary as a link (`/chat|/lab|/quiz/<id>` by kind) — serves
  `branch_chat` now and `create_*` (AG5) later.
- No change to user/system/assistant-text rendering.

### Task 7 — Tests
Harness is **node-only** (`vite.config.ts:51`, no jsdom/testing-library) → no
component render tests; cover logic via store + loop tests, verify the card
visually.

**Modify:** `src/lib/agent/loop.test.ts` — extend the mock `getToolDefinitions`
to include low/high defs and add deps `requestApproval`/`notifyLowRisk` to
`makeDeps`. New cases:
- **(h) high approved:** `requestApproval` called with parsed args; approve →
  `toolsRun` runs; result persisted with the real summary; card request shape
  asserted.
- **(i) high declined:** `requestApproval` → `{approved:false}`; `toolsRun` **not**
  called; result `{ok:false, summary:'user declined'}` persisted; loop continues
  (next iteration emits text).
- **(j) two parallel high:** both `requestApproval` fire; approve one, decline
  other; results persisted in emitted order; only the approved one ran.
- **(k) low auto-run + toast:** `notifyLowRisk` called with the summary; no
  `requestApproval`; result persisted.
- **(l) invalid args:** tool returns `{ok:false}`; result persisted; no crash.
- **(m) abort during approval:** signal aborted while a card is pending →
  `requestApproval`'s promise resolves `{approved:false, aborted:true}` (the test
  simulates by aborting then resolving); result 'aborted'; resolves
  `{aborted:true}`; no orphaned tool-call row.
- **(n) manifest:** when enabled, `streamText` is called with `tools` containing
  the low + high defs (non-readonly); when disabled, `tools:{}`.
- **Regression:** existing (a)–(g) still pass — confirm the auto-track stays
  sequential so (b)/(c)/(d) are unchanged; the only structural change is
  tool-call rows persist up-front and results persist after `Promise.all`
  (emitted order preserved).

**Modify:** `src/lib/agent/registry.test.ts` — the "exactly 4 readonly tools"
assertion (`registry.test.ts:166`) becomes "readonly subset is exactly the 4
inspection tools"; add a count/risk assertion covering the new deterministic
tools.

**New file:** `src/lib/agent/deterministic-tools.test.ts` — over the in-memory
driver (pattern of `registry.test.ts`):
- `branch_chat` creates a child off the last message; `detail.artifact.id` is the
  child id; title falls back to 'Deeper dive'.
- `save_brief` upserts on the root and a follow-up `assembleContext` carries the
  new brief note; missing `goal` → `{ok:false}`.
- `draft_lab_skeleton` / `draft_quiz_outline` return markdown in `detail` with no
  LLM call (assert no `streamText`/`generateObject` invoked).
- `toggle_checklist_item` flips a step and returns the new state; unknown
  lab/item → `{ok:false}`.

**New file:** `src/lib/stores/toasts.svelte.test.ts` — `push` adds; auto-dismiss
removes after the timeout (`vi.useFakeTimers`); `dismiss`/`clear` work.

**Modify:** `src/lib/stores/chat.svelte.test.ts` — approval flow:
`pendingApprovals` populates during a high-risk turn (mock `streamText` +
`requestApproval`), `approve`/`decline` resolve and clear the entry; abort
mid-approval drains pending as declined.

### Task 8 — Acceptance
- `pnpm test` / `pnpm check` / `pnpm lint` clean.
- **Capable provider (e.g. Z.AI / Anthropic):** the tutor offers to branch a
  deeper dive / adjust the brief / draft a lab skeleton; the **approval card**
  appears under the streaming bubble with parsed args; **Approve** → the action
  happens (branch → result-row link to the child; brief → chip updates; draft →
  skeleton in the reply); **Decline** → the model acknowledges and continues.
- **Low-risk:** a toggle / draft auto-runs and surfaces a dismissible toast.
- **Reload** persists the tool-call/result rows; a **branch** off such a turn
  inherits them via `assembleContext`.
- **Incapable provider (tool-less Ollama / `'off'`):** chat is exactly AG3 — no
  action tools sent, no cards; buttons still work.
- **Dev:** the extended strategy-lint logs tool-call counts; the capabilities
  preamble appears only when tools are live.

## Risks / edge cases
- **Concurrent-dispatch refactor.** The loop's dispatch is restructured
  (tool-call rows persist up-front; results after `Promise.all`). The auto-track
  stays sequential so AG3 readonly abort semantics are preserved; verify (b)/(c)/(d)
  stay green and add (h)–(n).
- **`draft_*` value.** Deterministic scaffolds are the weakest tools; may be noisy.
  In-scope per design, low-risk, trivially removable. Reconsider after dogfooding.
- **Approval card has no render test.** Node-only harness; verify the card
  visually (stacking order, parsed-args display, approve/decline). Logic is
  covered by `loop.test.ts` + `chat.svelte.test.ts`.
- **`branch_chat` chip not reactive.** The "Branches from here" list isn't
  refreshed mid-turn; navigation is via the tool-result-row link (decision #3).
  Acceptable; a reactive refresh is later polish.
- **`save_brief` acts on the tree root** even from a branch (brief is tree-level;
  branches inherit it). Within decision #11's spirit (current chat's own tree);
  flagged. If a stricter scope is wanted, gate to `chatId === rootChatId`.
- **Decline re-spam.** Bounded by `maxIterations` (6) + the preamble instruction.
  No extra hard guard; acceptable per design.
- **Mid-approval abort.** The store abort-listener resolves pending approvals as
  declined; `send`'s `finally` drains any survivors. No orphaned tool-call rows
  (every emitted call gets a persisted result).
- **Tool-result row render change** (hiding empty tool-call rows, artifact links)
  touches AG3's shipped render. Render-only; persisted data is identical; verify
  a readonly-tool turn still reads sensibly.

## Out of scope (later phases)
- `insert_note` (needs a notes concept + likely a small schema) — a near-term
  follow-up phase, kept out so AG4 stays migration-free.
- Capped generative tools `create_quiz` / `create_lab` (depth-1 sub-agents) and
  the `budget.subCalls` enforcement — **AG5**.
- A standalone `navigate_to` tool and mid-loop `goto` — deferred (decision #3);
  the generative create-path navigation lands in AG5.
- `validate_*` self-check tools, cross-chat agency, multi-step plans — **AG6**
  (opt-in).
- An approval "tray" if stacking proves painful — premature (decision #6).
