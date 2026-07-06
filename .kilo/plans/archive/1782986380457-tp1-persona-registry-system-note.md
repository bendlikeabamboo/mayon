# TP1 — Persona registry + system-note injection

Implementation plan for **TP1** of the teacher-personas epic
(`refinement/teacher-personas-phased.md`). Authoritative design:
`refinement/teacher-personas.md` (esp. §4 persona blocks, §7 system-note layout).

**Size:** S · **Depends on:** nothing (entry point) · **UI:** none (backend/registry only).

---

## Goal

The five curated personas exist as typed data; `buildBriefSystemNote` injects the
resolved persona block; the brief and profile carry a `persona` field with correct
precedence. After TP1, every **new** chat with a resolved brief gets Dr. Kim's voice in
the system prompt — no picker UI yet, just the correct default.

---

## Resolved decisions (verified against code)

1. **Add a `tagline` field to `PersonaDefinition`.** The spec's opening-line template
   `You are <name>. <first sentence of block>` is unworkable: each block already begins
   `You are <name> — …` (redundancy) and "Dr. Kim" contains a period (breaks naive
   sentence-splitting). `tagline` is the role-anchor fragment (the text after
   `You are <name> — ` in the block's first sentence). Opening line becomes
   `You are ${persona.name} — ${persona.tagline}.` — no string parsing.
   This deviates from the design doc's 4-field `PersonaDefinition` by adding a 5th.

2. **Escape hatch via presence-check, not default-resolution.** `buildBriefSystemNote`
   branches on whether `brief.persona` is set (`brief.persona ? personaForId(...) : null`).
   Legacy briefs with no `persona` field → byte-for-byte today's output (old
   `"You are a personal learning tutor."` line, no persona block). Persona-bearing
   briefs → persona opening line + persona block. This is the *only* way to satisfy the
   spec's "byte-for-byte today's output" fidelity requirement. (`applyProfile` still
   resolves precedence for BriefCard seeding; `buildBriefSystemNote` consumes whatever
   `persona` the stored brief carries.)

3. **Legacy-edit preservation.** BriefCard's `buildBrief()` includes `persona` only when
   truthy (`if (persona) b.persona = persona;`). Edit mode seeds `persona` from
   `brief?.persona` (undefined for legacy → stays undefined → old output preserved);
   intake mode seeds from `applyProfile` (→ DEFAULT_PERSONA = Dr. Kim). So editing an old
   brief does not silently flip its voice; new intakes snapshot Dr. Kim.

