# Mayon — Teacher Personas: Phased Build Plan

Implementation phases for the **teacher persona** epic defined in
`refinement/teacher-personas.md`. Treat that doc as the authoritative design;
this is the delivery breakdown.

> Each phase ships a demonstrable slice and is the prerequisite ordering for the
> next. `TP1` and `TP2` can be merged into a single phase (S total); `TP3` is
> optional and may fold into Phase C brief-inference work.

## Locked decisions (resolved from design §12)

| # | Decision | Resolution |
| - | -------- | ---------- |
| 1 | Default persona | **Dr. Kim** — warm, patient, safe. The most universally approachable default. |
| 2 | Header display | **"MAYON · <persona name>"** alongside the brief summary chip. |
| 3 | Mid-chat switching | **Allowed.** Change persists in `chats.brief` via `saveBrief`; takes effect on next turn. Past turns retain old voice. |
| 4 | Pronouns in UI | **Not needed.** Kit's they/them is implicit in the block text. |
| 5 | Custom persona seam | **Yes** — future `customPersona` text KV on the profile that `buildBriefSystemNote` checks before falling back to the curated registry. |
| 6 | Localization | **English-only.** Persona voice is tightly coupled to language. |
| 7 | Persona-less old briefs | **Degrade gracefully.** No persona field → default to Dr. Kim. The existing null-brief escape hatch is preserved. |
| 8 | System-note ordering | **Persona block before strategy block.** Voice frames before structural rules. |

---

## Milestones at a glance

| Phase | Name | Result | Size | Depends on |
| ----- | ---- | ------ | ---- | ---------- |
| TP1 | Persona registry + system-note injection | 5 personas registered; `buildBriefSystemNote` emits persona voice; profile + brief carry persona; defaults to Dr. Kim. No UI picker yet. | S | — |
| TP2 | Intake + Settings UI | Teacher picker in BriefCard; default in LearnerProfileConfig; chat header display; mid-chat switching. | S | TP1 |
| TP3 | Chat header + inference integration | Persona name in chat header; `generate-brief` schema extended for persona suggestion. | XS | TP1 |

### Recommended sequencing

```
TP1 → TP2 → TP3
```

`TP1` and `TP2` can ship as one phase. `TP3` is optional and may fold into the
existing Phase C brief-inference work.

---

## TP1 — Persona registry + system-note injection `Size: S`

**Goal:** the five curated personas exist as typed data; the system-note builder
injects the resolved persona block; the brief and profile carry the persona field
with correct precedence (brief > profile > `'dr-kim'`). After TP1, every chat
with a resolved brief gets Dr. Kim's voice in the system prompt — no picker UI
yet, just the correct default.

**Scope**

- **Persona registry** + resolution helpers in a new `src/lib/chat/personas.ts`:
  `PersonaId`, `PersonaDefinition`, `PERSONAS`, `PERSONA_IDS`, `personaForId`,
  `defaultPersona()`. The five blocks verbatim from design §4.
- Extend `buildBriefSystemNote` (`brief.ts:181`) to **emit the persona block**
  between the calibration lines and the strategy block (design §7). When no
  persona is resolved (or old briefs without the field), the system note
  degrades to today's exact output — the hardcoded `"You are a personal learning
  tutor."` line and no persona block.
- Extend `parseBrief` (`brief.ts:145`) with an `isPersonaId` guard so the new
  field round-trips safely (unknown/garbage → omitted → default).
- Extend `applyProfile` (`brief.ts:110`) precedence to include `persona`
  (brief > profile > `'dr-kim'`); extend `LearnerProfile` + `DEFAULT_PROFILE`.
- Extend `LearningBrief` with `persona?: PersonaId`.
- Extend `ResolvedBriefFields` with `persona: PersonaId`.
- `buildBrief` in `BriefCard.svelte` includes `persona` (without a picker yet —
  seeded from profile default).

### New files

