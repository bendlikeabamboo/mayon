# Learning Brief — goal-calibrated tutoring across the branchable chat tree

A refinement of `refinement/architecture.md`. Treat `architecture.md` as the
authoritative system design; this doc layers a **Learning Brief** feature on top of
it as a phased delivery (epic). Phase A is **shipped**; Phases B and C are planned.

> Source of the epic: `.kilo/plans/1782467196576-learning-brief-epic.md`. This doc
> re-frames that plan as an architecture refinement and records the **as-built** state
> of Phase A (file names, signatures, and the small deviations from the original plan).

## 1. The problem

Today a new chat is an empty root titled "New chat", and the first message goes
straight to `assembleContext`, which returns **only** raw messages (plus an optional
branch-excerpt note). There is **no system prompt, no goal, no learner context** — the
AI tutors blind, and labs/quizzes are generated generically.

## 2. The Learning Brief

A small structured intake that captures *what the learner wants to be able to do, at
what level, in what context, taught how, over what scope*. The brief lives on the
**root chat**, is injected as the **leading system message** in `assembleContext` (the
single chokepoint for chat + labs + quizzes + grading), and is **inherited by every
branch** via the existing root→target walk — so framing happens once per learning
objective and the whole branchable tree stays coherent.

### Locked decisions

1. **`goal` is the only required field**; `context` / `level` / `mode` / `scope` are
   optional with defaults. A **"Just start chatting"** escape creates a chat with
   `brief = null` (exactly today's behavior; `assembleContext` omits the system note).
2. **Storage:** a single additive, non-breaking migration — **nullable `chats.brief`
   text(JSON) column**, authored on the **root chat only**. Branches inherit via the
   reference-based walk (no re-intake, no extra storage).
3. **Inheritance source:** the brief is read from `target.rootId`, **not** the target's
   own `brief` column — so a branch (whose own `brief` is always `null`) always gets the
   root's brief.
4. **Phase B = snapshot semantics:** the profile is folded into the stored brief at
   intake time. The stored brief is self-contained and survives later profile edits — a
   learning objective keeps the framing it started with.
5. **Phase C trigger:** infer **after the first user message is sent**, surface as an
   inline confirm/edit card; only for chats with no brief yet; **never** overrides a
   manual brief (mirrors the `autoTitleRoot` parallel-request pattern).

### The brief data shape

Owned by `src/lib/chat/brief.ts` (pure, DOM-free, mirroring `expound.ts`):

```ts
export type BriefLevel = 'novice' | 'some' | 'regular' | 'practitioner';
export type BriefMode = 'socratic' | 'explainer' | 'build';

export interface LearningBrief {
  goal: string;          // REQUIRED — a doable verb ("be able to … / decide …"), not a noun
  context?: string;      // role / situation ("engineer with a real bug", "student cramming")
  level?: BriefLevel;    // prior knowledge — the biggest tutor lever (Ausubel / ZPD)
  mode?: BriefMode;      // socratic (questioning) | explainer | build-together
  scope?: string;        // depth / time budget ("orient me in 10 min", "mastery over days")
}
```

- Stored as `JSON.stringify(brief)` in `chats.brief`; parsed back with a **total** parser
  (`parseBrief`: bad/empty/no-`goal` JSON → `null`, never throws). A corrupted value can
  never break `assembleContext`.
- Field labels and option lists live in `brief.ts` as exported consts
  (`LEVEL_OPTIONS`, `MODE_OPTIONS`, `LEVEL_LABELS`, `MODE_LABELS`, `DEFAULT_LEVEL =
  'some'`, `DEFAULT_MODE = 'socratic'`).

### System-note construction + ordering

`buildBriefSystemNote(brief): ChatMessage` renders a `system` message:

```
You are a personal learning tutor. Calibrate to this learner's brief:
- Goal: <goal>
- Level: <level>  · Context: <context or "(not given)">  · Mode: <mode>  · Scope: <scope or "(open)">
Teach to the goal at the stated level; in <mode> mode <mode-specific guidance>; stay within scope.
When the learner can do the goal, say so.
```

The observable contract in `assembleContext` is **`[briefNote?, excerptNote?, …messages]`**
— the brief (overarching framing) first, the branch excerpt (branch-specific seed)
second. When the root has no parseable brief, no brief note is emitted (today's exact
output).

## 3. Where it plugs into the architecture

- **`assembleContext()` (`src/lib/chat/context.ts`)** is the single chokepoint consumed
  by *all four* AI flows: chat send (`chat.svelte.ts`), lab generation (`labs.svelte.ts`),
  quiz generation (`quizzes.svelte.ts`), quiz grading (`quizzes.svelte.ts`). Injecting the
  brief here reaches everything downstream **for free**.
- **`target.rootId`** is set on every chat (self for root) → the root (and its brief) is a
  single fetch away inside `assembleContext`, no full walk needed for the brief.
- **`excerptSystemNoteFor()`** in `context.ts` was the existing pattern for a leading
  `system` note; the brief note reuses it and sits **before** the excerpt note.
- **`settingsRepo`** (`get`/`set`/JSON) is where the Phase B learner profile will live; no
  new KV infra needed.
- **Migrations** are bundled into `src/lib/db/driver/migrations.ts` and applied at boot via
  `runMigrations`. A column change = `pnpm db:generate` (new SQL in `drizzle/`) then
  **`pnpm bundle:migrations`** (re-bundle so the SPA/Tauri apply it offline). Both steps
  are required.

---

## Phase A — Learning Brief → system prompt ✅ SHIPPED

Status: **implemented and landed.** Below is the as-built record (file names and
signatures reflect the actual code, with notes on where it diverged from the original
plan).

### New files (landed)

- **`src/lib/chat/brief.ts`** — types/consts, `parseBrief`, `buildBriefSystemNote`,
  `summarizeBrief`. (Deviation: the summary truncation length and the mode-specific
  teaching guidance are internal consts, not exported options.)
- **`src/lib/chat/brief.test.ts`** — system-note (verbatim goal, defaults, both
  populated/omitted cases), `parseBrief` round-trip + bad-input, `summarizeBrief`
  truncation/ordering.
- **`src/lib/components/chat/BriefCard.svelte`** — intake/edit card.
  - **Deviation from plan:** the API is `mode?: 'intake' | 'edit'` (not a `skipBrief`
    flag). Intake renders goal-required + "Start learning" / "Just start chatting"; edit
    hides skip and shows "Done". The collapsed summary chip is rendered by the **parent**
    route, not by this component.

### Modified files (landed)

- **`src/lib/db/schema.ts`** — `brief: text('brief')` (nullable) on `chats`.
- **`src/lib/db/repositories/chats.ts`** — `createRoot({ title, brief })` stores
  `JSON.stringify(brief)` (default `null`); `updateBrief(id, brief | null)` sets the
  column + `updatedAt`.
- **Migration `drizzle/0001_parched_thundra.sql`** — `ALTER TABLE \`chats\` ADD \`brief\`
  text;` (re-bundled into `src/lib/db/driver/migrations.ts`).
- **`src/lib/chat/context.ts`** — `briefSystemNoteFor(target)` reads the brief from
  `target.rootId` (reuses the already-fetched `target` when the target IS the root, else a
  single `getById`), builds the note, and places it before the excerpt note. `null` brief →
  no note, unchanged behavior.
- **`src/lib/stores/chat.svelte.ts`**:
  - `createAndNavigate(opts?: { title?: string; brief?: LearningBrief })` — **deviation:**
    no `skipBrief` boolean; the skip path simply omits `brief` (stores `null`).
  - `saveBrief(brief)` — `repos.chats.updateBrief` on the current root + reflects it in
    `this.chat`.
- **`src/routes/chat/+page.svelte`** (new-chat flow) — renders `BriefCard mode="intake"`:
  `onSave` → `createAndNavigate({ brief })`; `onSkip` → `createAndNavigate()` (null-brief
  root).
- **`src/routes/chat/[id]/+page.svelte`** — three brief states on an existing chat:
  - **Intake:** root + no messages + `parseBrief(chat.brief) === null` + not dismissed
    this session → `BriefCard mode="intake"`; `onSkip` just sets `intakeDismissed` (the
    root already exists).
  - **Summary chip (collapsed):** brief exists → `summarizeBrief(...)`; click → edit.
  - **Edit:** `BriefCard mode="edit"` with the current brief → `saveBrief`.
  - **Branches:** never render intake (they inherit); show a read-only inherited-summary
    line.
- **`src/lib/ai/generate/generate.ts` + `generate-quiz.ts`** — one line appended to each
  of `DEFAULT_LAB_PROMPT` / `DEFAULT_QUIZ_PROMPT`: align the lab/quiz to the brief's
  goal/level; make checklist criteria / questions test whether the learner can DO the goal.
  No signature change — the brief already arrives via `assembleContext`.

### Phase A — acceptance (met)

- `pnpm test` / `pnpm check` / `pnpm lint` clean (brief unit tests + context/store
  extensions pass, including the `[brief, excerpt, …msgs]` inheritance order and the
  null-brief = byte-for-byte today's output test).
- Manual gates: intake → "Start learning" → calibrated reply → **reload persists**;
  "Just start chatting" → brief-less chat; edit via summary chip recalibrates; branch
  inherits (no re-intake); generated lab/quiz align to the goal.

---

## Phase B — reusable learner profile (settings) `Size: S`

**Goal:** shrink per-session intake to **goal + scope** by pre-applying the
topic-agnostic parts (`context` / `level` / `mode`) from a reusable profile stored in
`settings`, **snapshotted** into the brief at intake time.

### New / modified files

- **`src/lib/chat/brief.ts`** (extend):
  ```ts
  export interface LearnerProfile { context?: string; level?: BriefLevel; mode?: BriefMode; }
  export const DEFAULT_PROFILE: LearnerProfile = { level: 'some', mode: 'socratic' };
  export function applyProfile(profile: LearnerProfile, brief: Partial<LearningBrief>): LearningBrief;
  ```
  `applyProfile` fills `context`/`level`/`mode` from the profile where the brief omits
  them — **explicit brief fields always win**, profile fills gaps, defaults fill the rest.
  The resolved values are what gets snapshotted into `chats.brief`.
- **Profile accessors** — add `getLearnerProfile()` / `setLearnerProfile(p)` over the
  `learnerProfile` settings KV (mirror the `readLabPrompt` / `repos.settings.get`/`set`
  pattern in `generate.ts`). Seed `DEFAULT_PROFILE` in `settingsRepo.seedDefaults`
  (`src/lib/db/repositories/settings.ts`).
- **`src/lib/components/chat/BriefCard.svelte`** — on mount (intake mode), load the profile
  and pre-fill `level`/`mode`/`context`; the user can still override per-brief. The stored
  brief snapshots the resolved values.
- **`src/routes/settings/+page.svelte` (and its store)** — a "Learner profile" section
  (Context textarea, Level select, Mode select) → `setLearnerProfile`. Mirrors the existing
  provider-config section styling.

### Tests

- `brief.test.ts`: `applyProfile` precedence (brief > profile > defaults; profile fills
  gaps).
- A settings/profile round-trip test alongside the existing repository tests.

### Acceptance

- `pnpm test` / `check` / `lint`.
- Manual: set a profile in Settings → "New chat" → intake pre-fills level/mode/context →
  override one field → both the per-chat override and the profile persist independently;
  **reload survives**. A later profile edit does **not** retroactively change an existing
  briefed chat (snapshot semantics).

---

## Phase C — AI-inferred brief (after first message) `Size: M`

**Goal:** for a brief-less root, after the learner sends their first message, propose a
brief from the conversation — surfaced as an inline one-tap confirm/edit card. Never fires
for chats that already have a brief, or for branches; never overrides a manual brief.

### New files

- **`src/lib/ai/generate/generate-brief.ts`** (orchestrator, mirrors `generate.ts` +
  `lab.ts`):
  - `GeneratedBrief = Pick<LearningBrief, 'goal' | 'context' | 'level' | 'mode' | 'scope'>`
    with `goal` required; **strict Zod schema** (`.strict()`, unknown keys rejected,
    `level`/`mode` enums validated) — exactly the pattern in `lab.ts` /
    `quiz.ts`. Reuse the shared `extractFencedJson` (`fence.ts`) for the nested-fence-safe
    extraction.
  - `parseGeneratedBrief(raw): GeneratedBrief` (throws `BriefParseError` carrying raw) +
    `generateBrief(provider, messages, opts)` with the **same retry loop (max 3) +
    `accumulate` correction pattern** as `generateLab`.
  - Settings-overridable prompt via a `briefPrompt` KV key + `readBriefPrompt()` (mirrors
    `readLabPrompt`).
- **`src/lib/ai/generate/generate-brief.test.ts`** — `parseGeneratedBrief`: valid
  round-trip; unknown key rejected; bad enum rejected; bad JSON → `BriefParseError`. Retry
  covered by a mock-provider test mirroring the lab/quiz suites.

### Modified files

- **`src/lib/stores/chat.svelte.ts`**:
  - New state: `inferredBrief = $state<LearningBrief | null>(null)` + a private
    `inferController: AbortController | null`.
  - After the first user message is appended, **reuse the `isFirstRootTurn` guard** (already
    present at `chat.svelte.ts:140`, scoped to **root chats with
    `parseBrief(chat.brief) === null`**), fire `generateBrief(provider, ctx)` **in parallel,
    not awaited** (mirrors `autoTitleRoot`). On success set `inferredBrief`; **swallow all
    errors**; abort the controller on `load` / `deleteChat`.
  - `confirmInferredBrief(b?)`: `saveBrief(b ?? inferredBrief)` then clear.
  - `dismissInferredBrief()`: clear without saving; sticky for the session (no re-fire).
  - **Never** fire for briefed roots or branches.
- **`src/routes/chat/[id]/+page.svelte`** — when `chatStore.inferredBrief` is set (root, no
  brief) → render an inline confirm/edit card (reuse `BriefCard`): "Heard: *<goal>* (level
  *X*, *Y* mode) — right?" with **Use this** (`confirmInferredBrief`), **Edit** (open
  editor), and **Dismiss** (`dismissInferredBrief`).

