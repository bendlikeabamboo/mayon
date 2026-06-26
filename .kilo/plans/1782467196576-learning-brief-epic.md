# Learning Brief — goal-calibrated tutoring across the branchable chat tree (epic)

## Goal

Today a new chat is created as an empty root titled "New chat" and the first message
goes straight to `assembleContext`, which returns **only** raw messages (plus an optional
branch-excerpt note). There is **no system prompt, no goal, no learner context** — the AI
tutors blind, and labs/quizzes are generated generically.

This epic adds a **Learning Brief**: a small structured intake that captures *what the
learner wants to be able to do, at what level, in what context, taught how, over what
scope*. The brief lives on the **root chat**, is injected as the **leading system message**
in `assembleContext` (the single chokepoint for chat + labs + quizzes + grading), and is
**inherited by every branch** via the existing root→target walk — so framing happens once
per learning objective and the whole branchable tree stays coherent.

Delivered as **three shippable phases**:

- **Phase A (core):** brief on the root → system prompt → reaches chat/labs/quizzes. Goal
  is the only required field; a "Just start chatting →" escape creates a brief-less chat
  (exactly today's behavior).
- **Phase B:** reusable **learner profile** in `settings` (the topic-agnostic parts:
  context/level/mode), pre-applied to each new brief so per-session intake shrinks to
  goal + scope.
- **Phase C:** **AI-inferred brief** — after the first user message, the model proposes a
  brief, shown as an inline one-tap confirm/edit card (only for no-brief chats; never
  overrides a manual one).

## Confirmed decisions

1. **Scope:** A + B + C, spaced into phases (epic, not a single story).
2. **Mandatory:** **goal only** is required; `context`/`level`/`mode`/`scope` optional with
   defaults. A **"Just start chatting →"** escape creates a chat with `brief = null`
   (today's exact behavior; `assembleContext` omits the system note).
3. **Storage:** a single additive, non-breaking migration — **nullable `chats.brief`
   text(JSON) column**, authored on the **root chat only**; branches inherit via the
   reference-based walk (no re-intake, no extra storage).
4. **Phase C trigger:** infer **after the first user message is sent**, surface as an inline
   confirm/edit card; only for chats with no brief yet; never overrides a manual brief
   (mirrors the `autoTitleRoot` parallel-request pattern).

## Context (what already exists — reuse, don't rebuild)

- **`assembleContext()` (`src/lib/chat/context.ts`)** is the single chokepoint consumed by
  *all four* AI flows: chat send (`chat.svelte.ts:136`), lab generation
  (`labs.svelte.ts:88`), quiz generation (`quizzes.svelte.ts:154`), quiz grading
  (`quizzes.svelte.ts:327`). Injecting the brief here reaches everything downstream **for
  free** — labs/quizzes need no wiring change to *receive* the brief.
- **`target.rootId`** is set on every chat (self for root) — so the root (and thus its
  brief) is a single fetch away inside `assembleContext`, no full walk needed for the brief.
- **`excerptSystemNoteFor()`** in `context.ts` already shows the exact pattern: build a
  leading `system` `ChatMessage` and `unshift` it. The brief note reuses this pattern and
  sits **before** the excerpt note.
- **`expound.ts`** is the precedent for a pure, unit-tested prompt/builder module living in
  `src/lib/chat/`; `brief.ts` mirrors it.
- **Generator default prompts** (`DEFAULT_LAB_PROMPT` in `generate.ts`,
  `DEFAULT_QUIZ_PROMPT` in `generate-quiz.ts`) are already settings-overridable via the
  `labPrompt` / `quizPrompt` KV keys; tuning them to "align to the learner's goal and level
  (see the conversation's brief)" is a small, low-risk edit.
- **`settingsRepo`** (`get`/`set`/JSON) is the existing place a learner profile lives; no
  new KV infra needed.
- **`autoTitleRoot()`** (`chat.svelte.ts:224`) is the precedent for a best-effort parallel
  AI call after the first message that never breaks the chat; Phase C inference mirrors it.
- **Migrations** are bundled (`src/lib/db/driver/migrations.ts`) and applied at boot via
  `runMigrations`. Adding the column = `pnpm db:generate` (new SQL in `drizzle/`) then
  **`pnpm bundle:migrations`** (re-bundle). The implementing agent must run both.

## The brief data shape (owned by `src/lib/chat/brief.ts`)

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

- Stored as `JSON.stringify(brief)` in `chats.brief`; parsed back with a safe parser (bad
  JSON → `null`, never throws).
- **Phase B snapshots the profile into the brief at intake time** (the stored brief is
  self-contained and survives later profile edits — a learning objective keeps the framing
  it started with).
- Field labels (for the intake UI), defaults (`level ?? 'some'`, `mode ?? 'socratic'`), and
  the level/mode option lists all live in `brief.ts` as exported consts.

## System-note construction + ordering

`buildBriefSystemNote(brief: LearningBrief): ChatMessage` renders a `system` message, e.g.:

```
You are a personal learning tutor. Calibrate to this learner's brief:
- Goal: <goal>
- Level: <level>  · Context: <context or "(not given)">  · Mode: <mode>  · Scope: <scope or "(open)">
Teach to the goal at the stated level; in <mode> mode use questioning/active recall; stay within scope.
When the learner can do the goal, say so.
```

`assembleContext` ordering becomes **`[briefNote?, excerptNote?, …messages]`** — the brief
(overarching framing) first, the branch excerpt (branch-specific seed) second.

---

# Phase A — Learning Brief → system prompt (core)

## New files

### `src/lib/chat/brief.ts` (pure, unit-testable)
- Types/consts above: `LearningBrief`, `BriefLevel`, `BriefMode`, `LEVEL_OPTIONS`,
  `MODE_OPTIONS`, `LEVEL_LABELS`, `MODE_LABELS`, defaults.
- `parseBrief(raw: string | null): LearningBrief | null` — safe JSON parse; bad/empty → `null`.
- `buildBriefSystemNote(brief: LearningBrief): ChatMessage` — the system message above.
- `summarizeBrief(brief: LearningBrief): string` — one-line chip text (e.g.
  `"Goal: X · level: some · socratic"`), truncated, for the collapsed card.

### `src/lib/chat/brief.test.ts`
- `buildBriefSystemNote`: includes goal verbatim; reflects each field; substitutes defaults
  for omitted optional fields; both omitted-optionals and fully-populated cases.
- `parseBrief`: valid JSON round-trips; `null`/empty/bad-JSON → `null` (never throws).
- `summarizeBrief`: truncation + ordering stable.

### `src/lib/components/chat/BriefCard.svelte` (intake / edit card)
- Props: `brief: LearningBrief | null`, `onSave: (b: LearningBrief) => void | Promise<void>`,
  `onSkip: () => void`, `onDismiss?: () => void`.
- Local state seeded from `brief ?? defaults`; `goal` bound to a required `<textarea>`
  (Submit disabled until non-empty trimmed).
- Level + Mode as shadcn `Select` (or toggle chips); Context + Scope as optional inputs.
- Two actions: **"Start learning"** (disabled until goal present) → `onSave`; **"Just start
  chatting →"** → `onSkip`. Same component in edit mode (no skip; add `onDismiss`/Done).
- Styling matches existing `border-border bg-card` cards; no new dependency.

## Modified files

### `src/lib/db/schema.ts`
- Add nullable column: `brief: text('brief')` on the `chats` table (JSON string or null).
- Add `Chat` inferred type already covers it (no new export needed).

### `src/lib/db/repositories/chats.ts`
- `createRoot(opts)`: accept optional `brief?: LearningBrief`; store `JSON.stringify(brief)`
  when provided (default `null`).
- Add `async updateBrief(id: string, brief: LearningBrief | null): Promise<void>` — sets the
  column (+ `updatedAt`). Null clears it.

### Migration (run by implementing agent)
- `pnpm db:generate` → new `drizzle/0xxx_*.sql` with `ALTER TABLE \`chats\` ADD COLUMN
  \`brief\` text;`.
- `pnpm bundle:migrations` → re-bundles `src/lib/db/driver/migrations.ts` (so the SPA/Tauri
  apply it offline). **Both steps are required.**

### `src/lib/chat/context.ts`
- After resolving `target`, fetch the root: `const root = await repos.chats.getById(target.rootId);`
  (single fetch; `rootId` is always set).
- If `parseBrief(root.brief)` is non-null, build the brief note and `out.unshift()` it so it
  lands **before** the excerpt note. Keep all existing behavior when brief is `null`.

### `src/lib/chat/context.test.ts` (extend)
- Root with a brief → `assembleContext(root)` leads with the brief system note.
- Root with `brief = null` → no brief note (unchanged behavior).
- **Inheritance:** child of a briefed root → `assembleContext(child)` leads with the brief
  note, *then* the excerpt note, *then* messages (order `[brief, excerpt, …msgs]`).
- Old/pre-migration chat (`brief` absent) → treated as `null` (no throw).

### `src/lib/stores/chat.svelte.ts`
- `createAndNavigate(opts?: { brief?: LearningBrief; skipBrief?: boolean })`:
  - if `brief` provided → `repos.chats.createRoot({ title, brief })`;
  - if `skipBrief` → `createRoot({ title })` with `brief: null` (today's path);
  - default (no opts) → unchanged (so `/chat` "New chat" still works pre-change until wired).
- Add `async saveBrief(brief: LearningBrief): Promise<void>` — `repos.chats.updateBrief`
  on the current root; update `this.chat`; no streaming impact.
- Keep all existing send/branch logic unchanged.

### `src/lib/stores/chat.svelte.test.ts` (extend)
- `createAndNavigate({ brief })` persists a root whose `assembleContext` leads with the
  brief note.
- `createAndNavigate({ skipBrief: true })` creates a null-brief root (no system note).
- `saveBrief` updates the row and the store's `chat`.

### `src/routes/chat/+page.svelte`
- "New chat" → open a **brief-first flow**: instead of immediately creating + navigating,
  show the `BriefCard` (or route to a create state). Simplest: create the root lazily —
  render `BriefCard` in an empty/create mode; on `onSave` call `createAndNavigate({ brief })`;
  on `onSkip` call `createAndNavigate({ skipBrief: true })`. (Keeps a single source of
  truth: the row is created once a path is chosen.)

### `src/routes/chat/[id]/+page.svelte`
- Render `BriefCard`:
  - **Intake mode:** when `chat.parentId === null` (root) AND `messages` is empty AND
    `parseBrief(chat.brief) === null` → show intake (goal required + skip).
  - **Summary chip (collapsed):** when a brief exists → show `summarizeBrief(...)` chip;
    click → edit mode (`BriefCard` with current brief, no skip, Done to save).
  - **Branches:** never render the card (they inherit; show a read-only inherited-summary
    line optionally).
- Wire `onSave` → `chatStore.saveBrief` (for edits) or the create flow; `onSkip` → create
  null-brief root.

### `src/lib/ai/generate/generate.ts` + `generate-quiz.ts` (light prompt tuning)
- Append one line each to `DEFAULT_LAB_PROMPT` / `DEFAULT_QUIZ_PROMPT` (before "Critical
  rules"): *"The conversation opens with a learner brief (goal/level/mode/scope). Align the
  lab/quiz to that goal and level; make completion criteria / questions test whether the
  learner can DO the goal."* No signature change — the brief already arrives via
  `assembleContext`. Update the mirrored "reset to default" preview in Settings if present.

## Phase A — validation / acceptance
- `pnpm test` (new brief unit tests + context/store extensions pass).
- `pnpm check` (svelte-check clean) · `pnpm lint`.
- Manual (`pnpm dev`, http://localhost:5173):
  1. "New chat" → BriefCard intake; type a goal → "Start learning" → chat opens, first reply
     is calibrated (level/mode reflected); **reload** → brief persists.
  2. "Just start chatting →" → brief-less chat (today's behavior; no system note).
  3. Edit the brief via the summary chip → next reply recalibrates.
  4. Branch from an assistant reply → the branch **inherits** the brief (reply calibrated,
     no re-intake); `assembleContext` order is `[brief, excerpt, …msgs]`.
  5. Generate lab / quiz from a briefed chat → artifacts align to the goal/level.

---

# Phase B — reusable learner profile (settings)

## New / modified files

### Profile module: extend `src/lib/chat/brief.ts`
- `export interface LearnerProfile { context?: string; level?: BriefLevel; mode?: BriefMode; }`
- `DEFAULT_PROFILE: LearnerProfile = { level: 'some', mode: 'socratic' }`.
- `applyProfile(profile: LearnerProfile, brief: Partial<LearningBrief>): LearningBrief` —
  fill `context`/`level`/`mode` from the profile where the brief omits them (explicit brief
  fields win).

### Settings accessors: extend `src/lib/ai/client.ts` (or a small `src/lib/profile.ts`)
- `getLearnerProfile(): Promise<LearnerProfile>` / `setLearnerProfile(p)` over the
  `learnerProfile` settings KV (mirrors `listProviders`/`saveProviders` pattern). Seed
  `DEFAULT_PROFILE` in `settingsRepo.seedDefaults`.

### `src/lib/components/chat/BriefCard.svelte`
- On mount (intake mode), load the profile and pre-fill level/mode/context from it; the user
  can still override per-brief. The **stored brief snapshots** the resolved values.

### `src/routes/settings/+page.svelte` (and its store)
- A "Learner profile" section: Context (textarea), Level (select), Mode (select) →
  `setLearnerProfile`. Mirrors the existing provider-config section styling.

### Tests
- `brief.test.ts`: `applyProfile` precedence (brief wins over profile; profile fills gaps;
  defaults fill the rest).
- A settings/profile round-trip test if a profile-store test exists.

## Phase B — validation / acceptance
- `pnpm test`/`check`/`lint`.
- Manual: set a profile in Settings → "New chat" → intake pre-fills level/mode/context from
  it → override one field per-chat → both the per-chat override and the profile persist
  independently; **reload** survives. A later profile edit does **not** retroactively change
  an existing briefed chat (snapshot semantics).

---

# Phase C — AI-inferred brief (after first message)

## New files

### `src/lib/ai/generate/generate-brief.ts` (orchestrator, mirrors `generate.ts`)
- `GeneratedBrief` = `Pick<LearningBrief, 'goal' | 'context' | 'level' | 'mode' | 'scope'>`
  with `goal` required, others optional; strict Zod schema (`.strict()`, unknown keys
  rejected), `level`/`mode` enums validated.
- `export const DEFAULT_BRIEF_PROMPT` — asks the model to read the conversation (which now
  *contains the first user message*) and emit a concise brief as one fenced JSON block.
- `parseGeneratedBrief(raw): GeneratedBrief` (throws `BriefParseError` carrying raw) +
  `generateBrief(provider, messages, opts): Promise<GeneratedBrief>` with the same retry
  loop (max 3) + `accumulate` pattern as lab/quiz generation.
- Settings-overridable prompt via a `briefPrompt` KV key + `readBriefPrompt()` (mirrors
  `readLabPrompt`).

### `src/lib/ai/generate/generate-brief.test.ts`
- `parseGeneratedBrief`: valid round-trip; unknown key rejected; bad enum rejected; bad JSON
  → `BriefParseError`.
- (Orchestrator retry is covered by a mock-provider test mirroring the lab/quiz suites.)

## Modified files

### `src/lib/stores/chat.svelte.ts`
- New state: `inferredBrief = $state<LearningBrief | null>(null)` and a private
  `inferController: AbortController | null`.
- After the first user message is appended (reuse the `isFirstRootTurn`-style guard, scoped
  to **root chats with `parseBrief(chat.brief) === null`**), fire `inferBrief(provider,
  ctx)` in parallel (not awaited; mirrors `autoTitleRoot`). On success set
  `inferredBrief`; swallow all errors; abort on `load`/`deleteChat`.
- `confirmInferredBrief(b?: LearningBrief)`: `saveBrief(b ?? inferredBrief)` then clear.
- `dismissInferredBrief()`: clear without saving.
- **Never** fire for chats that already have a brief, or for branches.

### `src/routes/chat/[id]/+page.svelte`
- When `chatStore.inferredBrief` is set (root, no brief) → render an inline **confirm/edit
  card** (reuse `BriefCard` in a propose mode): "Heard: *<goal>* (level *X*, *Y* mode) —
  right?" with **Use this** (→ `confirmInferredBrief`), **Edit** (open editor), and
  **Dismiss** (→ `dismissInferredBrief`). Dismiss does not re-fire.

### Tests
- `chat.svelte.test.ts`: first message on a null-brief root sets `inferredBrief`; a briefed
  root or a branch does **not** fire; `confirmInferredBrief` persists + clears;
  `dismissInferredBrief` clears without persisting.

## Phase C — validation / acceptance
- `pnpm test`/`check`/`lint`.
- Manual: "Just start chatting →" → send a first message → inferred brief card appears →
  "Use this" recalibrates subsequent turns; "Dismiss" leaves the chat brief-less (no
  re-fire); editing before confirming works. A manually-briefed chat never triggers inference.

---

## Risks / edge cases

- **Migration safety:** `brief` is nullable and additive; old rows get `null` and behave
  exactly as today. `parseBrief` is total (bad JSON → `null`), so a corrupted value can't
  break `assembleContext`.
- **Prompt-token cost:** the brief note is tiny (~5 lines) and added once per assembled
  context — negligible. Phase C adds one extra short AI call after the first message
  (best-effort, swallowable, abortable).
- **Escape-hatch fidelity:** `skipBrief` must produce a row whose `assembleContext` is
  byte-for-byte today's output (no note) — covered by the context test.
- **Branch inheritance correctness:** the brief is read from `target.rootId`, not the target
  itself, so a branch always gets the root's brief even though the branch's own `brief`
  column is `null`. The context test pins the `[brief, excerpt, …msgs]` order.
- **Snapshot vs reference (Phase B):** the stored brief is a snapshot; later profile edits
  must not silently change existing chats. Documented + tested.
- **Phase C non-overlap:** inference only for `parentId === null` AND null brief; never
  overrides manual; dismissed state is sticky for the session.
- **Generator prompt tuning:** appending one line to the defaults is low-risk; existing
  `labPrompt`/`quizPrompt` KV overrides are unaffected (they replace the whole prompt, by
  design).
- **Provider structured-output:** inferred-brief generation is prompt-driven (fenced JSON +
  Zod), consistent with lab/quiz — no per-adapter wire JSON-mode dependency.

## Open questions (out of scope unless raised)
- Spaced-repetition / mastery tracking against the brief's goal (future seam, arch §10) —
  not in this epic.
- Per-branch brief overrides (a branch changing its own framing) — explicitly out of scope;
  branches inherit the root brief.