- `src/lib/chat/personas.ts` — **the registry + block text.** Splitting the
  long block strings out of `brief.ts` keeps that module's parser/note-builder
  focused (mirrors `strategies.ts`). Exports the types and `PERSONAS` array.
  ```ts
  export type PersonaId =
    | 'professor-ada'
    | 'coach-rex'
    | 'dr-kim'
    | 'kit'
    | 'sage';

  export interface PersonaDefinition {
    id: PersonaId;
    name: string;       // "Professor Ada"
    summary: string;    // "precise, dry wit, no-nonsense encouragement"
    block: string;      // the prompt-engineering payload (design §4)
  }

  export const PERSONAS: PersonaDefinition[];
  export const PERSONA_IDS: PersonaId[];
  export const DEFAULT_PERSONA: PersonaId = 'dr-kim';
  export function personaForId(id: PersonaId): PersonaDefinition;
  export function isPersonaId(v: unknown): v is PersonaId;
  ```

### Modified files

- **`src/lib/chat/brief.ts`** — re-export persona types (`PersonaId`,
  `PersonaDefinition`, `PERSONAS`, `PERSONA_IDS`, `personaForId`,
  `DEFAULT_PERSONA`); extend `LearningBrief` with `persona?`; extend
  `parseBrief` (add `isPersonaId` guard line, ~`brief.ts:168`); extend
  `applyProfile` to resolve persona precedence; extend `LearnerProfile`,
  `DEFAULT_PROFILE`, `ResolvedBriefFields`; rewrite `buildBriefSystemNote`
  to inject the persona block:
  ```text
  You are <persona.name>. <first sentence of persona.block>

  Calibrate to this learner's brief:
  - Goal: <goal>
  - Level: <level>  · Context: <context>  · Mode: <mode>  · Scope: <scope>
  - Structure: <strategy.label>

  [optional scope budget instruction]

  <persona.block>

  <strategy.block>

  Teach to the goal at the stated level; stay within scope.
  When the learner can do the goal, say so.
  ```
  When `persona` is not resolved (null/undefined), emit the current
  `"You are a personal learning tutor."` line — byte-for-byte identical to today.
- **`src/lib/chat/profile.ts`** — add `isPersonaId` validation for the
  `persona` field in `getLearnerProfile` (same pattern as `isScopeStrategyId`).
- **`src/lib/components/chat/BriefCard.svelte`** — add `persona` to
  `buildBrief()` (line ~93). No picker UI — just seed from profile default.
- **`src/lib/chat/brief.test.ts`** — persona resolution tests (brief > profile >
  default), `parseBrief` round-trip with `persona`, `buildBriefSystemNote`
  with and without persona (persona-less → byte-for-byte today's output;
  persona present → block appears before strategy block; all five personas
  render correctly).

### Tests

- `brief.test.ts`: `parseBrief` accepts/rejects `persona` (valid enum → kept;
  invalid string → dropped; no persona → omitted); `applyProfile` resolves
  persona precedence (brief > profile > `'dr-kim'`); `buildBriefSystemNote`
  with persona → note contains persona name in the opening line + persona
  block + strategy block in the correct order; `buildBriefSystemNote` without
  persona → byte-for-byte identical to today's output (escape-hatch fidelity);
  all five `PersonaId` values resolve via `personaForId`.
- Manual: create a chat with a brief → inspect the system note (dev tools or
  debug log) → Dr. Kim's block appears before the strategy block; reload
  persists; an old chat (no persona in JSON) still behaves exactly as today.

### Acceptance

- `pnpm test` / `pnpm check` / `pnpm lint` clean.
- Manual gates above; branching still inherits the persona via root's brief.
- No UI change visible to the user — TP1 is backend/registry only.

**Dependencies:** none (entry point). The `chats.brief` schema is unchanged
(persona rides in the existing JSON column), so **no migration, no
`db:generate`/`bundle:migrations`**.

