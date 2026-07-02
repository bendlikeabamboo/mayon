# TP2 — Teacher persona UI (Intake + Settings + chat header)

Implementation plan for **TP2** of the teacher-persona epic
(`refinement/teacher-personas-phased.md`, lines 162–229). **TP1 is already
complete** — this phase is UI-only.

## Context / starting state (verified)

- `src/lib/chat/personas.ts` exists with `PersonaId`, `PersonaDefinition`,
  `PERSONAS`, `PERSONA_IDS`, `DEFAULT_PERSONA` (`'dr-kim'`), `personaForId`,
  `isPersonaId`.
- `src/lib/chat/brief.ts` already: defines `LearningBrief.persona`,
  `LearnerProfile.persona`, `DEFAULT_PROFILE.persona`, `ResolvedBriefFields.persona`;
  resolves precedence in `applyProfile` (brief > profile > `DEFAULT_PERSONA`);
  round-trips in `parseBrief`; injects the persona block in
  `buildBriefSystemNote`; **re-exports** `PERSONAS`, `PERSONA_IDS`,
  `DEFAULT_PERSONA`, `personaForId`, `isPersonaId`, `PersonaId`.
- `src/lib/chat/profile.ts` already validates/persists `persona`.
- `src/lib/components/chat/BriefCard.svelte` already has a `persona` state
  seeded from `brief?.persona ?? DEFAULT_PERSONA` (onMount from `applyProfile`,
  line 84) and includes `persona` in `buildBrief()` (line 102). **No picker UI
  yet.**
- The chat page brief-summary chip (`routes/chat/[id]/+page.svelte:379-396`)
  already opens the `BriefCard` editor (root-only) via `editingBrief`; branches
  show "(inherited)" and are non-clickable — the branch rule is already solved.
- The codebase uses **native `<select>`** for all form controls (no shadcn
  Select/Popover). `bits-ui ^2.18.1` is present but only `button` + `sheet`
  shadcn components exist.

## Resolved decisions

1. **Mid-chat switching** = reuse the existing `BriefCard` editor. Clicking the
   persona chip sets `editingBrief = true` (identical path to the brief chip).
   No new UI component; branches stay non-clickable for free.
2. **Chat header** = persona-name chip only (no `MAYON` wordmark — the sidebar
   `AppShell.svelte:76` already brands it). Co-located with the brief chip;
   shown only when a brief exists.

## Tasks

### 1. `src/lib/components/chat/BriefCard.svelte` — add Teacher `<select>`
- Add `PERSONAS` to the existing `$lib/chat/brief` import (already imports
  `PersonaId`, `DEFAULT_PERSONA`).
- Insert a full-width **Teacher** `<select>` **between the Level+Mode grid and
  the Structure row** (design: "between Mode and Structure"). Use the existing
  `inputClass` / `labelClass`. Label: `Teacher`.
- Options: `{#each PERSONAS as p (p.id)}` → `<option value={p.id}>{p.name} ({p.summary})</option>`.
- Bind to the existing `persona` state (already seeded from profile/brief).
  `buildBrief()` already emits `persona` — **no change there**.
- No mode dependency — personas are orthogonal to mode/strategy (do **not**
  reset persona in the mode-strategy `$effect`).

### 2. `src/lib/components/chat/LearnerProfileConfig.svelte` — add default Teacher
- Add `PERSONAS`, `DEFAULT_PERSONA`, `PersonaId` to the `$lib/chat/brief` import.
- Add state `let persona = $state<PersonaId | undefined>(undefined);` seeded in
  `onMount` from `profile.persona` (`persona = profile.persona;`).
- Add a **Teacher** `<select>` **below the Structure select**. First option:
  `<option value={undefined as unknown as string}>(default · Dr. Kim)</option>`
  → maps to `undefined` (no explicit persona → `DEFAULT_PERSONA`). Then the five
  `PERSONAS` rendered `{p.name} ({p.summary})`. Bind to `persona`.
- Extend `save()`: `if (persona !== undefined) clean.persona = persona;` (before
  `setLearnerProfile`). Extend `reset()`: `persona = undefined;` (the
  `setLearnerProfile({ ...DEFAULT_PROFILE })` call already persists
  `DEFAULT_PROFILE.persona`).
- Extend both `isDefault` computations to include
  `persona === undefined` (matches the `scopeStrategy === undefined` pattern).
- Update the section description copy to mention teacher persona (optional,
  one phrase).

### 3. `src/routes/chat/[id]/+page.svelte` — persona chip in the chat header
- Add to the `$lib/chat/brief` import: `personaForId`, `DEFAULT_PERSONA`.
- Add a lucide icon import, e.g. `GraduationCap` (from `@lucide/svelte`).
- In the **collapsed-brief-chip branch** (`{:else if rootBrief}`, ~line 379),
  wrap the existing brief chip and a new **persona chip** in a single flex row
  (`class="flex flex-wrap items-center gap-2 self-start"`).
- Resolve persona name:
  `personaForId(rootBrief.persona ?? DEFAULT_PERSONA).name`.
- Persona chip markup mirrors the brief chip styling (rounded-full border, small
  muted text, `GraduationCap` icon + persona name). Root (`!chatStore.chat?.parentId`):
  `cursor-pointer`, `onclick={() => (editingBrief = true)}`,
  `title="Switch teacher persona"`. Branch: `cursor-default`,
  `title="Inherited from the root chat"`.
- Show the persona chip **only in this one branch** (not in intake / edit /
  inferred / no-brief states). No `MAYON` wordmark.

## Out of scope
- `brief.ts` logic, `profile.ts`, `personas.ts` — unchanged (TP1 delivered them).
- `generate-brief` inference schema — that is **TP3** (optional, may fold into
  Phase C).
- New automated tests — TP2 is UI-only; the phased doc's TP2 tests are manual
  gates (component behavior follows the existing "no unit tests for chat UI"
  pattern).

## Validation
- `pnpm check`, `pnpm lint`, `pnpm test` all clean (no logic change; existing
  TP1 brief tests must still pass).
- **Manual gates:**
  - Intake → pick a persona → first reply matches its voice → reload persists.
  - Settings → set default teacher → new chat pre-selects it; per-brief override
    persists independently (snapshot semantics — profile and brief store
    independently).
  - Chat header shows the resolved persona name next to the brief chip.
  - Mid-chat switch: click persona chip → BriefCard opens → change Teacher →
    Done → next turn uses the new voice; past turns unchanged.
  - Branch: header shows the root's inherited persona; persona chip is
    non-clickable (no picker).
- **Backward compat:** old briefs without `persona` resolve to Dr. Kim in the
  header (`rootBrief.persona ?? DEFAULT_PERSONA`); no migration, no
  `db:generate`/`bundle:migrations` (persona rides the existing JSON column).

## Risks / notes
- Keep the persona chip's click path identical to the brief chip's
  (`editingBrief = true` → `onSaveBrief` → `chatStore.saveBrief`). No separate
  persistence path.
- Do not couple the Teacher select to mode/strategy reactivity in `BriefCard`.
- `GraduationCap` is a standard lucide icon; if unavailable, fall back to
  `User` or `Bot`.
