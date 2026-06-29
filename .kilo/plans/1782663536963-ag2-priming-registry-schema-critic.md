# AG2 — Priming (registry · schema · critic scaffold · capability flags)

**Source of truth:** `refinement/agentic-capabilities.md` (design, decisions #1–12
locked) and `refinement/agentic-capabilities-phased.md` §AG2. Treat those as
authoritative; this is the implementation-ready breakdown grounded in the shipped
AG1 code.

**Prerequisite:** AG1 is shipped — the Vercel AI SDK (`ai@^7`) is the engine,
`getActiveSdkProvider()` returns `{ model, config }`, `chatStore.send` runs
`streamText`, and the orchestrators run `generateObject`. Adapters / `transport.ts`
/ `fence.ts` are deleted. `src/lib/agent/` does **not** exist yet.

**This is the one migration-bearing phase** — run `db:generate` +
`bundle:migrations`. **Zero user-visible behavior change** (no tool-calling is
live; the chat hot path is byte-identical).

## Goal

Lay every foundation the agency layer needs — **without** enabling any autonomous
behavior. After AG2: a tool registry exists and is the single place capabilities
are declared; the `messages` schema carries tool rows; `assembleContext` can
round-trip them into SDK `CoreMessage[]`; the critic validators are built; and a
per-provider tool-capability flag resolves with a session safety-net.

## Resolved decisions (for this phase)