---

## TP2 — Intake + Settings UI + chat header `Size: S`

**Goal:** the learner can pick a teacher persona at intake, set a default in
Settings, see the persona name in the chat header, and switch mid-chat. Full
end-to-end.

**Scope**

- **Teacher picker in `BriefCard.svelte`**: a `<select>` above the Mode select
  (or between Mode and Structure — whichever keeps the form flow natural). Each
  option renders as `<name> (<summary>)`, e.g. `"Professor Ada (precise, dry
  wit, no-nonsense encouragement)"`. Seeded from the profile default. Reactive
  — no mode dependency (personas are orthogonal to mode/strategy).
- **Default teacher in `LearnerProfileConfig.svelte`**: a "Teacher" select in the
  learner profile section, same options as intake. Changes affect new chats only
  (snapshot semantics).
- **Chat header display**: the persona name displayed next to the MAYON branding
  in the chat header area (`+page.svelte`). Shows "MAYON · <persona.name>"
  alongside the brief summary chip. Derived from the root chat's parsed brief.
- **Mid-chat persona switching**: clicking the persona name in the header opens
  the teacher picker (inline popover or small dropdown). Selecting a new persona
  calls `saveBrief` with the updated brief JSON; the system note rebuilds with
  the new persona block on the next turn. Past turns retain the old voice.
- **Branches inherit the root's persona** (via `rootId` — same as all brief
  fields). A branch never shows the teacher picker.

### New files

- (none — the picker is inline in existing components; no new modules needed.)

### Modified files

- **`src/lib/components/chat/BriefCard.svelte`** — add a **Teacher** `<select>`
  with `PERSONAS` as options, rendering `{p.name} ({p.summary})`. Add a
  `persona` state variable seeded from profile in `onMount` (like `scopeStrategy`).
  Include `persona` in `buildBrief()` (already added in TP1; now visible in UI).
- **`src/lib/components/chat/LearnerProfileConfig.svelte`** — add a **Teacher**
  `<select>` below the Structure select. Same options; `(default)` option maps
  to `undefined` (no explicit persona → Dr. Kim via `DEFAULT_PERSONA`).
  Extend `save()` and `reset()` to include `persona`.
- **`src/routes/chat/[id]/+page.svelte`** — resolve the persona name from the
  root brief's `persona` field (via `personaForId`); display it in the header
  area as "MAYON · <name>" (only when a brief exists; brief-less chats show
  just "MAYON"). Add an inline picker/popover for mid-chat switching that
  persists via the existing `saveBrief` path.
- **`src/lib/chat/profile.ts`** — `getLearnerProfile` / `setLearnerProfile`
  already carry the persona field (validated in TP1); no further change.

### Tests

- Manual: intake → pick "Kit (playful, witty, casual, learns with you)" →
  "Start learning" → first reply reads with Kit's voice (casual, "we/us",
  playful tone); reload persists. Settings → set default to "Professor Ada" →
  new chat pre-selects Ada. Override per-brief and both persist independently
  (snapshot). Chat header shows "MAYON · Kit" (or whichever persona). Switch
  mid-chat → next turn uses new voice, past turns unchanged. Branch inherits
  root persona; branch UI shows no teacher picker.

### Acceptance

- `pnpm test` / `pnpm check` / `pnpm lint` clean.
- Manual gates above.
- Persona picker in BriefCard shows all five options with their summaries.
- BriefCard seeds from profile default on fresh intake.
- LearnerProfileConfig shows and persists default teacher.
- Chat header displays resolved persona name.

**Dependencies:** TP1 (registry + types + system-note injection).

---

## TP3 — Inference integration `Size: XS`

**Goal:** the AI-inferred brief schema gains an optional `persona` field so "Just
start chatting" can propose a teacher persona based on the learner's first
message tone.

**Scope**

