# Phase B — Reusable learner profile (snapshotted into the brief)

Implements **Phase B** of `refinement/learning-brief-refinement.md` (the Learning
Brief epic). Phase A is shipped; this phase layers a reusable, settings-backed
**learner profile** that pre-applies the topic-agnostic brief fields
(`context` / `level` / `mode`) at intake, then **snapshots** the resolved values
into `chats.brief` so a later profile edit never retroactively changes an
existing briefed chat.

**Source of truth:** `refinement/learning-brief-refinement.md` §"Phase B" and the
locked decisions in §2. Treat `architecture.md` as the authoritative design.

---

## Resolved design decisions

1. **Pure vs IO split.** `brief.ts` stays a *pure, DOM-free* module (its existing
   contract + tests). The pure additions — `LearnerProfile` type, `DEFAULT_PROFILE`,
   `applyProfile` — stay in `brief.ts`. The async DB accessors
   `getLearnerProfile()` / `setLearnerProfile()` live in a **new**
   `src/lib/chat/profile.ts` that lazy-imports `$lib/db` (exact mirror of
   `readLabPrompt` in `generate.ts`, which is outside the pure parser).
2. **No schema change.** The profile is stored in the `settings` KV under key
   `learnerProfile`; the `chats.brief` column already exists (Phase A migration
   `0001`). Therefore **do NOT run `pnpm db:generate` or `pnpm bundle:migrations`**.
3. **`applyProfile` return type (documented deviation).** The refinement doc types
   it `: LearningBrief` (goal required), but it is called at intake-seed with
   `applyProfile(profile, {})` where `goal` is absent. The implementation returns a
   resolved shape that **guarantees `level` and `mode`** (precedence:
   brief > profile > `DEFAULT_LEVEL`/`DEFAULT_MODE`) and **passes `goal` /
   `scope` / `context` through** as optional. See task 1 for the exact type.
4. **Snapshot semantics.** Pre-fill + store-resolved = snapshot. `BriefCard` in
   **intake mode only** loads the profile on mount and seeds the form via
   `applyProfile`. The saved brief is the already-resolved form state (possibly
   overridden by the user). **Edit mode never reads the profile** — it shows the
   stored snapshot — which is exactly what makes later profile edits non-retroactive.
5. **No new store.** Settings UI reads/writes through the accessors inline (mirrors
   `LabPromptConfig`, which uses `repos` directly via `onMount` — there is no
   settings store module).

---

## Tasks

### 1. Extend `src/lib/chat/brief.ts` (pure additions only)

Add, alongside the existing types/consts:

```ts
/** Topic-agnostic defaults reused across chats; snapshotted into a brief at intake. */
export interface LearnerProfile {
	context?: string;
	level?: BriefLevel;
	mode?: BriefMode;
}

export const DEFAULT_PROFILE: LearnerProfile = { level: 'some', mode: 'socratic' };

/**
 * Resolved brief fields after applying a profile. `level`/`mode` are always
 * present (precedence: brief > profile > defaults); `goal`/`scope`/`context`
 * pass through from `brief` unchanged.
 *
 * (Deviation from the refinement doc, which typed this `LearningBrief`: goal is
 * not guaranteed when seeding an empty intake, so the return must allow it
 * absent. `level`/`mode` are the only fields applyProfile actually resolves.)
 */
export interface ResolvedBriefFields {
	goal?: string;
	context?: string;
	level: BriefLevel;
	mode: BriefMode;
	scope?: string;
}

/**
 * Fill `context`/`level`/`mode` from `profile` where `brief` omits them, then
 * fill any still-missing level/mode with the defaults. Explicit `brief` fields
 * ALWAYS win; the profile only fills gaps; defaults fill the rest. `goal` and
 * `scope` are passed through untouched (not profile fields).
 */
export function applyProfile(profile: LearnerProfile, brief: Partial<LearningBrief>): ResolvedBriefFields;
```