### Tests

- `chat.svelte.test.ts`: first message on a null-brief root sets `inferredBrief`; a briefed
  root or a branch does **not** fire; `confirmInferredBrief` persists + clears;
  `dismissInferredBrief` clears without persisting.

### Acceptance

- `pnpm test` / `check` / `lint`.
- Manual: "Just start chatting" → send a first message → inferred brief card appears →
  "Use this" recalibrates subsequent turns; "Dismiss" leaves the chat brief-less (no
  re-fire); editing before confirming works. A manually-briefed chat never triggers
  inference.

---

## Risks / edge cases

- **Migration safety:** `brief` is nullable and additive; old rows get `null` and behave
  exactly as today. `parseBrief` is total, so a corrupted value can't break
  `assembleContext`. (Phase A shipped this safely.)
- **Escape-hatch fidelity:** a null-brief root's `assembleContext` is byte-for-byte today's
  output (no note) — pinned by the context test.
- **Branch inheritance correctness:** the brief is read from `target.rootId`, never the
  target's own `brief`, so a branch always gets the root's brief even though its own column
  is `null`. The context test pins the `[brief, excerpt, …msgs]` order.
- **Prompt-token cost:** the brief note is tiny (~5 lines) and added once per assembled
  context — negligible. Phase C adds one extra short AI call after the first message
  (best-effort, swallowable, abortable).
- **Snapshot vs reference (Phase B):** the stored brief is a snapshot; later profile edits
  must not silently change existing chats. Documented + tested.
- **Phase C non-overlap:** inference only for `parentId === null` AND null brief; never
  overrides manual; dismissed state is sticky for the session.
- **Generator prompt tuning:** appending one line to the defaults is low-risk; existing
  `labPrompt` / `quizPrompt` KV overrides replace the whole prompt by design, so they are
  unaffected.
- **Provider structured-output:** inferred-brief generation is prompt-driven (fenced JSON +
  Zod), consistent with lab/quiz — no per-adapter wire JSON-mode dependency.

## Out of scope (future seams, architecture.md §10)

- Spaced-repetition / mastery tracking against the brief's goal.
- Per-branch brief overrides (a branch changing its own framing) — branches inherit the
  root brief by design.
