# Plan — Diagnostics on all LLM surfaces

Extend the existing chat diagnostics panel (already shipped for the agent
turn) to **every surface that interacts with an LLM**, and trace **every**
LLM call. New buttons on `/lab/[id]` and `/quiz/[id]`; new traces for
auto-title, brief inference, lab generation, quiz generation, and quiz
short-answer grading.

## Context

The chat diagnostics panel is live: `DiagnosticsPanel.svelte`,
`diagnosticsStore` (`src/lib/stores/diagnostics.svelte.ts`), the
`agent_traces` table (`src/lib/db/schema.ts:161`), the `agentTracesRepo`
(`src/lib/db/repositories/agent-traces.ts`), and `TraceBuilder`
(`src/lib/agent/trace.ts`) instrument the streaming agent turn
(`streamText` in `src/lib/agent/loop.ts`). Only the **chat reply** is
traced today.

The remaining LLM calls (all `generateObject`/`generateText`, resolve
atomically — no token stream) are untraced:

| Call | Fn | Initiated | Observed on |
| ---- | -- | --------- | ----------- |
| Auto-title | `generateTitle` → `generateText` | `/chat/[id]` (background) | `/chat/[id]` |
| Brief inference | `generateBrief` → `generateObject` | `/chat/[id]` (background) | `/chat/[id]` |
| Lab gen | `generateLab` → `generateObject` | `/chat/[id]` button → nav | `/lab/[id]` |
| Quiz gen | `generateQuiz` → `generateObject` | `/chat/[id]` button → nav | `/quiz/[id]` |
| Short-answer grading | `gradeShortAnswer` → `generateObject` | `/quiz/[id]` (on answer) | `/quiz/[id]` |

## Resolved decisions

- **Scope:** full coverage — every LLM call is traced; buttons on
  `/chat/[id]` (existing), `/lab/[id]`, `/quiz/[id]`.
- **Storage:** keep `agent_traces` chat-scoped (`chatId NOT NULL` — every
  call has a source chat). Add a `kind` discriminator and nullable typed
  `labId`/`quizId` FKs for clean per-artifact filtering.
- **Trace shape:** keep `TraceBuilder` (iterations/part-sequence) for the
  streaming loop; add a flat `buildObjectTrace()` for atomic
  `generateObject`/`generateText` calls.
- **Plumbing:** each generate fn gets an optional `onTrace` callback
  (mirrors the loop's DI pattern — locked architecture boundary: stores
  own persistence; generate fns stay unit-testable free functions).
- **Live view:** only the streaming chat turn has a live in-flight token
  view. Atomic calls show a pending indicator (existing
  `generating`/`gradingQuestionId` flags) then the completed trace.

## Data model

`agent_traces` (`src/lib/db/schema.ts`) — add columns:

| column  | type    | notes                                                          |
| ------- | ------- | -------------------------------------------------------------- |
| `kind`  | text    | NOT NULL, default `'chat'`. One of `chat\|title\|brief\|lab\|quiz\|grade`. Default keeps existing rows valid. |
| `labId` | text    | nullable, `→ labs.id`, `ON DELETE NO ACTION` (cascade wired in repo). Set only for `kind='lab'`. |
| `quizId`| text    | nullable, `→ quizzes.id`, `ON DELETE NO ACTION`. Set for `kind='quiz'` and `kind='grade'`. |

`chatId`, `configKind`, `reasoning` stay NOT NULL. For non-chat kinds:
`configKind` = provider `config.kind`; `reasoning` = `''` (empty). `model`
already nullable.

### Trace JSON shapes

**Agent turn (`kind='chat'`)** — unchanged (`TraceBuilder.toJSON()`):
`{ aborted, error, iterations[], finalText, persisted }`.

**Atomic object/text calls (`kind` in `title|brief|lab|quiz|grade`)** —
flat shape from `buildObjectTrace()`:

```jsonc
{
  "kind": "lab",
  "request": {
    "system": "...resolved system (prompt + brief note)...",
    "messages": [ { "role": "user", "content": "..." } ],
    "schema": "GeneratedLabSchema"
  },
  "result": { "object": { /* the parsed object */ } },
  "error": null,
  "raw": null
}
```

On failure (e.g. `LabGenerationError`): `result` omitted; `error` = the
message; `raw` = `extractRaw(err)` payload. For `kind='grade'`, also embed
`questionId`, `prompt`, `rubric`, `answer` inside `request` (or a sibling
`grade` block) so the per-question context is visible.