Precedence to implement: for `level` → `brief.level ?? profile.level ?? DEFAULT_LEVEL`;
same for `mode`. `context` → `brief.context ?? profile.context` (no default — empty
means "not given"). `goal`/`scope` → `brief.goal` / `brief.scope` (pass-through).

### 2. New `src/lib/chat/profile.ts` (async DB accessors)

```ts
import { DEFAULT_PROFILE, LEVEL_OPTIONS, MODE_OPTIONS, type LearnerProfile } from './brief';

const PROFILE_KEY = 'learnerProfile';

/** Read the learner profile, validating enums and falling back to DEFAULT_PROFILE. */
export async function getLearnerProfile(): Promise<LearnerProfile> {
	const { repos } = await import('$lib/db');
	const raw = await repos.settings.get<LearnerProfile>(PROFILE_KEY);
	if (!raw || typeof raw !== 'object') return { ...DEFAULT_PROFILE };
	const profile: LearnerProfile = {};
	if (typeof raw.context === 'string' && raw.context.trim().length > 0) profile.context = raw.context;
	if (LEVEL_OPTIONS.includes(raw.level as never)) profile.level = raw.level;
	if (MODE_OPTIONS.includes(raw.mode as never)) profile.mode = raw.mode;
	return profile;
}

/** Persist the learner profile (overwrite). */
export async function setLearnerProfile(profile: LearnerProfile): Promise<void> {
	const { repos } = await import('$lib/db');
	await repos.settings.set(PROFILE_KEY, profile);
}
```

Enum validation reuses the already-exported `LEVEL_OPTIONS` / `MODE_OPTIONS`
(keeps `brief.ts` free of newly-exported internal guards).

### 3. `src/lib/db/repositories/settings.ts` — seed `DEFAULT_PROFILE`

- Import `DEFAULT_PROFILE` from `$lib/chat/brief` (pure module — no cycle; `chats.ts`
  already imports from `$lib/chat/brief`).
- In `seedDefaults`, add (idempotent, alongside the existing `providers` seed):
  `if ((await this.get('learnerProfile')) === null) await this.set('learnerProfile', DEFAULT_PROFILE);`

### 4. `src/lib/components/chat/BriefCard.svelte` — intake pre-fill

- Import `applyProfile` from `$lib/chat/brief` and `getLearnerProfile` from `$lib/chat/profile`.
- Add `onMount` (intake mode only — guarded by `mode === 'intake'`): load the
  profile, compute `const seed = applyProfile(profile, brief ?? {})`, then seed
  local state from it: `goal = seed.goal ?? ''`, `level = seed.level`,
  `modeVal = seed.mode`, `context = seed.context ?? ''`, `scopeState = seed.scope ?? ''`.
  - Seeding must run **once** (the card already remounts fresh per open, and
    existing initial state uses `untrack`; keep that one-shot capture pattern —
    do not let profile load clobber user edits after mount).
- **Edit mode is unchanged** — keep seeding from the `brief` prop directly (the
  stored snapshot). Do **not** load the profile in edit mode.
- `buildBrief()` is unchanged: it already emits a fully-resolved `LearningBrief`
  (level/mode always set), so the saved brief is the snapshot. No save-time
  `applyProfile` call needed.
- Loading the profile is best-effort for UX; if it rejects, fall back to the
  current defaults silently (wrap in try/catch, leave the existing seed values).

### 5. New `src/lib/components/chat/LearnerProfileConfig.svelte`

Mirror `LabPromptConfig.svelte` structure/styling (`<section class="space-y-3">`,
`onMount` load, status line). Three controls bound to a local draft:
- **Context** — `<textarea>` (role/situation; optional).
- **Level** — `<select>` over `LEVEL_OPTIONS` with `LEVEL_LABELS`.
- **Mode** — `<select>` over `MODE_OPTIONS` with `MODE_LABELS`.

