# Research: Timeline UX Fixes

Phase 0 output. Every decision is grounded in a verified source location (read during `/speckit.specify` of this feature, 2026-08-20). Format: Decision → Rationale → Alternatives.

## Verified root causes (from source, not speculation)

- **RC1 — eternal spinner**: `src/lib/components/chat/rows/AssistantMessage.svelte:71` — `{#if !pending && visible}` renders the orbit spinner whenever there is visible text and not the live "pending" state. `pending` is hard-`false` for durable rows (line 53), so **every completed assistant reply, past chat, and post-reload render shows a spinning indicator**. The original pre-002 streaming block only rendered this during streaming; the guard was lost in the live/durable merge.
- **RC2 — diagnostics crash**: `src/lib/components/diagnostics/DiagnosticsPanel.svelte:534` — `{#each parsed.mcpEvents as ev (ev.kind + ev.serverId)}`. Two `mcp-lifecycle` events for the same server (connect then disconnect — normal for any reconnecting server) produce duplicate Svelte each-keys → `each_key_duplicate` crash, which takes down the whole route (panel is mounted in the chat page). The neighboring tool-results loop (line 516) already index-qualifies its key (`${tr.toolCallId}@${tri}`).
- **RC3a — persist order in the loop**: tool-carrying iterations persist in the order **text → tool call → reasoning**: `src/lib/agent/loop.ts:396-397` (`appendAssistantText(buf)`), `:405` (`appendAssistantToolCall`), `:578-581` (`appendReasoning`, only on the `allTerminal` early return) and `:588-590` (budget path). The no-tool finish path (`:372-380`) is already correct (reasoning at 373-375 before text at 380); the stream-abort path at 363-369 persists text without reasoning at all. For a `present_choices` turn (terminal tool), storage lands as `[text, choices, reasoning]`.
- **RC3b — assembly order**: `src/lib/chat/entries.ts:127-134` flushes **all unpaired tool calls at the end of the entire timeline** (after every chat row), instead of at their stored position. Combined with RC3a this produces the user's observed render: reply, reasoning, then PRESENT_CHOICES + "No Result Recorded" trailing the turn.
- **RC4a — choices never reach the offer renderer**: `entries.ts:114-117` routes `kind === 'choices'` rows into the `byToolCallId` map like tool calls, so they can only ever come back out as unpaired `ToolGroup`s rendered by `ToolActivity` (red X + "No result recorded"). The `choices → ChoicesOffer` dispatch branch in `MessageList.svelte:170` is dead code for exactly this reason.
- **RC4b — pairing key bug (production-wide)**: `entries.ts:115` keys the pairing map with `msg.id` (the row UUID), but tool results look up `byToolCallId.get(msg.toolCallId)` (`:86`). Since a tool-call row's `id` (uuid from `messagesRepo.append`) never equals its `toolCallId`, **no production tool pair ever groups**: every call flushes as an unpaired group (red X) at timeline end and every result renders as an orphan `DurableEntry` — which has **no dispatch branch in `MessageList`** (its ladder covers user/assistant/reasoning/self_corrected/asks/choices only), so orphan results are invisible. Masked by `entries.test.ts` fixtures that set `id: 'tc-1', toolCallId: 'tc-1'` — identical strings, so the tests passed while production pairing was broken.
- **Terminal classification exists**: `src/lib/agent/registry.ts` exposes `getToolDefinition(name)?.terminal` (used by the loop at `loop.ts:392-394` for `allTerminal`). `MessageList` already imports from `$lib/agent/tool-summary`, so importing the registry into the presentation layer follows existing precedent.

## D1 — Spinner guard: live-only indicator

**Decision**: In `AssistantMessage.svelte`, render the orbit spinner (label-row) and the "Thinking…" state only when `live === true`: guard becomes `live && !pending && visible` for the orbit spinner (pending already implies live). Durable rows never show either indicator.

**Rationale**: The indicator is a streaming-progress affordance; durable rows are by definition complete. One-token change, restores pre-002 semantics.

**Alternatives**: (a) Pass a `streaming` prop from the list — rejected: `live` already carries exactly this distinction. (b) Track streaming in the store and bind globally — rejected: per-item prop is the established pattern.

## D2 — Diagnostics keys: index-qualified uniqueness

**Decision**: Key the MCP events loop with the event's position included — `(ev.kind + ev.serverId + '@' + i)` — mirroring the tool-results loop's existing `${tr.toolCallId}@${tri}` pattern. Audit the panel's other keyed loops for the same class of bug; qualify any that can repeat (keep stable semantic parts first so rows keep identity where possible).

**Rationale**: Events are append-only log entries; two events may share kind+server (and even action, e.g. connect→disconnect→connect). Position is the only guaranteed distinguisher; the neighboring loop already established the convention.

**Alternatives**: (a) Timestamp in the key — rejected: not guaranteed present/unique at millisecond resolution. (b) Deduplicating events at capture — rejected: changes diagnostics semantics; the panel must show every event.

## D3 — Persist order: reasoning first, per iteration

**Decision**: In `loop.ts`, persist each iteration's reasoning **immediately after the stream completes** (right after `consumeStream` returns, before the `finishReason` branch at 372), keeping `reasoningBuf` per-iteration as-is. Remove the deferred `appendReasoning` sites (578-581 allTerminal, 588-590 budget) — now redundant. The stream-abort path (363-369) also persists reasoning before partial text, matching the existing pre-stream abort path (228-236) which is already ordered correctly. Resulting storage per iteration: `[reasoning?, text?, tool_call, tool_result]`.