4. **No schema migration.** `persona` rides the existing `chats.brief` JSON column.
   `parseBrief` already ignores unknown keys; adding `persona` needs one `isPersonaId`
   guard line. Old rows resolve to persona-less (today's output). No `db:generate`,
   no `bundle:migrations`.

5. **Recommended scope add (1 line):** preserve `persona` in the agent's brief-merge tool
   (`deterministic-tools.ts:72`) as `existing?.persona`, so agent-initiated brief edits
   don't silently strip the persona and revert the chat to legacy output. Low-risk,
   prevents a subtle regression. (Not in the TP1 spec file list — see Open question.)

---

## Ordered tasks

### 1. Create `src/lib/chat/personas.ts` (new file, mirrors `strategies.ts`)

The registry + block text. Splitting long block strings out of `brief.ts` keeps that
module's parser/note-builder focused.

```ts
export type PersonaId =
  | 'professor-ada'
  | 'coach-rex'
  | 'dr-kim'
  | 'kit'
  | 'sage';

export interface PersonaDefinition {
  id: PersonaId;
  name: string;      // "Professor Ada"
  summary: string;   // parenthetical for the (TP2) picker: "precise, dry wit, no-nonsense encouragement"
  tagline: string;   // role anchor for the opening line (NEW field)
  block: string;     // full prompt payload (design §4, verbatim)
}

export const PERSONAS: PersonaDefinition[];        // exactly 5
export const PERSONA_IDS: readonly PersonaId[];    // derived from PERSONAS
export const DEFAULT_PERSONA: PersonaId = 'dr-kim';
export function personaForId(id: PersonaId): PersonaDefinition;  // total over the union
export function isPersonaId(v: unknown): v is PersonaId;         // mirrors isScopeStrategyId
```

**Data — verbatim §4 blocks** for `block`. Derive `summary` and `tagline` per persona:

| id | name | summary | tagline (= text after `You are <name> — `) |
|----|------|---------|--------------------------------------------|
| `professor-ada` | Professor Ada | precise, dry wit, no-nonsense encouragement | a precise, intellectually rigorous tutor with dry wit |
| `coach-rex` | Coach Rex | high energy, direct, tough when needed | a high-energy, enthusiastic tutor who treats learning like a sport to train for |
| `dr-kim` | Dr. Kim | warm, calm, patient, nurturing | a warm, patient, and nurturing tutor who creates a safe space for learning |
| `kit` | Kit | playful, witty, casual, learns with you | a witty, playful tutor who feels like a smart friend learning alongside the learner |
| `sage` | Sage | calm, sparse, profound, intense | a quiet, intense tutor who communicates with precision and economy |

> The `block` text is copied verbatim from `refinement/teacher-personas.md` §4 (each
> "Persona block (prompt)" fenced block). Do not paraphrase.

### 2. Modify `src/lib/chat/brief.ts`

- **Re-export** from `./personas`: `PersonaId`, `PersonaDefinition`, `PERSONAS`,
  `PERSONA_IDS`, `DEFAULT_PERSONA`, `personaForId`, `isPersonaId`. Add to the existing
  `export { ... } from './strategies'` block, mirroring that pattern.
- **`LearningBrief`** (`brief.ts:43`): add `persona?: PersonaId;`.
- **`LearnerProfile`** (`brief.ts:81`): add `persona?: PersonaId;`.
- **`DEFAULT_PROFILE`** (`brief.ts:88`): add `persona: DEFAULT_PERSONA` (affects the
  `!raw` fallback in `getLearnerProfile` and documents intent; the main storage path
  validates via `isPersonaId`).
- **`ResolvedBriefFields`** (`brief.ts:95`): add `persona: PersonaId;` (non-optional).
- **`applyProfile`** (`brief.ts:110`): resolve
  `const persona = brief.persona ?? profile.persona ?? DEFAULT_PERSONA;` and include
  `persona` in the returned object.
- **`parseBrief`** (`brief.ts:168`, next to the `isScopeStrategyId` line): add
  `if (isPersonaId(obj.persona)) brief.persona = obj.persona;`.
- **`buildBriefSystemNote`** (`brief.ts:181`) — rewrite:

  ```ts
  const persona = brief.persona ? personaForId(brief.persona) : null;
  ```

  - **Opening line:** if `persona` → `You are ${persona.name} — ${persona.tagline}.`
    else → `"You are a personal learning tutor."` (today's exact text, minus the
    "Calibrate…" suffix which moves to the next line).
  - The calibration lines, budget line, strategy line, strategy block, and closing
    lines are **unchanged** from today — including the `Structure: <label>  (unless
    scope overrides the budget)` suffix. (The TP1 template omits this suffix; keep it
    so only the opening line + persona block differ, minimizing diff/risk.)
  - **Persona block insertion:** when `persona`, push `''` + `persona.block` between the
    budget line and the `''` + `strat.block`. Block order in the note:

    ```
    <opening line>
    Calibrate to this learner's brief:
    - Goal: …
    - Level: …  · Context: …  · Mode: …  · Scope: …
    - Structure: <label>  (unless scope overrides the budget)
    [optional scope budget instruction]
    <persona.block>        ← NEW, only when persona resolved
    <strategy.block>
    Teach to the goal at the stated level; stay within scope.
    When the learner can do the goal, say so.
    ```

  Persona-less path must produce the **exact** string `buildBriefSystemNote({goal:'g'})`
  emits today (capture a golden snapshot before editing; assert equality — see tests).

### 3. Modify `src/lib/chat/profile.ts`

In `getLearnerProfile` (`profile.ts:16`, next to the `isScopeStrategyId` line):
`if (isPersonaId(raw.persona)) profile.persona = raw.persona;`. `setLearnerProfile`
unchanged (already persists the `LearnerProfile` object, which now carries `persona`).

### 4. Modify `src/lib/components/chat/BriefCard.svelte`

- Import `DEFAULT_PERSONA` (and `type PersonaId`) from `$lib/chat/brief`.
- Add `let persona = $state<PersonaId>(untrack(() => brief?.persona ?? DEFAULT_PERSONA));`
- In the intake `onMount` block (`BriefCard.svelte:70`), add `persona = seed.persona;`
  after the existing `applyProfile` seeding.
- In `buildBrief()` (`BriefCard.svelte:92`), add `if (persona) b.persona = persona;`
  (conditionally, mirroring context/scope). **No picker UI control in TP1.**

### 5. (Recommended) Modify `src/lib/agent/deterministic-tools.ts`

In the brief-merge tool's `merged` object (`deterministic-tools.ts:72`), add
`persona: existing?.persona,` so agent-initiated brief edits preserve the persona
instead of stripping it (which would silently revert the chat to legacy output).

### 6. Tests — `src/lib/chat/brief.test.ts`

Add a `describe('personas')` block + extend existing blocks:

- **Registry:** `PERSONAS` has exactly 5 entries with unique ids; `PERSONA_IDS` matches;
  `DEFAULT_PERSONA === 'dr-kim'`; `personaForId` resolves every id and returns its
  verbatim `block`; `isPersonaId` accepts all 5 ids, rejects garbage/numbers/undefined.
- **`parseBrief`:** round-trips `persona` (valid id kept); drops an invalid persona id
  but keeps the goal; persona absent → omitted from result.
- **`applyProfile`:** `brief.persona` wins over `profile.persona`; `profile.persona`
  fills when brief omits; neither set → `DEFAULT_PERSONA` ('dr-kim').
- **`buildBriefSystemNote`:**
  - persona present (e.g. 'dr-kim') → opening line is
    `You are Dr. Kim — a warm, patient, and nurturing tutor who creates a safe space for learning.`
  - **block order:** persona block appears BEFORE strategy block (assert
    `content.indexOf(persona.block) < content.indexOf(strat.block)` and `< 0` for the
    reverse). Test all 5 personas render their name + tagline.
  - **escape hatch:** persona-less `{ goal: 'g' }` → byte-for-byte identical to today's
    output. Capture the golden string from the current implementation BEFORE editing
    `buildBriefSystemNote`, store as a `const`, assert `.content === GOLDEN_NO_PERSONA`.
    Also assert no persona name/tagline appears in the persona-less note.

---

## Validation

- `pnpm test` / `pnpm check` / `pnpm lint` all clean.
- **Manual (dev):** create a chat with a brief → inspect the assembled system note
  (dev tooling / debug log) → Dr. Kim's block appears before the strategy block;
  reload persists. Open an old chat (no `persona` in its brief JSON) → system note is
  unchanged (old opening line, no persona block). Branching still inherits the persona
  via the root brief (`context.ts:132` reads `root.brief`).
- **No UI change** visible to the user in TP1.

---

## Out of scope (later phases)

- Teacher picker UI, Settings default, chat-header display, mid-chat switching → **TP2**.
- Inference (`generate-brief` schema + `persona` suggestion) → **TP3**.
- Custom/freeform persona (`customPersona` KV seam) → future.

## Open question (non-blocking)

Task 5 (`deterministic-tools.ts` persona-preserve) is not in the TP1 spec's file list.
It is recommended to prevent a silent regression when the agent edits a brief. If strict
spec fidelity is preferred, drop task 5 and instead file it as a TP2/agent follow-up —
accept that an agent-initiated brief edit strips `persona` until then.

## Risks / edge cases

- **Persona vs strategy conflation** — mitigated by injecting persona *before* strategy
  and by the strategy blocks' imperative "HARD RULES" language; tests assert block order.
- **Escape-hatch drift** — the golden-string test guards the persona-less path against
  accidental changes to opening line / Structure suffix / block order.
- **Token cost** — each persona block ~80–120 tokens; negligible vs strategy (~200–400).
- **Legacy briefs** — no `persona` field → today's exact output (verified: no
  snapshot/exact-match tests elsewhere; existing `brief.test.ts`/`context.test.ts` use
  `toContain`/`stringContaining`, so they stay green).