## Tasks (ordered)

### 1. Schema + migration
- Add `kind` / `labId` / `quizId` to `agentTraces` in
  `src/lib/db/schema.ts`; export inferred types (already generic — no new
  type aliases needed).
- `pnpm db:generate` → new `drizzle/000X_*.sql`, then
  **`pnpm bundle:migrations`** (per AGENTS.md).

### 2. Repo — per-artifact queries + cascade
`src/lib/db/repositories/agent-traces.ts`:
- `listByChat(chatId, kinds?)` — extend existing `listByChat` with an
  optional `kinds` filter (chat panel groups by kind).
- `listByLab(labId)` — `where(eq(agentTraces.labId, labId))`, newest-first.
- `listByQuiz(quizId)` — `where(eq(agentTraces.quizId, quizId))`,
  newest-first.
- `deleteByLab(labId)` / `deleteByQuiz(quizId)`.
- `deleteByRoot` (existing) — unchanged: lab/quiz/grade traces keep
  `chatId`, so the existing `DELETE ... WHERE chat_id IN (...)` in
  `chatsRepo.deleteSubtree` already removes them. **Verify, no edit needed.**

Cascade wiring:
- `labs.delete(id)` (`src/lib/db/repositories/labs.ts:88`): best-effort
  `agentTracesRepo.deleteByLab(id)` before the lab delete (or a batch).
- `quizzes.delete(id)` (`src/lib/db/repositories/quizzes.ts:48`): same
  with `deleteByQuiz(id)`.

### 3. Trace types + atomic helper
`src/lib/agent/trace.ts`:
- Add `ObjectTraceRequest` / `ObjectTracePayload` types.
- Add `buildObjectTrace(input: { kind, request, result?, error?, raw? })`
  returning the JSON string. Pure, no state.
- Keep `TraceBuilder` untouched (loop still uses it).

### 4. Instrument the generate fns (optional `onTrace`)
Each of `generateTitle`, `generateBrief`, `generateLab`, `generateQuiz`,
`gradeShortAnswer`:
- Add `onTrace?: (t: { request: ObjectTraceRequest; result?: { object: unknown }; error?: string; raw?: string }) => void`
  to its options type.
- After `splitContextForGeneration`, the fn already has `system` + `core`
  messages: build the `request` there (`schema` = the Zod schema name /
  `'text'` for title).
- On success: `onTrace?.({ request, result: { object } })`.
- In the `catch` (before rethrowing the typed `*Error`):
  `onTrace?.({ request, error: <message>, raw: extractRaw(err) })`, then
  `throw` as today. The error must still propagate (tracing is observe-only).

