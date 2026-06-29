# Plan — Chat Diagnostics Panel (AI observability)

An always-on, icon-only "diagnostics" button in the chat action bar that opens a
panel showing the **full plaintext trace** of every agentic turn (what we sent to
the model + what we received, stream-part by stream-part). Closes the
observability gap behind the "blank assistant message" bug.

## Context & root finding (read first)

`src/lib/agent/loop.ts:64` (`consumeStream`) only handles four stream part
types: `text-delta`, `tool-call`, `finish`, `error`. **Every other part the
Vercel AI SDK emits is silently discarded** — including `reasoning` /
`reasoning-delta`, which is **ON by default** (`Composer.svelte:31`,
`reasoning: 'auto'`). When a provider routes content through a discarded part
type, the text buffer stays `""`, the critic runs on an empty string, and an
**empty assistant row is persisted** — exactly the reported symptom, with
nothing in the console because the discarded parts are never logged.

This plan ships the **observability** to make those parts visible. The
dropped-parts *fix* (handle reasoning/text accumulation in the loop) is an
**explicit follow-up, out of scope here** — the tool is what surfaces the bug.

## Resolved decisions

- **Capture:** Full trace — assembled request (system note, plaintext messages,
  tools manifest, provider options) + **every** `fullStream` part received
  (incl. reasoning/source/tool-call-delta/file) + final persisted text + tool
  results + `finishReason`.
- **Storage:** DB-backed (new `agent_traces` table). One row per turn. Survives
  reload so a blank persisted message can be post-mortemed.
- **Availability:** Always-on (NOT gated behind `import.meta.env.DEV`).
- **Entry point:** icon-only button in `src/routes/chat/[id]/+page.svelte` action
  bar, beside *Generate lab / Generate quiz / Tree*.
- **Plumbing:** via DI — add an `onTrace(event)` callback to `AgentTurnDeps`
  (respects locked decision #7: loop stays a unit-testable free function; the
  store owns persistence).
- **Out of scope (future):** tracing the parallel `generateObject` paths
  (`generate-title`, `generate-brief`, lab/quiz generate); fixing the
  dropped-parts bug in `consumeStream`; auto-prune of traces.

## Trace data model

New drizzle table `agent_traces` (mirrors existing schema conventions: text
UUIDs, epoch-ms timestamps, FKs with `ON DELETE NO ACTION`):

| column             | type    | notes                                                        |
| ------------------ | ------- | ------------------------------------------------------------ |
| `id`               | text PK | `crypto.randomUUID()`                                        |
| `chat_id`          | text    | `→ chats.id`, not null                                       |
| `assistant_message_id` | text | `→ messages.id`, nullable (empty/aborted turn may have no row) |
| `model`            | text    | nullable                                                     |
| `config_kind`      | text    | provider kind                                                |
| `reasoning`        | text    | the `ReasoningMode` used                                     |
| `created_at`       | int     | epoch-ms                                                     |
| `duration_ms`      | int     | nullable                                                     |
| `trace`            | text    | JSON string of the structured event list (see shape)         |

**`trace` JSON shape:**

```jsonc
{
  "aborted": false,
  "iterations": [
    {
      "index": 0,
      "request": {
        "system": "...brief/strategy note + capabilities preamble...",
        "messages": [ { "role": "user", "content": "..." }, /* plaintext, full */ ],
        "tools": ["read_checklist", "..."],         // manifest sent (or [])
        "providerOptions": { /* resolved reasoning opts */ }
      },
      "partSequence": [ { "type": "reasoning-delta", "count": 12 }, { "type": "text-delta", "count": 0 }, { "type": "finish" } ],
      "reasoning": "...full received reasoning text (coalesced)...",
      "receivedText": "...full received text (coalesced)...",
      "finishReason": "stop",
      "toolCalls": [ { "toolCallId": "...", "toolName": "...", "args": {} } ],
      "toolResults": [ { "toolCallId": "...", "summary": "...", "detail": {} } ]
    }
  ],
  "finalText": "...",
  "persisted": { "messageId": "...", "empty": false }
}
```

Coalescing rule: consecutive same-type deltas collapse to one
`partSequence` entry with a `count`, and the payload is accumulated into
`reasoning` / `receivedText`. This preserves the structural signal (was any
`text-delta` emitted at all?) without storing hundreds of fragment rows.

## Tasks (ordered)

### 1. Schema + migration
- Add `agentTraces` table to `src/lib/db/schema.ts` (columns above); export
  `AgentTrace` / `NewAgentTrace` inferred types.
- New repo `src/lib/db/repositories/agent-traces.ts`: `listByChat(chatId)`
  (newest-first), `create(input)`, `getById(id)`, `deleteByChat(chatId)`,
  `deleteByRoot(rootId)` (raw `chat_id IN (SELECT id FROM chats WHERE root_id = ?)`).
  Mirror `repositories/messages.ts` (`await awaitDb()`, `now()`, `uuid()`).
- Register in `src/lib/db/index.ts`: `agentTraces: agentTracesRepo`.
- Wire cleanup into `chatsRepo.deleteSubtree` (`src/lib/db/repositories/chats.ts`):
  add `{ sql: 'DELETE FROM agent_traces WHERE chat_id IN (SELECT id FROM chats WHERE root_id = ?)', params: [rootId] }`
  into the batch **before** the `DELETE FROM chats` step (leaf→root order).
- `pnpm db:generate` → new `drizzle/000X_*.sql`; then **`pnpm bundle:migrations`**
  (per AGENTS.md).