| # | Decision | Resolution |
| - | -------- | ---------- |
| 1 | Unify-handler scope | **Defer all action unify.** AG2 ships the registry skeleton + **readonly inspection tools only** (`read_checklist` / `list_artifacts` / `read_artifact` / `summarize_progress`). The stores' lab/quiz generate, branch, brief save, and checklist toggle paths are **not** touched — their unify lands in AG4 (deterministic) / AG5 (generative) when those tools become model-callable. Honors scope bullet 1 ("readonly only"); avoids the doc's flagged regression surface; no second caller exists in AG2 (the loop is AG3). |
| 2 | Capability flag model | **Per-provider tri-state.** `toolCapability?: 'auto' \| 'on' \| 'off'` on `ProviderConfig` (no migration — `ProviderConfig` is JSON in the `settings` KV; old configs parse as `auto`, mirroring how `discoverable` was added). `'on'`→true, `'off'`→false, `'auto'`/undefined → declared default per kind: anthropic/gemini→true, ollama→false, openai-compatible→**true iff `baseUrl` ∈ known-gateway set** (Z.AI/Kilo/OpenRouter/OpenAI), else false. |
| 3 | Session safety-net | **State built now, wired live in AG3.** `capability.ts` owns a module-level sticky `sessionToolsDisabled` flag + `disableToolsForSession()` / `isSessionDisabled()`; `resolveToolCapability` ANDs the resolved default with the session flag. The actual "catch tool-specific SDK error → disable → retry clean" wiring is the AG3 loop. |
| 4 | Critic mermaid validator | **Real parse, async.** `validateMermaid` lazy-imports mermaid and calls `api.parse(source)` per fenced block (matches the existing per-message lazy-import pattern in `mermaid.ts`); catches exactly what `renderMermaidBlock` would throw. `validateTurn` is therefore `async`. |
| 5 | Critic coverage | **All four types** (locked decision #10): mermaid (real parse), code (fence balance), KaTeX (`renderToString({throwOnError})`), admonitions (structural check only — unknown-but-valid types PASS since `admonition.ts` degrades them to a generic callout; only malformed `[!…]` syntax is flagged). |
| 6 | Context round-trip wiring | **Build + test synthetically; do NOT rewire `send` this phase.** `assembleContext` internals carry the tool columns; a new `toCoreMessages(ctx)` mapper builds ai@7 `CoreMessage[]`. The live chat path keeps its manual system/non-system split (byte-identical) until AG3, when tool rows are real and the loop adopts `toCoreMessages`. AG2 produces **no** tool rows, so the chat path never sees `role:'tool'`. |
| 7 | ai@7 message shape | **Construct `CoreMessage[]` directly.** `convertToCoreMessages` was removed in ai v5+; the installed `ai@7.0.4` uses **parts** (`ToolCallPart` / `ToolResultPart` / `TextPart`) on `AssistantModelMessage` / `ToolModelMessage`. Verify against the installed types. |

## Ordered task list

### Task 1 — Schema migration for tool-call messages
**Modify:** `src/lib/db/schema.ts`
- Widen `messages.role` enum to `['system', 'user', 'assistant', 'tool']`.
- Add nullable columns: `toolCallId: text('tool_call_id')`,
  `toolName: text('tool_name')`, `metadata: text('metadata')` (JSON).
- All additive → old rows get `null` and behave exactly as today. SQLite does
  **not** enforce text enums at the DB level, so the `role` widening is app-only;
  the generated migration should contain only the three `ALTER TABLE … ADD
  COLUMN` statements (verify the generated SQL — no data migration, no destructive
  change).
- Run `pnpm db:generate` (→ `drizzle/0002_*.sql`) then **`pnpm bundle:migrations`**
  (per `AGENTS.md`, so the SPA/Tauri apply it offline).

### Task 2 — Messages repository: tool rows
**Modify:** `src/lib/db/repositories/messages.ts`
- Extend `append(chatId, role, content, opts?)` `opts` to accept
  `{ model?, tokens?, toolCallId?, toolName?, metadata? }` (all optional). The
  existing `insertMessage` uses `$inferInsert`, so the new columns flow through.
- Add a typed helper `appendToolResult(chatId, { toolCallId, toolName, summary, detail? })`
  → writes a `role: 'tool'` row with `content = summary` and
  `metadata = JSON.stringify(detail)`.

### Task 3 — assembleContext tool-row round-trip + toCoreMessages
**Modify:** `src/lib/chat/context.ts`, `src/lib/ai/types.ts`
- Extend the internal `AnchoredMessage` to carry `toolCallId?` / `toolName?` /
  `metadata?`; `pushAll` copies them off each `Message`.
- Keep `assembleContext` returning `ChatMessage[]`. Extend `ChatMessage`
  (`ai/types.ts`) with optional tool fields (`toolCallId?`, `toolName?`,
  `toolArgs?` for assistant tool-call rows, `toolResult?` for tool-result rows)
  so the walk can emit them. The `[briefNote?, excerptNote?, …messages]` order
  and the **null-brief escape hatch** are unchanged.
- Add `toCoreMessages(ctx: ChatMessage[]): CoreMessage[]`:
  - `system` → system message;
  - plain `user`/`assistant` text → text messages;
  - assistant row with `toolArgs` → `AssistantModelMessage` with
    `[TextPart?, ToolCallPart { toolCallId, toolName, args }]`;
  - tool row → `ToolModelMessage` with
    `ToolResultPart { toolCallId, toolName, result }`.
  - Construct parts directly (decision #7 — no `convertToCoreMessages` in ai@7).
- **Do NOT rewire `chatStore.send`** (decision #6). The live chat path keeps its
  manual system/non-system split; `toCoreMessages` is exercised by synthetic tests
  this phase and adopted live in AG3. Labs/quizzes/grading consumers are
  unaffected (they ignore the optional tool fields; no tool rows exist for them).

### Task 4 — Tool registry skeleton + readonly inspection tools
**New file:** `src/lib/agent/registry.ts`
- Types from design §4.1: `ToolRisk = 'readonly' | 'low' | 'high'`,
  `ToolDefinition` (`id`, `description`, `parameters: JSONSchema`, `risk`,
  `generative: boolean`), `Tool { def, run(args, ctx) }`, `ToolContext`
  (`chatId`, `rootChatId`, `signal`, `budget { subCalls, maxSubCalls }`),
  `ToolResult { ok, summary, detail?, artifact? }`.
- `TOOLS` map + `tools.run(id, args, ctx): Promise<ToolResult>` dispatcher.
  Unknown id → typed `{ ok: false, summary: 'unknown tool: <id>' }` (**never**
  throws into a turn).
- Register the four **readonly** inspection tools with real `run` impls calling
  `repos.*` only (a peer of the stores, **never** `db`):
  - `read_checklist({ labId })` → `repos.labs.getById` +
    `repos.labs.parseChecklist` → summary `"N/M steps done"`, full items in `detail`.
  - `list_artifacts({ chatId })` → `repos.labs.listByChat` +
    `repos.quizzes.listByChat` → summary list (`"2 labs, 1 quiz"`), ids/titles in
    `detail`.
  - `read_artifact({ kind, id })` → `repos.labs.getById`, or
    (`repos.quizzes.getById` + `repos.quizQuestions.listByQuiz`) → one-line
    summary, full payload in `detail`.
  - `summarize_progress({ chatId })` → local synthesis (done/total checklist counts
    across the chat's labs + quiz count) — **no LLM call** (stays non-generative).
- These are built + unit-tested but **not invoked by any UI/loop in AG2** (no
  model-facing `tool()` definitions are sent). They are primed for AG3's loop.

### Task 5 — Critic validators
**New file:** `src/lib/agent/critic.ts`
- `CriticIssue = { type: 'mermaid' | 'code' | 'katex' | 'admonition'; message: string; locator?: string }`.
- `validateTurn(markdown): Promise<CriticIssue[]>` — runs all four validators,
  concatenates issues. Pure / DOM-free except the mermaid lazy import.
  - `validateMermaid(text)` — for each fenced ` ```mermaid ` block, `await
    import('mermaid')`, `api.parse(source)`; `catch` → issue with the parse error
    message. (Mirrors `renderMermaidBlock`'s throw-on-parse; lazy import keeps
    mermaid out of the main bundle and only runs when a block is present.)
  - `validateCode(text)` — odd count of ` ``` ` fences → unterminated-fence issue.
  - `validateKatex(text)` — for each inline `$…$` / block `$$…$$` span, run
    `katex.renderToString(expr, { throwOnError: true })`; `catch` → issue.
  - `validateAdmonitions(text)` — structural check on blockquote first-line
    `[!…]`: flag a missing `]` or empty type token (malformed); **pass**
    unknown-but-valid types (they render as a generic callout — no false positive).
- **Not wired to live auto-correction** (AG3 injects the correction turn + re-stream).

### Task 6 — Capability flag + Settings toggle
**New file:** `src/lib/agent/capability.ts`
- `KNOWN_GATEWAY_BASEURLS` — the Z.AI / Kilo / OpenRouter / OpenAI base URLs from
  the templates in `src/lib/ai/registry.ts`.
- `resolveToolCapability(config): boolean` — `'on'`→true, `'off'`→false,
  `undefined`/`'auto'` → declared default per kind (anthropic/gemini→true,
  ollama→false, openai-compatible→true iff `config.baseUrl ∈ KNOWN_GATEWAY_BASEURLS`
  else false). **AND** the result with the session flag.
- Session safety-net state: module-level sticky `sessionToolsDisabled` +
  `disableToolsForSession()` + `isSessionDisabled()` (wired into the loop in AG3).
**Modify:**
- `src/lib/ai/types.ts` — add `toolCapability?: 'auto' | 'on' | 'off'` to
  `ProviderConfig` (optional; old configs → undefined → `'auto'`).
- `src/lib/ai/registry.ts` — seed `toolCapability: 'auto'` on every template (the
  defaults differ per kind via the resolver; Ollama's `'auto'` resolves false).
- `src/lib/ai/client.ts` — expose the resolved capability alongside the active
  provider (extend `ActiveProvider` with `toolCapability: boolean`, computed in
  `buildSdkModel`/`getActiveSdkProvider` via `resolveToolCapability`), so AG3's
  loop can decide whether to send tools. Key accessors / `listProviders` /
  `saveProviders` unchanged.
- Settings UI (`src/routes/settings` provider edit form) — add a per-provider
  tri-state control (Auto / On / Off) bound to `ProviderConfig.toolCapability`.

### Task 7 — Tests
- **`registry.test.ts`** (new): `tools.run` dispatches the right tool; unknown id
  → typed `{ ok:false }` result (no throw); each readonly tool's `run` calls the
  expected `repos.*` and returns `{ ok, summary }`; `summarize_progress` makes no
  LLM/generate call.
- **`critic.test.ts`** (new): each validator flags its bad input (unparseable
  mermaid, unterminated ` ``` ` fence, broken KaTeX `\\(`, malformed `> [!`);
  passes good input; unknown admonition type passes (no false positive);
  `validateTurn` is awaited (async).
- **`context.test.ts`** (extend): a synthetic assistant-tool-call + tool-result row
  pair round-trips through `toCoreMessages` into ai@7 parts (`ToolCallPart` /
  `ToolResultPart`); a null-brief chat still produces **no** system note and
  byte-identical SDK input vs the current manual split (**escape-hatch fidelity**).
- **`capability.test.ts`** (new): declared defaults per kind; `'on'`/`'off'`
  override wins over `'auto'`; known-gateway openai-compatible → true, unknown
  baseUrl → false; `disableToolsForSession()` flips the sticky flag and forces
  `resolveToolCapability` → false.
- **Repository migration** covered by the existing Vitest in-memory driver suite:
  migration `0002` runs clean on an empty DB; old `messages` rows keep `null` tool
  columns; `append` with tool opts + `appendToolResult` round-trip through a read.

### Task 8 — Acceptance
- `pnpm test` / `pnpm check` / `pnpm lint` clean.
- **Identical UX** — no tool-calling is live; chat / labs / quizzes / branching
  behave exactly as today (the only AG2 change to a live path is none on the chat
  hot path; `toCoreMessages` is built + tested but not wired).
- **Migration clean** in both runtimes (browser OPFS + desktop native SQLite): a
  pre-AG2 DB upgrades in place with old `messages` rows untouched.
- **Dev:** the capability flag resolves per active provider; toggling Auto/On/Off
  in Settings persists; a known gateway (Z.AI) resolves `true`, Ollama `false`,
  an unknown OpenAI-compatible baseUrl `false`.

## Risks / edge cases
- **Escape-hatch fidelity (flagged in the doc).** The null-brief / no-tool context
  output must stay byte-for-byte today's. Pin the assertion in `context.test.ts`.
  Mitigated by decision #6: `send` is not rewired in AG2.
- **ai@7 part-shape construction.** `convertToCoreMessages` is gone in ai@7;
  `toCoreMessages` must build `CoreMessage[]` with `ToolCallPart`/`ToolResultPart`
  directly. Verified only synthetically this phase (no live tool rows until AG3) —
  flag for the AG3 implementer to re-verify on the live path.
- **Unify-handlers regression — explicitly avoided.** This phase does not touch the
  lab/quiz/branch/toggle/brief store paths (decision #1). When AG4/AG5 land those
  tools, route the button path through the registry then.
- **Migration is additive-only.** SQLite text enums are app-enforced, so the `role`
  widening needs no SQL change; verify the generated `0002` SQL contains only the
  three nullable `ADD COLUMN`s.
- **Critic admonition validator is low-value.** Admonitions never break rendering;
  the structural check rarely fires. Acceptable (decision #10 mandates coverage);
  must not false-positive on valid unknown types.
- **mermaid in the critic bundle.** Lazy import keeps it out of the main bundle and
  runs only when a ` ```mermaid ` block is present; the critic is otherwise sync.
- **Capability safety-net is one-directional.** It only ever *disables*. An unknown
  gateway that *does* support tools defaults `false` until the user flips to `'on'`
  — acceptable per "honest defaults, user-correctable."

## Out of scope (later phases)
- The agent loop (`runAgentTurn`), live readonly tools, critic auto-correction
  re-stream, capability preamble in `buildBriefSystemNote`, and the live adoption
  of `toCoreMessages` in `chatStore.send` — **AG3**.
- Deterministic tools (`branch`/`draft_*`/`toggle`/`save_brief`) + consent +
  approval cards + routing those button paths through the registry — **AG4**.
- Capped generative tools `create_quiz` / `create_lab` (depth-1) — **AG5**.
- `validate_*` self-check tools, cross-chat agency, multi-step plans — **AG6**
  (opt-in).
