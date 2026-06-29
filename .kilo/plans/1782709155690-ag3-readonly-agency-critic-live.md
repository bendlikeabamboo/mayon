# AG3 — Read-only agency + critic live

**Source of truth:** `refinement/agentic-capabilities.md` (design, decisions #1–12
locked) and `refinement/agentic-capabilities-phased.md` §AG3. Treat those as
authoritative; this is the implementation-ready breakdown grounded in the shipped
AG1 + AG2 code.

**Prerequisite:** AG2 is shipped — `src/lib/agent/{registry,capability,critic}.ts`
exist with tests; the `messages` tool-call migration (`role:'tool'`,
`toolCallId`/`toolName`/`metadata`) is applied; `messagesRepo.appendToolResult`
exists; `toCoreMessages(ctx)` is built (tested synthetically, **not yet wired
live**); `ActiveProvider.toolCapability: boolean` is resolved by
`resolveToolCapability(config)`; the four readonly inspection tools
(`read_checklist` / `list_artifacts` / `read_artifact` / `summarize_progress`)
are registered with real `repos.*` impls. The live `chatStore.send` still
consumes only `result.textStream` and drops tool rows
(`ctx.filter(m => m.role !== 'system' && m.role !== 'tool')`.

**No schema migration this phase.** No `db:generate` / `bundle:migrations`.

## Goal

The first user-visible agency win, near-zero risk. On a tool-capable provider the
model can **look** (read the checklist, list/read artifacts, summarize progress)
via auto-run-silent readonly tools, and the **critic auto-fixes** broken mermaid /
code / KaTeX / admonitions after a turn finishes. On an incapable provider (or
with tools disabled) the loop runs once and is today's `send` — but the critic
still self-fixes (it needs no tool-calling).

## Resolved decisions (for this phase)

| # | Decision | Resolution |
| - | -------- | ---------- |
| 1 | Where the critic lives | **Post-finalize phase inside `loop.ts`.** After the assistant's final prose turn and **before** the assistant row is persisted. On failure: clear the live `streamBuffer`, inject an ephemeral (non-persisted) correction message, re-stream (≤2). The assistant row is persisted **once** with the final corrected text — no broken-text row survives, the correction is invisible, `+page.svelte` is unchanged. Critic needs no tools → works on all providers. (The phased doc's "wire in `+page.svelte`" is treated as imprecise — the page does not own streaming; the store-single-owner invariant forbids the component driving a re-stream.) |
| 2 | Capabilities preamble scope | **Standalone system note whenever tools are live** (covers brief-less "Just start chatting" chats). New `buildCapabilitiesPreamble()` in `brief.ts`; the loop appends it to the joined `system` only when `toolCapability` is true. `buildBriefSystemNote` itself is unchanged. Omitted entirely on degraded providers → today's no-system-message behavior preserved for them. |
| 3 | Session safety-net | **Include, conservative.** If a tool-bearing call throws `APICallError` with status `400` or a message matching `/tool|function/i`, call `disableToolsForSession()` and retry the turn **once** with an empty manifest (today's `send`). DEV-logged. Honors design decision #5 (self-healing, one wasted call, once per session). |
| 4 | Context per iteration | **Re-assemble from the DB each iteration** via `assembleContext(chatId)` (the single chokepoint). Because tool-call + tool-result rows persist incrementally, the next iteration's context carries them for free; branches inherit them via the `rootId` walk. Adopt `toCoreMessages(ctx)` **live** this phase (AG2 built it; verify on the live path — flagged risk). |
| 5 | Assistant-row representation | **One row per logical piece.** A tool-call turn → one assistant tool-call row per `tool-call` part (`content:''`, `toolCallId`/`toolName`/`metadata=JSON(args)`); a final prose turn → one assistant text row (today's behavior). A turn with both non-empty prose **and** tool-calls → a prose text row + one tool-call row per call (rare; flag for live verification of consecutive assistant messages). |
| 6 | Loop control signal | Consume `fullStream` (not `textStream`): accumulate `text-delta` into the buffer, collect `tool-call` parts, and branch on the `finish` part's `finishReason` — `'tool-calls'` → dispatch + loop, anything else → finalize. Verified: ai@7 `tool()` accepts `{ description, inputSchema }` with `execute` optional ("will not be executed automatically"); `jsonSchema` + `tool` are exported; `finish` carries `finishReason` incl. `'tool-calls'`. |

## Ordered task list

### Task 1 — The agent loop core
**New file:** `src/lib/agent/loop.ts`

Define the dependency-injected surface (decision #7):

```ts
export interface AgentTurnDeps {
  model: LanguageModel;
  config: ProviderConfig;          // reasoning + toolCapability
  chatId: string;
  rootChatId: string;
  signal: AbortSignal;
  reasoning: ReasoningMode;
  // View + persistence (owned by chatStore):
  updateStreamBuffer: (next: string) => void;   // ABSOLUTE set (enables critic reset)
  appendAssistantText: (content: string, opts?: { model?: string }) => Promise<Message>;
  appendAssistantToolCall: (p: { toolCallId: string; toolName: string; args: unknown; text?: string }) => Promise<Message>;
  appendToolResult: (r: { toolCallId: string; toolName: string; summary: string; detail?: unknown }) => Promise<Message>;
  reassembleContext: () => Promise<ChatMessage[]>;   // = assembleContext(chatId)
}

export async function runAgentTurn(deps: AgentTurnDeps): Promise<{ aborted: boolean }>;
```

Behavior:
- `toolCapability = deps.config.toolCapability && !isSessionDisabled()`.
- **Safety-net wrapper (decision #3):** the first tool-bearing iteration is wrapped
  so a qualifying `APICallError` (400 or `/tool|function/i`) →
  `disableToolsForSession()` + retry the whole turn once with an empty manifest
  (logs `[agent] safety-net disabled tools: <msg>` in DEV). Fires at most once per
  session (the sticky flag prevents recurrence).
- **Iteration loop** (`for (let i = 0; i < MAX_ITERATIONS; i++)`, `MAX_ITERATIONS = 6`):
  1. `ctx = await deps.reassembleContext()`.
  2. `systemParts = ctx.filter(role==='system').map(content)`; if `toolCapability`
     push `buildCapabilitiesPreamble()`. `messages = toCoreMessages(ctx)`.
  3. `result = streamText({ model, system: join(systemParts,'\n\n')||undefined, messages,
     tools: buildSdkTools(toolCapability), abortSignal: deps.signal,
     providerOptions: providerOptionsForReasoning(deps.config.kind, deps.reasoning) })`.
  4. Consume `result.fullStream`: on `text-delta` → append to a local `buf` and call
     `deps.updateStreamBuffer(buf)`; on `tool-call` → push `{toolCallId, toolName,
     input}` into a `toolCalls[]` collector; on `finish` → capture `finishReason`.
     (Surface any `error` part by throwing — the caller formats via `mapSdkError`.)
  5. If `finishReason !== 'tool-calls'` or `toolCalls` is empty → **finalize** (Task 2 critic).
  6. Else dispatch: persist a prose text row (if `buf` non-empty), then for each
     tool-call persist its assistant tool-call row; run each readonly tool via
     `toolsRun(name, args, ctx)` (`risk:'readonly'` → auto-run silently; pass
     `{ chatId, rootChatId, signal, budget:{subCalls:0,maxSubCalls:1} }`); persist
     each `ToolResult` via `appendToolResult` (summary in `content`, full `detail`
     in `metadata`). On `signal.aborted` mid-tool-run, synthesize an aborted
     result (`{ok:false, summary:'aborted'}`) so **no orphaned tool-call row**
     survives, then break. Reset `buf=''` and loop.
- **Exhaustion:** if the loop hits `MAX_ITERATIONS` with pending tool-calls,
  finalize with the current `buf` and append a short note
  `"\n\n_(…tool budget reached; continuing from here.)_"` (DEV-only is acceptable;
  pick one and keep it terse).
- **Abort contract:** if `deps.signal.aborted` at any point, persist whatever `buf`
  accumulated in the current iteration as a partial assistant text row (mirrors
  today's partial-persistence), then resolve `{ aborted: true }`. `AbortError` is
  swallowed (today's contract).

**Tool manifest helper** (same file):
```ts
function buildSdkTools(enabled: boolean): ToolSet {
  if (!enabled) return {};
  const out: ToolSet = {};
  for (const def of getToolDefinitions()) {
    if (def.risk !== 'readonly') continue;        // AG3 = readonly only
    out[def.id] = tool({ description: def.description, inputSchema: jsonSchema(def.parameters) });
    // NO execute — the loop dispatches via toolsRun.
  }
  return out;
}
```
(`tool`, `jsonSchema` from `'ai'`; `getToolDefinitions` from `registry.ts`.)

### Task 2 — Critic post-finalize phase
**In:** `src/lib/agent/loop.ts` (a `runCriticRevision` step called by `runAgentTurn` on finalize, before persistence).

- After the final prose turn: `issues = await validateTurn(buf)`. If empty → persist
  the assistant text row once (the only row for this turn) and return.
- On issues: clear `deps.updateStreamBuffer('')`; build a correction context =
  current `reassembleContext()` plus an ephemeral (non-persisted) user message
  `"Your previous reply had a problem: <type>: <message>. Re-emit the full reply as valid markdown."`
  Re-`streamText` (no tools; same model/signal) consuming `fullStream` text-deltas
  into a fresh `buf`. Re-validate. **Cap at 2 correction re-streams** (≤2); on the
  final attempt still-broken → persist best-effort `buf` + a DEV log. Persist the
  assistant text row **once** with the final `buf`.
- The correction messages are **never** persisted (no `append*` calls for them) —
  invisibility + single-row persistence are the invariants.

### Task 3 — Capabilities preamble
**Modify:** `src/lib/chat/brief.ts`
- Add `export function buildCapabilitiesPreamble(): string` returning the design §8
  capabilities block (a few lines: "You can act on the learner's behalf using the
  provided tools when it clearly helps… Prefer continuing the lesson over invoking
  tools. Use them judiciously, not every turn."). Pure string; no `ChatMessage`
  wrapper (the loop joins it into `system`).
- `buildBriefSystemNote` is **unchanged** (decision #2).

### Task 4 — Wire `chatStore.send` to the loop
**Modify:** `src/lib/stores/chat.svelte.ts`
- Keep the existing prelude: trim/empty guard, error reset, `chatId`, `reasoning`,
  `isFirstRootTurn`, persist the **user row** immediately + `chats.touch`,
  `streaming=true`, `streamBuffer=''`, new `AbortController`.
- Keep the parallel `Promise.all([assembleContext, getActiveSdkProvider])` only to
  obtain `{ model, config }` and to drive the **parallel** `autoTitleRoot` /
  `inferBriefRoot` (unchanged). (The loop re-assembles context itself per
  iteration; `send` no longer needs the assembled `ctx` for the main stream.)
- Replace the inline `streamText` + `for await (result.textStream)` block +
  assistant-row persistence + the error/partial block with a single call:
  `const { aborted } = await runAgentTurn({ model, config, chatId,
    rootChatId: chat.rootId, signal: this.controller.signal, reasoning,
    updateStreamBuffer: (n) => (this.streamBuffer = n),
    appendAssistantText: (c, o) => this.persistAssistant(c, o),
    appendAssistantToolCall: (p) => this.persistAssistantToolCall(p),
    appendToolResult: (r) => this.persistToolResult(r),
    reassembleContext: () => assembleContext(chatId) });`
- Add private store helpers that persist a row **and** reflect it in
  `this.messages` (the single-owner-of-view invariant): `persistAssistant`,
  `persistAssistantToolCall` (calls `repos.messages.append(chatId,'assistant', text,
  {toolCallId,toolName,metadata})`), `persistToolResult` (calls
  `repos.messages.appendToolResult`). Each appends to `this.messages` and
  `chats.touch`.
- `try/catch`: non-abort errors → `this.error = formatProviderError(mapSdkError(err))`
  (unchanged). The loop itself persists partial text on abort, so `send`'s old
  partial-persistence block moves into the loop; `send` keeps the `finally`
  (`streaming=false`, `streamBuffer=''`, `controller=null`).
- **DEV strategy-lint:** after a successful (non-aborted) text turn, run the
  existing `lintTurn` block, extended to also `console.info('[agent]', toolCallCount,
  'tool calls this turn')` when tool rows were appended (best-effort, never throws).
- `stop()` is unchanged (aborts the same controller the loop reads).

### Task 5 — Minimal route change
**Modify:** `src/routes/chat/[id]/+page.svelte`
- No streaming logic changes (the store owns it). Optional only: a subtle DEV-only
  "self-correcting…" hint bound to `chatStore.streaming` while the critic re-streams
  — only if a store flag is exposed; otherwise leave untouched. Default: **no change**.

### Task 6 — Tests
**New file:** `src/lib/agent/loop.test.ts` using the existing `vi.mock('ai')` canned-parts pattern (see `generate.test.ts`): stub `streamText` to return an object whose `fullStream` is a scripted async iterable of parts (`text-delta` / `tool-call` / `finish`). Mock `toolsRun` + the `deps` callbacks (record calls; a fake `reassembleContext` seeded from a `messages` array the callbacks mutate). Cases:
- (a) **Text-only turn** finalizes; one assistant text row persisted; no tool rows;
  buffer set to the full text.
- (b) **`read_checklist` turn**: `finishReason:'tool-calls'` with one tool-call →
  `toolsRun` called with readonly ctx → result persisted as a `'tool'` row via
  `appendToolResult`; the next iteration's `reassembleContext` includes that row;
  a follow-up text turn finalizes.
- (c) **`maxIterations`**: a script that always returns `tool-calls` → loop stops at
  6; finalizes with the exhaustion note; no runaway.
- (d) **Abort**: abort the signal mid-stream → partial `buf` persisted as a text
  row; resolves `{ aborted:true }`; no throw. Abort mid-tool-run → synthesized
  aborted tool-result; no orphaned tool-call row.
- (e) **Incapable provider** (`toolCapability:false`): `streamText` called with
  `tools:{}`; script never emits `tool-call`; behaves as today's `send`.
- (f) **Critic**: final text contains unparseable ` ```mermaid ` → exactly one
  correction re-stream fires (buffer cleared then refilled); the fixed block is what
  gets persisted; a turn that stays broken after 2 tries persists best-effort + no
  correction rows. A valid turn triggers zero correction streams.
- (g) **Safety-net**: tool-bearing call throws `APICallError({statusCode:400,
  message:'tools not supported'})` → `disableToolsForSession()` called once; turn
  retried with `tools:{}`; a second qualifying error in the same session does **not**
  retry again.
- Extend `critic.test.ts` if any AG3 wiring changes its surface (likely none — it is
  already pure).
- Re-run `context.test.ts` to confirm `toCoreMessages` still round-trips on the live
  path (no regressions from adoption).

### Task 7 — Acceptance
- `pnpm test` / `pnpm check` / `pnpm lint` clean.
- **Capable provider (e.g. Z.AI / Anthropic):** in a Build chat that has a lab with
  a checklist, the model reads progress / lists artifacts **without a button press**
  (silent tool calls); a turn ending in a deliberately broken mermaid block
  self-corrects before it lands.
- **Incapable provider (e.g. a tool-less Ollama model / `'off'` toggle):** chat is
  exactly today; the critic still self-fixes (it needs no tools).
- **Reload** persists tool-call/result rows; a **branch** off such a turn inherits
  them (verify via `assembleContext` in a branch).
- **Dev:** the capability flag resolves per active provider; the safety-net DEV log
  appears only when it actually fires.

## Risks / edge cases
- **`toCoreMessages` live adoption (AG2 flag).** It was only tested synthetically in
  AG2. On the live path verify: (1) the null-brief / no-tool case still produces no
  system message and byte-identical SDK input vs today's manual split (**escape-hatch
  fidelity**); (2) an assistant tool-call row + tool-result row round-trip into
  provider-accepted parts. Mitigation: pin an assertion in `loop.test.ts` + a manual
  reload/branch check.
- **Consecutive assistant messages.** A turn with prose + tool-calls persists a text
  row then tool-call row(s) → `toCoreMessages` emits consecutive assistant messages.
  Most providers accept this in a tool exchange; verify on a real capable provider.
  Rare for readonly tools (model usually separates tool-call turn from final prose).
- **Critic re-stream cost.** Up to 2 extra streams on a bad turn. Bounded strictly
  (≤2), DEV-observable. Verify a turn with both an admonition and a mermaid block
  validates and renders together (mermaid parse + admonition transform already
  coexist in the render pipeline).
- **Safety-net false negatives/positives.** Detection is heuristic (400 /
  `/tool|function/i`). Worst case: a non-tool 400 triggers one wasted retry, or a
  tool-rejection with an unusual message misses the net and surfaces a raw error.
  Acceptable — the net is best-effort self-healing, once per session.
- **Tool spam / `maxIterations`.** A capable model over-calls readonly tools; the
  iteration ceiling (6) + the "prefer continuing the lesson" preamble are the
  restraints. The exhaustion note is terse.
- **Abort orphan rows.** Mitigated by synthesizing an aborted tool-result when abort
  lands mid-tool-run; no orphaned assistant tool-call row reaches the next turn's
  context.
- **Parallel title/brief inference unaffected.** Those use their own controllers and
  `model`/`ctx`; the loop's per-iteration re-assembly does not touch them. Verify
  the first-root-turn title + inferred-brief still fire alongside the loop.

## Out of scope (later phases)
- Deterministic tools (`branch` / `draft_*` / `toggle_checklist_item` / `insert_note`
  / `save_brief` / `edit_brief`), consent tiers (`low`/`high`), approval cards, and
  routing those button paths through the registry — **AG4**.
- Capped generative tools `create_quiz` / `create_lab` (depth-1 sub-agents) and the
  `budget.subCalls` enforcement — **AG5**.
- `validate_*` self-check tools, cross-chat agency, multi-step plans — **AG6**
  (opt-in).
- UI affordances beyond a subtle DEV critic hint (an approval surface / tray) —
  AG4+.
