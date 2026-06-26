# Phase C — AI-inferred brief (after first message)

Epic source: `refinement/learning-brief-refinement.md` §"Phase C". Sibling plan:
`.kilo/plans/1782467196576-learning-brief-epic.md`. This phase builds **on top of**
the as-built Phase A (brief column + `assembleContext` note) and Phase B (learner
profile snapshot). **Both A and B are already shipped** in this repo (verified:
`brief.ts` has `LearnerProfile`/`applyProfile`, `src/lib/chat/profile.ts` exists,
`BriefCard` pre-fills from the profile).

## Goal

For a **brief-less root**, after the learner's first user message, infer a
`LearningBrief` from the conversation and surface it as an inline
confirm/edit/dismiss card. One-tap confirm recalibrates subsequent turns. Never
fires for chats that already have a brief, or for branches; never overrides a
manual brief. Mirrors the `autoTitleRoot` best-effort parallel-request pattern.

## Resolved decisions

1. **Inferred card = dedicated inline confirm block** rendered in the route — a
   read-only summary (via `summarizeBrief`) with three actions: **Use this** /
   **Edit** / **Dismiss**. `BriefCard` is reused **only** for the Edit sub-flow
   (`mode="edit"`, seeded from the inferred brief). Keeps `BriefCard` a pure form.
2. **Inference forces `reasoning: 'disabled'`** (the `generateTitle` precedent).
   It is a short structured-extraction call fired in parallel on the first message;
   thinking tokens would be wasted on a tiny JSON extraction.
3. **Dismiss-vs-in-flight race:** a private `inferDismissed` flag gates the
   completion — the parallel `inferBriefRoot` sets `inferredBrief` **only if
   `!inferDismissed`**. `dismissInferredBrief()` sets the flag + clears the
   display. The flag resets on `load()` (per-chat session), so the next chat can
   infer. (Dismiss does **not** need to abort the controller — the flag is the
   source of truth, avoiding partial-result waste.)

## Trigger predicate (the single correctness invariant)

Inference fires in `send()` exactly when **all** hold:
- `chat.parentId === null` (root — branches never fire),
- `parseBrief(chat.brief) === null` (no manual brief),
- `isFirstRootTurn` is already true (the existing `send()` guard at
  `chat.svelte.ts:140`).

Re-entrancy guard: a private `inferring` boolean (mirrors `titling`) prevents a
double-fire. After a dismiss this session, `inferDismissed` blocks a re-fire even
if `send()` were somehow called again.

## Data flow

1. `send()` persists the user row, then — alongside the existing
   `autoTitleRoot` parallel fire — calls `void this.inferBriefRoot(provider, ctx)`.
   `ctx` is the **already-assembled** `assembleContext` result (the first user
   message is now in it). Not awaited (mirrors `autoTitleRoot`).
2. `inferBriefRoot` runs `generateBrief(provider, ctx, { signal })` (reasoning
   OFF), parses to a strict `GeneratedBrief`. On success + `!inferDismissed` →
   sets `inferredBrief`. All errors swallowed. Own `inferController`, aborted on
   `load()`/`deleteChat()` (not on `stop()`).
3. Route renders the inferred card when `chatStore.inferredBrief` is set AND it's
   a brief-less root.