Load via `getLearnerProfile()` on mount; persist via `setLearnerProfile(clean)`
on a Save button and/or blur (drop empty/whitespace `context` before saving so
"not given" round-trips cleanly). Show a "Reset to default" affordance that writes
`DEFAULT_PROFILE` (mirror `LabPromptConfig`'s reset). Use the same `inputClass`
styling as `BriefCard`/`ProviderConfig`.

### 6. `src/routes/settings/+page.svelte` — render the new section

Add `<LearnerProfileConfig />` inside the existing `ProviderConfig` children
snippet, alongside `<LabPromptConfig />` and `<QuizPromptConfig />` (one line +
one import).

---

## Tests

### `src/lib/chat/brief.test.ts` — add an `applyProfile` describe block
- **brief > profile:** explicit `brief.level`/`brief.mode`/`brief.context` win over
  the profile.
- **profile fills gaps:** when `brief` omits a field, the profile value is used.
- **defaults fill the rest:** when both omit level/mode, result is
  `DEFAULT_LEVEL` / `DEFAULT_MODE` (level/mode always present).
- **goal/scope pass through** unchanged (not touched by the profile).
- **empty brief + empty profile:** level/mode = defaults, no context.

### `src/lib/db/repositories/repositories.test.ts` — settings section
- Extend the "seeds provider defaults idempotently" test (or add a sibling):
  after `seedDefaults()`, `getLearnerProfile()` returns `DEFAULT_PROFILE`.
- Add a profile round-trip: `setLearnerProfile({ context: 'x', level: 'regular',
  mode: 'build' })` → `getLearnerProfile()` returns the same; set with a bad enum
  value persisted directly → `getLearnerProfile()` drops it (defensive read).

---

## Validation

- `pnpm test` — new `applyProfile` + profile round-trip tests pass; existing brief
  / context / repo tests stay green.
- `pnpm check` — `svelte-check` clean (incl. the new `ResolvedBriefFields` type
  usage in `BriefCard`).
- `pnpm lint` — ESLint + Prettier clean.
- **Manual gate (browser):** `pnpm dev` → `/settings` → set a Learner profile
  (e.g. level *Regular*, mode *Explainer*, context "on-call") → **New chat** →
  intake pre-fills level/mode/context from the profile → type only a **goal**
  (optionally scope) → **Start learning** → reload persists the briefed chat.
  Then: add a **second** chat and **override one field** at intake → both the
  per-chat override and the original profile persist independently (verify in
  `/settings`). Finally: **edit the profile** in Settings → an *existing* briefed
  chat's stored brief is **unchanged** (snapshot semantics).
- **Manual gate (desktop):** `pnpm tauri dev` → same flow → profile + brief
  survive an **app restart**.

---

## Risks / edge cases

- **Snapshot vs reference:** the stored brief is resolved at intake; later profile
  edits must not change it. Guaranteed by (a) edit mode never reading the profile,
  and (b) the stored value being the resolved snapshot. Pinned by the manual gate
  + the `applyProfile` precedence tests.
- **`brief.ts` purity:** keep it DB-free. Any IO belongs in `profile.ts`. The pure
  `applyProfile`/`LearnerProfile`/`DEFAULT_PROFILE` stay testable without a driver.
- **Defensive read:** `getLearnerProfile` validates enums and falls back to
  `DEFAULT_PROFILE` for missing/corrupt KV — a bad value can never break intake.
- **No migration:** this phase touches only the `settings` KV and existing
  `chats.brief`. Do not run `db:generate` / `bundle:migrations`.
- **Both intake entry points covered:** `BriefCard` is shared by the new-chat flow
  (`/chat/+page.svelte`) and the fresh-root intake (`/chat/[id]/+page.svelte`), so
  pre-filling lives in the component and reaches both for free.

## Out of scope

- AI-inferred brief (Phase C).
- Per-branch brief overrides (branches inherit the root brief by design).
- Hiding the level/mode/context fields at intake — Phase B pre-fills them; they
  remain visible/editable so the user can override per-chat (required by the
  acceptance criteria).