### 5. Wire the stores to persist traces (best-effort)
Each store builds + persists a trace row in `finally` (try/catch, never
surfaces / never breaks the call — mirror `chatStore.send`'s trace write):

- `chatStore.autoTitleRoot` (`src/lib/stores/chat.svelte.ts:367`): pass
  `onTrace` to `generateTitle`; persist `kind:'title'` (`chatId`, no lab/quiz id).
- `chatStore.inferBriefRoot` (`:447`): `kind:'brief'`.
- `labsStore.generate` (`src/lib/stores/labs.svelte.ts:80`): `kind:'lab'`,
  `labId` = the created lab id (persist trace **after** `repos.labs.create`
  succeeds; on `LabGenerationError`, persist with `error`/`raw` and no
  `labId`).
- `quizzesStore.generate` (`src/lib/stores/quizzes.svelte.ts:151`):
  `kind:'quiz'`, `quizId` = created quiz id (same error handling).
- `quizzesStore.runShortGrading` (`:326`): `kind:'grade'`, `quizId` =
  `this.current.chatId`'s quiz id; embed `questionId`/`prompt`/`rubric`/
  `answer` in the request. Persist in `finally` of the grading try/catch.

All persist via `repos.agentTraces.create({ kind, chatId, labId?, quizId?,
model, configKind, reasoning:'', durationMs, trace })`.

### 6. Diagnostics store generalization
`src/lib/stores/diagnostics.svelte.ts`:
- Add `kinds = $state<string[] | null>(null)` (active kind filter; `null`
  = all).
- Add `loadByLab(labId)` and `loadByQuiz(quizId)` (call the new repo
  methods, set `traces`).
- Extend `clear` to also accept a lab/quiz scope (clear the currently
  loaded set); or add `clearLab`/`clearQuiz`.
- `liveEvents`/`endTurn` stay (chat streaming only).

### 7. Panel generalization
Move `src/lib/components/chat/DiagnosticsPanel.svelte` →
`src/lib/components/diagnostics/DiagnosticsPanel.svelte` (no longer
chat-specific). Update the import in `src/routes/chat/[id]/+page.svelte:31`.
- Props: `{ chatId?: string; labId?: string; quizId?: string; title?: string }`.
- On mount: call `loadByLab` / `loadByQuiz` / `load(chatId, kinds)` per the
  prop set.
- Add a **kind-filter chip row** (All / Chat / Title / Brief / Lab / Quiz /
  Grade) — on the chat panel default to "Chat" (turns) with others one click
  away, so background title/brief traces don't clutter. Lab/quiz panels
  pre-filter to their kinds.
- Render: keep the existing iteration/part-sequence view for `kind='chat'`
  traces; add a flat view for atomic kinds — system, messages, result
  object (pretty JSON), and error/raw block. Reuse the Copy buttons.
- Header title from the `title` prop (e.g. "Diagnostics — Lab",
  "Diagnostics — Quiz").

### 8. Buttons + mount
- `/lab/[id]` runner (`src/lib/components/labs/LabRunner.svelte:25` header
  row): add icon-only `<Button variant="ghost" size="icon" title="Diagnostics"
  aria-label="Diagnostics" onclick={() => diagnosticsStore.toggle()}><Wrench
  class="size-4" /></Button>`; mount `<DiagnosticsPanel labId={lab.id}
  title="Diagnostics — Lab" />`.
- `/quiz/[id]` runner (`src/lib/components/quizzes/QuizRunner.svelte:25`
  header row): same with `<DiagnosticsPanel
  quizId={quizzesStore.current.id} title="Diagnostics — Quiz" />`.
- `/chat/[id]`: existing button unchanged (now opens the generalized panel
  with `chatId` + the kind filter).

## Failure modes / invariants

- Trace DB writes are **best-effort**: every persist is wrapped in
  try/catch and never surfaces as a store `error` or breaks the call
  (mirror `chatStore.send`'s trace write).
- `onTrace` is optional and **never throws** into a generate fn; on error
  the fn still rethrows its typed `*Error`.
- `chatId` is NOT NULL — every call site has a source chat (title/brief =
  root chat; lab/quiz = source chat; grade = quiz's source chat). Confirm
  each persist supplies it.
- Empty/failed generations still produce a trace (`error`/`raw` populated,
  `labId`/`quizId` null) so failures are observable.
- Cascade: deleting a lab/quiz removes its traces; `deleteSubtree` already
  removes chat-scoped traces (verify the existing line covers the new kinds
  — it does, since they retain `chatId`).

## Validation

- `src/lib/ai/generate/generate.test.ts`, `generate-brief.test.ts`,
  `generate-quiz.test.ts`, `generate-title.test.ts`: assert `onTrace`
  fires with `request` (system + messages + schema) + `result.object` on
  success, and with `error` + `raw` on a mocked failure (before the typed
  error propagates).
- `agent-traces` repo (in-memory driver): `listByLab` / `listByQuiz`
  return only matching rows; `kind`/`labId`/`quizId` round-trip.
- Migration: existing Vitest in-memory suite runs clean on a pre-existing
  DB (old rows get `kind='chat'`, nullable columns null).
- `pnpm check` / `pnpm lint` / `pnpm test` clean; `pnpm db:generate` +
  `pnpm bundle:migrations` ran.
- Manual (browser `pnpm dev`, desktop `pnpm tauri dev`):
  - **Lab:** generate a lab → open `/lab/[id]` diagnostics → see the
    resolved system prompt + messages + parsed result object; reload →
    trace persists.
  - **Quiz gen:** generate a quiz → open `/quiz/[id]` diagnostics → see
    the `kind:'quiz'` trace.
  - **Grading:** answer a short question → open quiz diagnostics → see a
    `kind:'grade'` trace with the question/answer + verdict; Re-grade
    appends another grade trace.
  - **Chat:** send a turn; the panel still shows the streaming in-flight
    view; toggle the kind filter to "Title"/"Brief" to see the background
    traces.
  - Delete a lab/quiz → its traces are gone; delete a chat tree → all its
    traces are gone.

## Out of scope

- Fixing the dropped-parts bug in `consumeStream` (separate follow-up).
- Tracing tool *sub-call* generation (e.g. a `create_lab` tool's internal
  generateObject) beyond the top-level surfaces above.
- Auto-prune / size limits on `agent_traces`.