4. **Use this** → `confirmInferredBrief()` = `saveBrief(inferredBrief)` then
   clear state (brief now flows through Phase A's `assembleContext`).
5. **Edit** → open `BriefCard mode="edit"` seeded from `inferredBrief`; on save →
   `confirmInferredBrief(edited)`.
6. **Dismiss** → `dismissInferredBrief()` (sticky for the session).

## Files to create

### `src/lib/ai/generate/generate-brief.ts` (orchestrator, mirrors `generate.ts`)
- `export const DEFAULT_BRIEF_PROMPT` — instruct the model to read the
  conversation (which opens with the first user message) and emit ONE concise
  `LearningBrief` as a single fenced JSON block. Must reference the exact field
  shape and the `level`/`mode` enum values. Built with the same `String.fromCharCode(96)`
  backtick-escape technique as `generate.ts`/`generate-quiz.ts` so the prompt can
  show the model a ```json fence without source-level escaping.
- `export async function readBriefPrompt(): Promise<string>` — read the
  `briefPrompt` settings KV override, else `DEFAULT_BRIEF_PROMPT` (mirrors
  `readLabPrompt` in `generate.ts:113`).
- `export interface GeneratedBrief` = `Pick<LearningBrief, 'goal'|'context'|'level'|'mode'|'scope'>`
  with `goal` required.
- `export const GeneratedBriefSchema` — `z.object({ goal: z.string().min(1),
  context: z.string().optional(), level: z.enum(LEVEL_OPTIONS).optional(),
  mode: z.enum(MODE_OPTIONS).optional(), scope: z.string().optional() }).strict()`.
  Import `LEVEL_OPTIONS`/`MODE_OPTIONS` from `$lib/chat/brief`. `.strict()` rejects
  unknown keys; enum validation rejects bad level/mode. (Coerce via
  `z.preprocess` is NOT needed — `parseBrief` already tolerates missing optionals.)
- `export class BriefParseError extends Error { constructor(message, public readonly raw) }`
  with `name = 'BriefParseError'` (mirrors `LabParseError` in `lab.ts:63`).
- `export function parseGeneratedBrief(raw: string): GeneratedBrief` —
  `extractFencedJson` (from `./fence`) → `JSON.parse` → `GeneratedBriefSchema.safeParse`;
  throw `BriefParseError(raw)` on any failure.
- `export async function generateBrief(provider, messages, opts?): Promise<GeneratedBrief>`
  — **force `reasoning: 'disabled'`** in the `accumulate` call (title precedent).
  Retry loop: max 3 attempts; on `BriefParseError` feed bad output + correction as
  `[assistant: lastRaw, user: CORRECTION]` and re-stream; after max attempts throw
  `BriefGenerationError` carrying `lastRaw`. `AbortError`/transport errors
  propagate (do not retry). Mirror `generate.ts:130` exactly, swapping
  `parseGeneratedLab`→`parseGeneratedBrief`.
- `export class BriefGenerationError extends Error` (carries `raw`) — mirrors
  `LabGenerationError`. **Note:** the store swallows ALL inference errors (best
  effort), so `BriefGenerationError` is for callers/tests; it never reaches
  `formatProviderError` or the chat error UI.
- Re-export `extractFencedJson` from `./fence` (consistency with `lab.ts:18`).

### `src/lib/ai/generate/generate-brief.test.ts` (mirrors `lab.test.ts` + `generate.test.ts`)
- `GeneratedBriefSchema`: valid round-trip; `goal` required (empty rejected);
  unknown key rejected (`.strict()`); bad `level` enum rejected; bad `mode` enum
  rejected; missing optionals accepted.
- `parseGeneratedBrief`: fenced-JSON + bare-JSON parse; non-JSON → `BriefParseError`
  (with `.raw`); schema mismatch → `BriefParseError`.
- `generateBrief` with a `scriptedProvider` (copy from `generate.test.ts:16`):
  parses valid first attempt; retries once and succeeds; feeds bad output +
  correction on retry; throws `BriefGenerationError` (with raw) after 3 failures;
  propagates `AbortError` without retry; does not retry on non-parse transport
  error.
- `generateBrief` asserts the call is made with `reasoning: 'disabled'` (record
  the `opts`).
- `DEFAULT_BRIEF_PROMPT` smoke test (contains the fence + field names).

## Files to modify

### `src/lib/stores/chat.svelte.ts`
- Imports: `generateBrief`, `GeneratedBrief` from `generate-brief.ts`; `parseBrief`
  from `brief.ts` (already imports `LearningBrief`).
- New state (alongside `titling`/`titleController`):
  - `inferredBrief = $state<LearningBrief | null>(null)` (the proposed brief).
  - `inferring = false` (re-entrancy guard, private).
  - `inferDismissed = false` (sticky dismiss, private).
  - `private inferController: AbortController | null = null`.
- In `send()`, where `autoTitleRoot` is fired (`chat.svelte.ts:161`), add the
  inference fire when the brief predicate holds. Compute the predicate once
  (reuse `isFirstRootTurn && chat && chat.parentId === null &&
  parseBrief(chat.brief) === null`), then `void this.inferBriefRoot(provider, ctx)`.
  (`ctx` is the already-awaited `assembleContext` result.)
- New private `async inferBriefRoot(provider, ctx)`: mirror `autoTitleRoot`
  structure — guard (`!this.chat`, re-entrancy via `inferring`), create
  `inferController`, try `generateBrief(provider, ctx, { signal })`, on success
  set `inferredBrief` **only if `!this.inferDismissed`**, swallow all errors in
  `catch`, clear `inferring`/`inferController` in `finally`.
- `async confirmInferredBrief(b?: LearningBrief): Promise<void>` —
  `await this.saveBrief(b ?? this.inferredBrief!)`, then reset
  `inferredBrief = null; inferDismissed = false`.
- `dismissInferredBrief(): void` — `inferDismissed = true; inferredBrief = null`.
- Reset in `load()`: abort `inferController`, set `inferredBrief = null`,
  `inferDismissed = false`, `inferring = false` (alongside the existing
  `titleController` abort + state reset).
- Reset in `deleteChat()` (same abort + clear, mirroring the `titleController`
  handling).

### `src/lib/stores/chat.svelte.test.ts` (extend, new `describe('chatStore inferred brief')`)
Use the existing `recordingProvider` pattern; **provider disambiguation**: title,
brief, and main reply each prepend a distinct `system` message — distinguish the
three calls by **system-prompt content sentinel**, not role alone (the lab/quiz
suites show the precedent). Tests:
- First message on a null-brief root → `inferredBrief` is set (poll with a
  `waitFor` like the title suite's `waitForTitle`).
- Briefed root (`createAndNavigate({ brief })` then `send`) → `inferredBrief`
  stays `null` (predicate short-circuits).
- Branch (`createChild` then `send`) → `inferredBrief` stays `null`.
- `confirmInferredBrief()` persists the brief (row + store) and clears
  `inferredBrief`.
- `confirmInferredBrief(edited)` persists the edited value.
- `dismissInferredBrief()` clears `inferredBrief` without persisting.
- **Dismiss-race guard:** start slow inference, call `dismissInferredBrief()`,
  then let inference complete → `inferredBrief` stays `null` (flag gated it).
- Inference call runs with `reasoning: 'disabled'`.
- Aborts `inferController` on `load()` switch (mirror the title abort test).

### `src/routes/chat/[id]/+page.svelte`
- New local state: `let editingInferred = $state(false);` (Edit sub-flow).
- Reset `editingInferred = false` in `loadAll()`.
- In the brief-state branch chain (after `showBriefIntake` / `rootBrief && editingBrief` /
  `rootBrief` summary chip, ~line 231), add: when `chatStore.inferredBrief &&
  !rootBrief && chatStore.chat?.parentId === null && !editingInferred` → render
  the **dedicated inline confirm block**:
  - Summary line: `summarizeBrief(chatStore.inferredBrief)` (reuse existing
    `summarizeBrief` import), prefixed with a "Heard:" / sparkle affordance.
  - Three `Button`s: **Use this** → `onConfirmInferred` (call
    `chatStore.confirmInferredBrief()`); **Edit** → set `editingInferred = true`;
    **Dismiss** → `chatStore.dismissInferredBrief()`.
- When `editingInferred` → render `BriefCard mode="edit" brief={chatStore.inferredBrief}`
  with `onSave={onSaveInferred}` (`await chatStore.confirmInferredBrief(b);
  editingInferred = false;`) and `onDismiss={() => { editingInferred = false; }}`.
- Styling matches the existing `border-border bg-card` confirm cards.

## Explicitly NOT in scope (no change needed)

- **No DB migration** — the `brief` column exists (Phase A); `saveBrief`/`updateBrief`
  persist an inferred brief identically to a manual one.
- **No `context.ts` change** — a confirmed inferred brief flows through Phase A's
  `assembleContext` brief note unchanged.
- **No lab/quiz/generate change** — they already align to the brief via
  `assembleContext`.
- **No `Provider` interface / adapter change** — `generateBrief` drives
  `provider.chatStream` directly (like `generateTitle`), so every adapter works
  with no per-adapter wiring.
- Per-branch brief overrides; mastery/SR tracking — out of scope for the epic.

## Risks / failure modes

- **Inference quality:** best-effort + dismissable; a wrong guess is corrected via
  Edit or rejected via Dismiss. Strict Zod guards against malformed model output.
- **Provider errors / no provider:** swallowed in `inferBriefRoot`; the chat reply
  is unaffected. (Mirrors `autoTitleRoot`.)
- **Three parallel calls on first message** (title + brief + main reply) — bounded
  (two are tiny, reasoning-off) and abortable. Test provider must disambiguate by
  system-prompt content.
- **Token cost:** one extra short call after the first message only; negligible.
- **Dismiss stickiness:** the `inferDismissed` flag is the source of truth; a late
  completion cannot re-show the card. Resets per chat on `load()`.

## Validation

- `pnpm test` (new `generate-brief.test.ts` + `chat.svelte.test.ts` inferred-brief
  suite) — all green.
- `pnpm check` (svelte-check clean) · `pnpm lint`.
- Manual (`pnpm dev`, http://localhost:5173):
  1. New chat → **"Just start chatting"** → send a first message → inferred card
     appears with a goal/level/mode → **Use this** → next reply recalibrates to
     the brief; **reload** persists the brief.
  2. Same flow → **Dismiss** → card gone, chat stays brief-less, no re-fire on
     further messages this session.
  3. Same flow → **Edit** → edit fields → save → edited brief applies.
  4. A chat created via the intake (**"Start learning"**, i.e. already briefed)
     never triggers inference after its first message.
  5. A branch never triggers inference.