- **`generate-brief.ts`**: add `persona` to `GeneratedBriefSchema`
  (`generate-brief.ts:42`, `.strict()`), the prompt's field list
  (`generate-brief.ts:25`), the example (`generate-brief.ts:31`), and the
  correction instruction (`generate-brief.ts:34`). The `GeneratedBrief` type
  picks up the new field from `LearningBrief`.
- The inference prompt suggests a persona based on the learner's tone (informal
  messages → suggest Kit; formal/precise questions → suggest Professor Ada).
  This is a prompt change only — no new logic.

### New files

- (none.)

### Modified files

- **`src/lib/ai/generate/generate-brief.ts`** — extend
  `DEFAULT_BRIEF_PROMPT` with the persona field description and valid IDs;
  add to the example JSON; add to the strict output instruction. Import
  `PERSONA_IDS` from `personas.ts`. `GeneratedBrief` type and
  `GeneratedBriefSchema` gain `persona?: PersonaId`.
- **`src/lib/chat/brief.test.ts`** — extend `parseBrief` tests: persona in
  generated brief round-trips. (Alternatively, `generate-brief.test.ts` if it
  exists.)

### Tests

- `parseGeneratedBrief` (or equivalent) accepts `persona` with a valid enum,
  rejects an unknown persona id, rejects extra keys (`.strict()`).
- Manual: "Just start chatting" → type an informal message → inferred brief
  proposes a persona (Kit or Dr. Kim) → "Use this" applies it.

### Acceptance

- `pnpm test` / `pnpm check` / `pnpm lint` clean.
- Manual: inferred brief includes persona suggestion when the model proposes one.

**Dependencies:** TP1. May fold into existing Phase C brief-inference work.

---

## Cross-cutting concerns

- **Backward compatibility:** the persona rides in the existing `chats.brief`
  JSON column — **no schema migration, no `db:generate`/`bundle:migrations`**
  across all three phases. `parseBrief` is total; old rows resolve to Dr. Kim
  and behave as today (only richer voice).
- **Statelessness:** the persona is resolved from the brief each turn (same as
  strategy/mode/level). No separate pacing state; branching inheritance stays
  intact.
- **Token cost:** each persona block adds ~80–120 tokens. Negligible compared
  to the strategy block (~200–400 tokens). Total system prompt grows by ~100
  tokens for the persona + the opening line change.
- **No streaming post-processing:** persona is *instructed*, never enforced by
  rewriting tokens. The only change is what `buildBriefSystemNote` emits.
- **Orthogonality:** the persona does not affect strategy, mode, capabilities
  preamble, labs, quizzes, or grading logic. It is a voice layer injected into
  the system prompt — all existing flows are unchanged except for the content
  of the system note.
- **Testing posture:** the registry module (`personas.ts`) and note-builder
  changes in `brief.ts` are unit-tested. UI changes (picker, header) are
  validated by manual gates (the existing pattern for chat components).

## Risks / edge cases

- **Persona vs. strategy confusion.** The model might conflate voice directives
  with structural directives (e.g. Kit's casual tone making it skip a pacing
  gate). Mitigation: the strategy block is injected *after* the persona block
  and uses imperative language ("HARD RULES") that should override tone
  suggestions. Test with all 25 persona-strategy combinations.
- **TP1 note-builder change:** the "byte-for-byte today's output" test for
  persona-less briefs is intentionally preserved — when `persona` is not resolved,
  the system note is identical. Keep this assertion.
- **TP2 mid-chat switch UX:** the header picker must call the same `saveBrief`
  path as the BriefCard edit flow. No separate persistence path. Test that the
  persona change persists across reload.
- **Branch inheritance:** a branch shows the root's persona in its header but
  must not expose the picker (same constraint as mode/strategy). The branch
  detection logic already exists — reuse it.
- **TP3 inference quality:** the model may suggest personas inconsistently. The
  field is optional in the schema; a missing `persona` simply falls back to
  Dr. Kim. No hard failure mode.