**Rationale**: Reasoning streams during the iteration; persisting it at iteration end before any text/tool rows makes storage order equal chronological order and equal canonical display order (spec FR-004). Removing the deferred sites prevents double-persist when the loop continues past tool results. `allTerminal` and budget paths need no special casing anymore.

**Alternatives**: (a) Keep deferred sites and reorder at render only — rejected: spec FR-004 requires correct storage going forward; render-only leaves dishonest `ord`. (b) Persist reasoning incrementally per delta — rejected: row-per-delta churn; iteration granularity is the model's own granularity.

## D4 — Assembly repair: correct pairing, in-place groups, choices as offers

**Decision** — `entries.ts` changes:
1. **Pairing key**: set the map with `msg.toolCallId` (not `msg.id`) for `tool_call` rows. Tool results group at the result's position (existing behavior for successful pairing). Keep a separate `Set` of `toolCallId`s whose call row is `kind === 'choices'` so legacy paired results of choices offers are hidden (they fold under the offer) — the choices row itself becomes a `DurableEntry` rendered **in place** by `ChoicesOffer` (MessageList's existing branch becomes live code).
2. **Unpaired calls in place**: an unpaired non-choices `tool_call` is emitted as a `ToolGroup` with `result: null` **at the call's own position**, not flushed at the end (delete the end flush entirely).
3. **Orphan results**: a `tool_result` with no visible call (result-strictly-after-call cutoffs, e.g. branch truncation) renders as a `tool_result` `DurableEntry`; add a dispatch branch so it renders via `ToolActivity`-compatible presentation instead of vanishing (wrap as a synthetic group with `call: result-row-as-call` is hacky — instead give `ToolActivity` an optional result-only mode or render via a minimal orphan renderer; final choice in tasks, contract requires: never invisible).

**Rationale**: All three repair the same broken seam: the pairing map never worked in production (RC4b), choices were misrouted (RC4a), and end-flushing fabricated a false chronology (RC3b). Fixes are inside `assembleTimeline` — a pure function, fully testable.

**Alternatives**: (a) Fix only the key and leave end-flush — rejected: order stays wrong for aborted calls. (b) Rewrite assembly as a reduce with lookahead — rejected: minimal surgical changes to a tested function.

## D5 — Presentation-time canonical ordering for already-stored turns

**Decision**: After building the item list, run a stable within-turn reorder pass in `assembleTimeline`: split at `user_message` boundaries; within each turn, any `reasoning` entry that sits **after** an `assistant_message` with no tool activity between them is moved to immediately **before** that assistant message. The pass is a no-op for correctly-ordered turns (including all multi-iteration turns stored after D3: their reasoning already precedes its text) and only repairs the buggy `[text, reasoning]` adjacency produced by the current build (RC3a) and legacy rows can't contain separate reasoning rows at all (pre-002 reasoning is metadata on the assistant row — untouched).

**Rationale**: Spec FR-003 requires canonical display for chats already stored wrong without rewriting rows. The adjacency rule is deterministic, minimal, and cannot flatten multi-iteration turns (it never moves reasoning across a tool boundary). Chats stored after D3 never trigger it.

**Alternatives**: (a) Global kind-rank sort within turns — rejected: flattens all reasoning to the top, violating spec Story 3 scenario 2. (b) Migrating old rows' `ord` — rejected by spec (no stored-row rewrites; offsets/branches reference rows).

## D6 — Terminal tools: registry-driven honest status

**Decision**: `ToolActivity` consults `getToolDefinition(call.toolName)?.terminal === true` (import from `$lib/agent/registry`). For unpaired terminal calls: neutral presentation (no red X — use the muted tool icon, no "No result recorded" line). For unpaired non-terminal calls: keep the existing failure mark + "No result recorded" (genuine gap). Paired results keep their ok/fail marks regardless (a failed terminal-tool result still shows fail — it HAS a result).

**Rationale**: Spec FR-006/FR-007 — terminal calls ending without results are by-design, not failures; the registry is the single classification source (`present_choices` is already marked `terminal` there — the loop's `allTerminal` uses it).

**Alternatives**: (a) A UI-side list of tool names — rejected by spec FR-007. (b) Hiding terminal calls entirely — rejected: the offer's label/options must stay visible (it's the choices offer itself in the choices case; other future terminal tools still deserve a visible line).

## D7 — Regression tests: distinct ids everywhere

**Decision**: Rewrite `entries.test.ts` fixtures so `id` and `toolCallId` are always distinct strings (the current fixtures' equality is what masked RC4b). Add regressions: production-shaped pair groups correctly; choices renders as offer entry (not group); unpaired call sits at its own position; terminal call renders without failure state (component-level or presentation-mapped assertion); reorder pass fixes `[text, reasoning]` and no-ops correct order; `loop.test.ts` asserts persist order reasoning-before-text per iteration.

**Rationale**: Constitution II — every bug fix ships a regression that fails without it. The fixture-bias lesson (identical keys hid a total pairing failure) is recorded here so future fixtures never reuse synthetic key equality.

**Alternatives**: None — required.
