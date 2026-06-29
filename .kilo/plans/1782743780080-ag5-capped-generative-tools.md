# AG5 — Capped generative tools

**Source of truth:** `refinement/agentic-capabilities.md` (design, decisions #1–12
locked) and `refinement/agentic-capabilities-phased.md` §AG5. Treat those as
authoritative; this is the implementation-ready breakdown grounded in the shipped
AG1–AG4 code.

**Prerequisite:** AG4 is shipped — `runAgentTurn` (`src/lib/agent/loop.ts`) does
risk-tiered concurrent dispatch (auto-track sequential, high-track approval +
sequential approved runs); `AgentTurnDeps` has `requestApproval` /
`notifyLowRisk`; the deterministic tools live in `deterministic-tools.ts`;
`MessageRow.svelte` renders `artifact:{kind,id}` links on `role:'tool'` rows
(`MessageRow.svelte:67-72`); `buildCapabilitiesPreamble` mentions deterministic
actions; the loop persists every tool-call + tool-result row.

**No schema migration this phase.** No `db:generate` / `bundle:migrations`. The
new tools reuse existing `repos.*` + the AG1 `generateObject` orchestrators. The
budget + approval state is ephemeral.

## Goal

The headline capability: the tutor **offers** to turn a unit into a quiz / lab,
the learner **approves** (high-risk card), and it is made — grounded identically
to the button path — with a link to it on the tool-result row. Generative tools
run as **depth-1 sub-agents**: exactly one tool-less `generateObject` sub-call
per turn, under a hard recursion ceiling (decision #3). On an incapable provider
(or tools disabled) the loop is unchanged from AG4.

## Grounding facts (from the shipped code)

- The button paths already enforce depth-1 by construction:
  `generateQuiz` (`generate-quiz.ts:181-188`) and `generateLab` (`generate.ts:
  123-131`) call `generateObject({ model, schema, system, messages, abortSignal,
  maxRetries })` with **no `tools`** field → a sub-call cannot recurse. AG5
  reuses these functions verbatim (decision #8 — "full context, same as buttons").
- The generative tool calls `assembleContext(ctx.chatId)` itself, identical to
  `labsStore.generate` / `quizzesStore.generate`. The settings prompt overrides
  (`labPrompt` / `quizPrompt`) apply automatically (read inside the generators).
- `buildSdkTools` currently skips generative defs: `if (def.generative) continue`
  (`loop.ts:56`). AG5 removes this guard so the model sees `create_quiz` /
  `create_lab`.
- The loop passes a **throwaway** `budget:{ subCalls:0, maxSubCalls:1 }` literal
  at two call sites (`loop.ts:265` auto-track, `loop.ts:308` high-track) — so
  cap-depth-one is **not** enforced today. AG5 replaces these with one
  turn-scoped, mutable `turnBudget` reference.
- `ToolContext` (`registry.ts:22-27`) has `chatId / rootChatId / signal / budget`
  but **no** `model` / `config` — generative tools cannot make the sub-call or
  stamp the artifact's `model` column without them.
- The loop test mocks `toolsRun` wholesale (`loop.test.ts:68`), so budget
  enforcement is only unit-testable if the **loop** owns the gate.
- AG4's `MessageRow.svelte` already turns `metadata.artifact:{kind,id}` into a
  `/lab/<id>` or `/quiz/<id>` link (`MessageRow.svelte:51-56, 67-72`). A
  generative tool returning `detail.artifact` gets the link for free.

## Resolved decisions (for this phase)

| # | Decision | Resolution |
| - | -------- | ---------- |
| 1 | Navigation on confirm | **Link on the tool-result row, no mid-loop `goto`.** Overrides the phased plan's "navigate on confirm" — consistent with AG4 decision #3. The model gets a follow-up iteration to announce the artifact; `MessageRow` already renders the `artifact` link. No `+page.svelte` navigation edit. |
| 2 | Where the depth-1 budget gate lives | **In the loop, not the tool.** Before dispatching an approved `generative:true` tool, the loop checks `turnBudget.subCalls >= turnBudget.maxSubCalls`; if spent, synthesize `{ ok:false, summary:'one generative action per turn' }` **without** calling `toolsRun`; else increment then call. One mutable `turnBudget` ref per `runAgentTurn`, passed through `ToolContext.budget` (replaces today's two throwaway literals). The loop test can assert enforcement directly (it mocks `toolsRun`). |
| 3 | `ToolContext` for the sub-call | **Extend additively** with `model: LanguageModel` + `config: ProviderConfig`. The loop already holds both (`deps.model` / `deps.config`). Existing readonly/deterministic tools ignore the new fields (they destructure only what they need). |
| 4 | No-orphan on abort | **Check `ctx.signal.aborted` right after `generateObject` resolves, before any DB write.** If aborted, return `{ ok:false, summary:'aborted' }` and write nothing. The residual sub-ms window during the fast local quiz multi-row inserts is accepted (identical property to the button path). The budget is spent either way (one attempt per turn). |
| 5 | Where the tools live | **New `src/lib/agent/generative-tools.ts`** (keeps `deterministic-tools.ts` honestly named). `create_quiz` / `create_lab` registered via side-effect import, peers of the deterministic tools. |
| 6 | Sub-call UX | **Silent during generation** (no token-by-token UI; `generateObject` is non-streaming). The approval card already set expectation. An optional "Generating quiz…" toast is **deferred** polish — not in scope. |

## Ordered task list (strictly sequential — each depends on the prior)

### Task 1 — Extend `ToolContext` for generative tools
**Modify:** `src/lib/agent/registry.ts`

Additive type change only (no behavior change; existing tools unaffected):
```ts
import type { LanguageModel } from 'ai';
import type { ProviderConfig } from '$lib/ai/types';

export interface ToolContext {
  chatId: string;
  rootChatId: string;
  signal?: AbortSignal;
  budget: { subCalls: number; maxSubCalls: number };
  model: LanguageModel;          // NEW — the resolved turn model
  config: ProviderConfig;        // NEW — for artifact `model` column stamps
}
```
No change to `ToolResult` — the existing `detail?: unknown` already carries
`{ artifact: { kind, id } }` (rendered by `MessageRow`). No change to `Tool`,
`ToolDefinition`, `registerTool`, `getToolDefinitions`, `getToolDefinition`,
`toolsRun`.

> The two loop call sites that build a `ToolContext` (Task 4) must be updated to
> pass `model` / `config` — but that's Task 4, not this one. Nothing calls the
> new fields between Task 1 and Task 4, and `tsc` stays green because the new
> fields are added to the type the loop already constructs.

### Task 2 — Create the generative tools
**New file:** `src/lib/agent/generative-tools.ts`

Exports `generativeTools: Tool[]` (two entries), each reusing the AG1
`generateObject` orchestrators + existing `repos.*` only (never `db`). Both are
`risk:'high'`, `generative:true`. Each validates args and returns
`{ ok:false, summary }` on bad input / failure (never throws into the turn;
`toolsRun` also wraps). Parameters use the shared `toolSchema(...)` helper
(follow `deterministic-tools.ts:6`).

- **`create_quiz`** — params `{ topic?: string, questionCount?: number }` (both
  optional; passed through to orient the quiz but the model/brief still drives
  content — they are hints, not hard constraints). `run`:
  1. `const ctx = await assembleContext(ctxArg.chatId)` — identical grounding to
     `quizzesStore.generate` (decision #8).
  2. `const generated = await generateQuiz(ctxArg.model, ctx, { signal:
     ctxArg.signal })` — depth-1 by construction (no `tools`).
  3. **No-orphan guard:** `if (ctxArg.signal?.aborted) return { ok:false,
     summary:'aborted' };`
  4. `const items = toQuizQuestions(generated); const quiz = await
     repos.quizzes.create({ chatId: ctxArg.chatId, model:
     ctxArg.config.defaultModel });` then loop `repos.quizQuestions.add(...)`
     (mirror `quizzes.svelte.ts:163-172`).
  5. Return `{ ok:true, summary: \`Created quiz "${firstQuestionTopicOrTitle}"
     (${items.length} questions)\`, detail: { artifact: { kind:'quiz', id:
     quiz.id } } }`. Summary is the row-link text — keep it human-readable.
  - Failure: `QuizGenerationError` → `{ ok:false, summary:'quiz generation
    failed' }` (the raw is already swallowed by the generator; do not offer
    "save raw" from the agent path — that's a button-only affordance).

- **`create_lab`** — symmetric. params `{ topic?: string }`. `run`:
  `assembleContext` → `generateLab(ctxArg.model, ctx, { signal })` →
  no-orphan guard → `toLabContent(generated)` → `repos.labs.create({ chatId,
  title, content, checklist, model: ctxArg.config.defaultModel })` (mirror
  `labs.svelte.ts:93-100`). Return `{ ok:true, summary:\`Created lab
  "${title}"\`, detail:{ artifact:{ kind:'lab', id: lab.id } } }`.
  `LabGenerationError` → `{ ok:false, summary:'lab generation failed' }`.

> **Budget:** the tools do **not** check `ctx.budget` — the loop is the authority
> (decision #2). The tool trusts the loop: if it was called, the budget was
> available. (A defensive `ctx.budget` read is allowed but not required.)

### Task 3 — Register the generative tools
**Modify:** `src/lib/agent/registry.ts` (bottom, next to the deterministic import)

```ts
import { generativeTools } from './generative-tools';
for (const t of generativeTools) registerTool(t);
```
After this, `getToolDefinitions()` includes `create_quiz` / `create_lab` with
`generative:true`. `buildSdkTools` still skips them until Task 4.

### Task 4 — Wire the loop: manifest + turn-scoped budget gate
**Modify:** `src/lib/agent/loop.ts`

1. **Include generative tools in the manifest.** In `buildSdkTools(enabled)`
  (`loop.ts:52-63`), remove `if (def.generative) continue;` so all registered
  defs (incl. `generative:true`) become SDK `tool()` definitions. The `tool()`
  defs still carry **no `execute`** — we dispatch.

2. **Create one turn-scoped budget.** At the top of `runAgentTurn` (inside
  `inner`), add:
  ```ts
  const turnBudget = { subCalls: 0, maxSubCalls: 1 };
  ```
  This single mutable ref is shared across every iteration + every tool
  dispatch in the turn.

3. **Gate generative tools in the high-track.** Generative tools are
  `risk:'high'`, so they reach the high-track's approved-tools sequential loop
  (`loop.ts:296-313`). Before each approved tool's `toolsRun` call, add the
  gate:
  ```ts
  // after the approval decision, before toolsRun:
  const def = getToolDefinition(tc.toolName);
  if (def?.generative && turnBudget.subCalls >= turnBudget.maxSubCalls) {
    results.push({ tc, result: { ok:false, summary:'one generative action per turn' } });
    continue; // do NOT call toolsRun; budget spent
  }
  if (def?.generative) turnBudget.subCalls++;
  ```
  Then call `toolsRun(...)` with `ToolContext` carrying `model: deps.model`,
  `config: deps.config`, and `budget: turnBudget` (the shared ref).

4. **Pass `model`/`config`/`budget` at both ToolContext call sites** (`loop.ts:261`
  auto-track and `loop.ts:304` high-track). Replace the throwaway
  `budget:{ subCalls:0, maxSubCalls:1 }` literals with `budget: turnBudget` and
  add `model: deps.model, config: deps.config`. (Generative tools never reach the
  auto-track since they're `risk:'high'`, but the auto-track's ctx is built the
  same way for uniformity — `turnBudget` is harmless there; no generative auto
  tool exists to increment it.)

5. The critic, safety-net, exhaustion-note, abort/partial-persistence, and
  every-emitted-tool-call-gets-a-result paths are **unchanged**. A refused
  (budget-spent) generative call still persists a tool-result row with the
  refusal summary — no orphaned tool-call row, consistent with AG4's decline
  handling.

> **No race:** generative tools are `risk:'high'` and run in the high-track's
> **sequential** approved-tools loop (AG4 decision #1). The check-and-increment is
> synchronous, so even hypothetically-concurrent dispatches cannot both pass.

### Task 5 — Extend the capabilities preamble
**Modify:** `src/lib/chat/brief.ts`

Extend `buildCapabilitiesPreamble()` to also state that the tutor can **offer to
create a quiz or lab** from the current unit when it would help the learner
solidify the material, that it **will ask before** creating anything, and (per
the cap) it makes **at most one** such artifact per turn. Keep it ~1–2 added
lines; still a pure string appended only when `toolCapability` is true (omitted
entirely on degraded providers → today's behavior). Reinforce "prefer continuing
the lesson over invoking tools" (already present from AG4).

### Task 6 — Tests

Harness is **node-only** (no jsdom) → no component render tests; cover logic via
loop + tools tests.

**New file:** `src/lib/agent/generative-tools.test.ts` — over the in-memory driver
(pattern of `deterministic-tools.test.ts`). Mock the generators
(`vi.mock('$lib/ai/generate/generate-quiz')` +
`vi.mock('$lib/ai/generate/generate')`) to return canned `GeneratedQuiz` /
`GeneratedLab` (assert `generateObject`/`streamText` are NOT directly invoked by
the tool — it goes through the orchestrators):
- `create_quiz`: approved-style ctx → `repos.quizzes.create` + N
  `quizQuestions.add` happen; `detail.artifact = { kind:'quiz', id }`; question
  count matches the canned payload; a follow-up `assembleContext` carries the
  persisted rows.
- `create_lab`: `repos.labs.create` with `toLabContent`-flattened content +
  checklist; `detail.artifact = { kind:'lab', id }`.
- **No-orphan:** set `signal.aborted = true` before the run and assert the
  generator is **not** called (the tool could also check post-generate; pick the
  post-generate guard — abort the signal right after the mocked generator
  resolves, assert **no** `repos.quizzes.create` / `repos.labs.create` ran).
- `QuizGenerationError` / `LabGenerationError` → `{ ok:false }`; no artifact
  created.
- Args: missing optional `topic` still works; `questionCount` hint is ignored
  (content follows the model/brief).

**Modify:** `src/lib/agent/loop.test.ts` — extend the mocked `toolDefs`
(`loop.test.ts:42-64`) with a `create_quiz` entry (`generative:true,
risk:'high'`); wire `deps.model`/`deps.config` into `makeDeps`. New cases:
- **(o) manifest:** when enabled, `streamText` is called with `tools` that now
  **includes** `create_quiz` (the `generative` skip is gone); when disabled,
  `tools:{}`.
- **(p) first generative approved runs:** high-track approval → `{approved:true}`
  → `toolsRun` called with `ctx.model`/`ctx.config`/a `budget` whose
  `maxSubCalls===1`; result persisted in emitted order.
- **(q) cap-depth-one enforced:** two `create_quiz` calls in one iteration →
  both approvals `{approved:true}` → `toolsRun` called **once**; the second is
  synthesized as `{ ok:false, summary:'one generative action per turn' }`
  **without** calling `toolsRun`; both tool-result rows persist (no orphan).
- **(r) refused then continue:** after a refused generative call the loop
  proceeds; the model's next iteration is text-only and finalizes normally.
- **(s) non-generative high tool unaffected:** `branch_chat` + `create_quiz` in
  the same iteration → both approved; `branch_chat` runs unconditionally,
  `create_quiz` runs once; the branch is not budget-gated.
- **Regression:** existing (a)–(n) still pass — confirm the auto-track stays
  sequential, and the only structural change is the manifest now includes
  generative defs + the budget gate sits before the high-track `toolsRun`.

**Modify:** `src/lib/agent/registry.test.ts` — update the count/risk assertion to
include `create_quiz` / `create_lab` (`generative:true, risk:'high'`); assert
`getToolDefinitions()` returns exactly the readonly + deterministic + generative
set.

### Task 7 — Acceptance
- `pnpm test` / `pnpm check` / `pnpm lint` clean.
- **Capable provider (e.g. Z.AI GLM / Anthropic):** the tutor offers "I'll turn
  this unit into a quiz"; the **approval card** appears with parsed args;
  **Approve** → the quiz is generated (grounded in the brief + strategy, same as
  the button) and a **link to `/quiz/<id>`** appears on the tool-result row; the
  model announces it in its next iteration; **Decline** → the model acknowledges
  and continues the lesson.
- **Lab:** symmetric — approve `create_lab` → `/lab/<id>` link; checklist is
  interactive.
- **Cap-depth-one:** if the model emits two `create_quiz` calls in one turn,
  only the first runs; the second is refused with "one generative action per
  turn" and the model continues.
- **Switching providers mid-chat + re-offering** works (the depth-1 ceiling
  holds across the switch; budget is per-turn).
- **Abort:** hit **Stop** mid-generation → no orphaned empty quiz/lab row;
  `Stop` aborts the sub-call cleanly (partial text persists, today's contract).
- **Reload** persists the tool-call/result rows; a **branch** off such a turn
  inherits them via `assembleContext`.
- **Incapable provider (tool-less Ollama / `'off'`):** chat is exactly AG4 — no
  generative tools sent, no cards; the **buttons** still work (they use
  `generateObject`, which needs no tool-calling).
- **Dev:** the extended strategy-lint logs tool-call counts; the capabilities
  preamble's create-offer line appears only when tools are live.

## Risks / edge cases
- **Budget-gate placement.** The gate must sit in the high-track's **sequential**
  approved-tools loop, before each `toolsRun` (not in `toolsRun` itself, which is
  mocked in the loop test). Verify (q) covers it and (r)/(s) confirm non-generative
  tools are unaffected.
- **Silent sub-call latency.** `generateObject` is non-streaming, so during the
  generative sub-call the streamBuffer does not advance. The approval card already
  set expectation; a "Generating…" toast is deferred polish (decision #6). Verify
  the UI does not appear frozen (the card remains visible until the result row
  replaces it).
- **Quiz multi-row orphan window.** Between `repos.quizzes.create` and the
  question inserts there is a sub-ms window where an abort could leave an empty
  quiz. The post-generate `signal.aborted` check closes the network-abort gap;
  the residual local-write window is accepted (identical to the button path). No
  transaction primitive is added (scope creep).
- **`generateObject` failure.** The generators already retry internally
  (`maxRetries:2`). On final failure the tool returns `{ ok:false }`; the budget
  is spent (one attempt per turn — the model re-offers next turn, not this one).
- **Manifest token cost.** Generative tool specs now travel in the `tools` field
  on capable providers (only ~2 entries); on degraded providers the manifest is
  empty (today's behavior). Acceptable.
- **Model re-offering after refusal.** Bounded by `maxIterations` (6) + the
  preamble instruction not to re-request a declined action. No extra hard guard;
  acceptable per design.

## Out of scope (later phases)
- `validate_*` self-check tools, cross-chat agency, multi-step plans, deeper
  recursion — **AG6** (opt-in / future).
- A "Generating…" progress toast and a reactive artifact-list refresh mid-turn —
  polish, not in scope.
- A transactional quiz-create (batch/`StorageDriver.batch` wrapper) — only if the
  orphan window proves to matter in dogfooding.
- Auto-navigation to the created artifact — explicitly declined (decision #1);
  the row link is the path.