### 2. Trace types + builder
- New `src/lib/agent/trace.ts`:
  - `TraceEvent` discriminated union (`request`, `part`, `tool-call`,
    `tool-result`, `persisted`, `aborted`, `error`).
  - `TurnTrace` type matching the JSON shape above.
  - `TraceBuilder` class: `.emit(event)`, coalesces consecutive `part` deltas,
    accumulates reasoning/text, tracks iterations + timing; `.toJSON()` → the
    `trace` column payload; `.assistantMessageId` / `.empty` setters.

### 3. Instrument the loop
- `src/lib/agent/loop.ts`:
  - Add optional `onTrace?: (e: TraceEvent) => void` to `AgentTurnDeps`.
  - Emit (guard `deps.onTrace?.(...)`, never throw):
    - per iteration: `{ kind:'request', system, messages, tools, providerOptions }` after assemble;
    - in `consumeStream`: `{ kind:'part', type, payload? }` for **every** part
      (add the missing `reasoning-delta`/`reasoning`/`source`/etc. as pass-through
      emits — capture only, do **not** change accumulation behavior);
    - `{ kind:'tool-call', ... }`, `{ kind:'tool-result', ... }` at dispatch points;
    - `{ kind:'persisted', messageId, finalText, empty }` on persist;
    - `{ kind:'aborted' }` / `{ kind:'error', message }` as applicable.
- **Do not** change `consumeStream`'s accumulation logic (that is the follow-up
  fix). Only add the observe/emits.

### 4. Wire the store
- `src/lib/stores/chat.svelte.ts` (`send`):
  - Construct a `TraceBuilder` per turn; pass `onTrace: (e) => { builder.emit(e); diagnosticsStore.liveEmit(e); }`.
  - On assistant-text append (`appendAssistantText`), set `builder.assistantMessageId`/`.empty`.
  - In `finally`: best-effort `repos.agentTraces.create({ ...meta, trace: builder.toJSON() })`
    wrapped in try/catch (never surfaces to the user), then `diagnosticsStore.endTurn()`.

### 5. Diagnostics store
- New `src/lib/stores/diagnostics.svelte.ts` (runes singleton, mirrors
  `toastState`): `open = $state(false)`, `liveEvents = $state<TraceEvent[]>([])`
  (current in-flight turn, reactive for live view), `traces = $state<AgentTrace[]>([])`;
  `load(chatId)` (from DB), `liveEmit(e)`, `endTurn()`, `clear(chatId)`,
  `toggle()`, `selectTurn(id)`.

### 6. UI primitive + panel
- Add a shadcn-svelte **Sheet** primitive to `src/lib/components/ui/sheet/` (via
  `npx shadcn-svelte add sheet`, consistent with the existing `button` import).
- New `src/lib/components/chat/DiagnosticsPanel.svelte`:
  - Sheet slide-over (right). Header: chat title + "Clear traces" button.
  - While `diagnosticsStore.liveEvents` non-empty during streaming: a live
    "in-flight" section showing the part sequence as it grows.
  - Turn list (newest-first). **Flag turns with `persisted.empty === true` in
    red** ("no text received") — this surfaces the bug at a glance.
  - Selected turn detail: assembled request (plaintext messages + system),
    part sequence (with "⚠ 0 text-delta parts" warning when applicable),
    received reasoning text, received text, tool calls/results. "Copy raw JSON"
    button per section.

### 7. Button + mount
- `src/routes/chat/[id]/+page.svelte` action bar (around line 256, next to Tree):
  add icon-only `<Button variant="ghost" size="icon" title="Diagnostics"
  aria-label="Diagnostics" onclick={() => diagnosticsStore.toggle()}>` with a
  lucide icon (`Wrench` preferred; `Bug` acceptable). Render `<DiagnosticsPanel
  chatId={chatStore.chat!.id} />`. Reload `diagnosticsStore.load(chatId)` in the
  existing `loadAll` effect after `chatStore.load`.

## Failure modes / invariants

- Trace DB writes are **best-effort**: any failure is swallowed and never
  surfaces as `chatStore.error` or breaks the turn (mirror the strategy-lint
  try/catch in `chatStore.send`).
- `onTrace` is optional + never throws into the loop.
- Empty/aborted turns still produce a trace row (`assistant_message_id` null,
  `aborted: true`) so the gap is observable.
- `deleteSubtree` removes traces with the chat (no orphans, FKs stay clean).

## Validation

- `src/lib/agent/loop.test.ts`: add assertions that `onTrace` receives
  (a) a `request` event per iteration with the assembled messages, (b) `part`
  events including a **reasoning-only** fixture (a canned part stream that emits
  `reasoning-delta` but **no** `text-delta`) — assert the resulting trace has
  `partSequence` showing `text-delta: 0`, `receivedText: ""`, and `persisted.empty === true`,
  and that the reasoning text was captured; (c) `tool-call`/`tool-result` events.
- Migration: covered by the existing Vitest **in-memory driver** suite (clean on
  empty DB; pre-existing chats get no trace rows).
- `pnpm db:generate` + `pnpm bundle:migrations` ran.
- `pnpm test` / `pnpm check` / `pnpm lint` clean.
- Manual (browser `pnpm dev`, desktop `pnpm tauri dev`): send a turn → open the
  diagnostics panel → see the part sequence + reasoning + received text live;
  reload the tab → the trace row is still present; delete the chat → traces gone;
  a turn that renders blank shows `empty: true` with the reasoning captured.
