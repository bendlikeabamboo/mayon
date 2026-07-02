# TP3 — Inferred brief gains a `persona` suggestion

**Epic:** `refinement/teacher-personas-phased.md` → TP3 (Inference integration).
**Status of prior phases:** TP1 (persona registry + system-note injection) and TP2
(intake/Settings UI + chat header) are **already shipped** in `personas.ts`,
`brief.ts`, `BriefCard.svelte`. This phase is the last, optional slice.

## Goal

Let the AI-inferred brief propose a teacher persona from the learner's first
message tone. "Just start chatting" can then suggest e.g. Kit for a casual
message, surfaced in the inferred-brief card and persisted via the existing
`saveBrief` path. No new persistence, no migration — persona rides in the
existing `chats.brief` JSON column.

## Why this is a one-file change (verified)

- `confirmInferredBrief` (`src/lib/stores/chat.svelte.ts:430`) passes the **whole
  `GeneratedBrief`** object to `saveBrief`. Adding `persona` to `GeneratedBrief`
  therefore flows to the stored brief with **no downstream plumbing**.
- BriefCard edit mode preserves `brief.persona` (`BriefCard.svelte:64`) and the
  `onMount` profile-reseed is skipped when `mode !== 'intake'`
  (`BriefCard.svelte:75`) → an inferred persona survives if the user edits the
  brief before confirming.
- `readBriefPrompt` (`generate-brief.ts:94`) only falls back to
  `DEFAULT_BRIEF_PROMPT`; a user-stored `briefPrompt` override is never touched.

## Decision resolved

**Persona-suggestion guidance = brief 5-persona tone mapping with explicit Dr.
Kim fallback.** When the learner's tone is neutral/unclear, the prompt instructs
the model to **omit** `persona`, so the field stays optional and resolves to
`DEFAULT_PERSONA` (`dr-kim`) via `applyProfile` (already in `brief.ts:128`).

## Changes

### 1. `src/lib/ai/generate/generate-brief.ts` (edit)

- **Imports:** add `PERSONA_IDS`, `type PersonaId` from `$lib/chat/personas`
  (or re-export through `$lib/chat/brief`, which already re-exports them — prefer
  the same import source as the existing `SCOPE_STRATEGY_IDS` from
  `$lib/chat/strategies`, i.e. via `$lib/chat/brief`).

- **`GeneratedBrief` type:** add `'persona'` to the `Pick<LearningBrief, ...>`
  list (so it becomes
  `'goal' | 'context' | 'level' | 'mode' | 'scopeStrategy' | 'scope' | 'persona'`).

- **`GeneratedBriefSchema` (`.strict()`):** add, mirroring the `scopeStrategy`
  line:
  ```ts
  persona: z.enum(PERSONA_IDS as [PersonaId, ...PersonaId[]]).optional(),
  ```
  > **Implementation note:** `PERSONA_IDS` is typed `readonly PersonaId[]`
  > (derived via `.map()`, not `as const` like `SCOPE_STRATEGY_IDS`). `z.enum`
  > requires a tuple, hence the cast. Run `pnpm check` to confirm it compiles;
  > if the direct cast errors, use `as unknown as [PersonaId, ...PersonaId[]]`.

- **`DEFAULT_BRIEF_PROMPT`:**
  - Add a field-list line after `scope` (mirror the `scopeStrategy` line's
    style):
    ```
    - "persona": string (optional) — one of: professor-ada, coach-rex, dr-kim, kit, sage. Suggest the teacher voice that best matches the learner's tone: playful/informal → kit; formal, precise → professor-ada; high-energy, wants to be pushed → coach-rex; terse, advanced → sage. If the tone is neutral or unclear, OMIT this field (defaults to dr-kim).
    ```
  - Add `"persona": "kit"` to the example JSON object.
  - Append `persona` to the final strict-fields instruction line (the one that
    currently reads `"...fields other than goal, context, level, mode, scopeStrategy, scope."`).

### 2. `src/lib/ai/generate/generate-brief.test.ts` (edit)

Keep the existing `validBrief` fixture persona-less (field stays optional). Add:
- In `describe('GeneratedBriefSchema (strict)')`:
  - accepts a valid `persona` (`{ goal: 'x', persona: 'kit' }` → kept).
  - rejects an unknown persona id (`{ ...validBrief, persona: 'nobody' }` → throws).
  - (extra-key rejection is already covered generically by `.strict()`; no new
    assertion needed for that.)
- In `describe('parseGeneratedBrief')`: a fenced JSON block that includes
  `persona` round-trips through `parseGeneratedBrief`.
- In `describe('DEFAULT_BRIEF_PROMPT')`: assert the prompt string `toContain('persona')`
  and `toContain('dr-kim')`.

### Optional (not required for TP3 acceptance)

- Extend the `inferredBrief` mock in `chat.svelte.test.ts:601` with `persona: 'kit'`
  and assert it persists through `confirmInferredBrief`. Low value (plumbing is
  the same generic pass-through) — include only if a regression guard is wanted.

## Out of scope

- Any UI change (TP2 already renders persona in BriefCard + header).
- Any DB/migration work (persona is JSON, not a column).
- Enforcing persona choice via post-processing — it is *instructed*, never
  rewritten (per cross-cutting concerns in the spec).
- TP3's optional "fold into Phase C brief-inference work" — done as its own slice
  here, per the user request.

## Risks / edge cases

- **Model always emits a persona.** Mitigated by the explicit "OMIT when unclear"
  instruction, the optional schema field, and the Dr. Kim fallback in
  `applyProfile`. No hard failure mode.
- **Unknown/garbage persona from the model.** `.strict()` schema rejects unknown
  enum values → `BriefParseError`; `inferBriefRoot` swallows it best-effort
  (`chat.svelte.ts:505`) so inference simply yields no brief. Acceptable.
- **zod enum tuple cast** — see implementation note above; verify with
  `pnpm check`.
- **Stalled `briefPrompt` override:** a user who previously persisted a custom
  `briefPrompt` will not see the new `persona` field until they clear it. This
  matches existing behavior (overrides override the default) — no action.

## Verification

- `pnpm test` (the `generate-brief` suite), `pnpm check`, `pnpm lint` — all clean.
- Manual: `pnpm dev` → "Just start chatting" on a fresh root → type a casual
  message → the inferred-brief card shows a proposed persona (e.g. Kit) →
  "Use this" applies it → next reply adopts that voice; reload persists.
- Manual fallback: a formal/neutral message yields no persona suggestion (or
  Dr. Kim) and behaves exactly as today.
