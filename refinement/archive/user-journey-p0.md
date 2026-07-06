# Phased plan — User-journey audit, Wave 1: P0 fixes

- **Source spec:** `refinement/2026-07-05 user-journey-audit.md` (findings A1, A2, A3, B1, plus the generate-state bug from the "Other comments" note).
- **Status:** Execution-ready breakdown built *from* the audit. Turns each finding into file-level tasks, tests, manual gates, and the few open implementation decisions (collected in **Decisions** below).
- **Phase keys:** `UJ1` … `UJ5`. Phases are sized so each is independently shippable. This file covers **Wave 1 (the P0s)**.
- **Authoritative for:** file paths, task ordering, tests, gates. Where this doc and the audit disagree on *mechanism* (one correction — see UJ2 / Decisions), this doc wins on mechanism; the product decisions stay with the audit.
- **Where this lives:** `refinement/user-journey-p0.md` (per request). `AGENTS.md` keeps the *active* execution checklist in `.kilo/plans/`; this is the design-level phased plan.
- **Relationship to `user-journey-p1a.md`, `user-journey-p1b.md`, `user-journey-p2.md`:** those cover Waves 2–4. UJ1 here is the on-ramp — it makes the app "true to what it is" and is a prerequisite for the home-page and provider-gate work downstream.

## Cross-cutting conventions (apply to every phase)

- **Two runtimes, one file format.** Every storage change must work in **both** the browser (sqlite-wasm + OPFS worker) and desktop (native SQLite via `@tauri-apps/plugin-sql`), or be behind a runtime flag. Schema changes are additive migrations: `pnpm db:generate` → `pnpm bundle:migrations`.
- **One storage seam.** New storage capabilities extend `StorageDriver` (`src/lib/db/driver/types.ts`) as **optional** methods; components/stores call repositories only.
- **Keys never enter the DB.** The active provider config + key are resolved at send time via `getActiveSdkProvider()`; this wave reads them, never persists them.
- **Every phase ships:** (a) automated Vitest coverage against the **in-memory** driver (`pnpm test`), and (b) a **manual** gate for the OPFS + Tauri runtimes (cannot run in CI).
- **Lint/typecheck before done:** `pnpm lint && pnpm check`.

## Phase dependency graph

```
UJ1 (home + provider-gate) ─┐
UJ2 (honest reasoning)      ├─ independent; can start in parallel
UJ3 (model chip)            │
UJ4 (generate-state bug)    ┘
```

UJ1–UJ4 are fully independent and can land in any order or in parallel. UJ1 is listed first because it is the largest and the others are one-file changes; UJ2 and UJ3 share the `supportsReasoningEffort` capability check and benefit from being read together.

---

## UJ1 — Home page + first-run provider gate (A1 + B1)

A1 ("home is a P0 placeholder") and B1 ("first-run is a dead end with no provider guidance") are one phase because they share the same new `/` composition and the same `listProviders()` gate. Bundling them turns the worst perceived-quality defect (a phase-report as a home page) into the on-ramp for the whole app.

**Mechanism (decided):**
- `/` becomes a real home: recent chats (top 5), a prominent "New chat" CTA, quick links to in-progress labs/quizzes, and a genuine empty-state.
- The empty-state branches on `listProviders()`: if empty, the home shows a single focused "Add a provider to start" card → `/settings` (this is the B1 gate); otherwise it shows the normal recent-activity home.
- The existing P0 scaffolding text ("P0 foundation is live…") is deleted.

**Files modified**
- `src/routes/+page.svelte` (the entire 22-line file) — rewrite:
  - `<script>`: `onMount` loads `repos.chats.listRoots()` (top 5 by `updatedAt`), `repos.labs.listAll()` (in-progress: any lab with an unticked checklist item, top 3), `repos.quizzes.listAll()` (top 3), and `repos.providers.list()` (the gate).
  - Render order:
    1. If `providers.length === 0` → the **first-run card**: "Add a provider to start" + a single button → `goto('/settings')`. Nothing else. This is the B1 fix.
    2. Else if `chats.length === 0 && labs.length === 0 && quizzes.length === 0` → a **genuine empty-state**: a friendly "Start your first chat" CTA (`goto('/chat')`), no "P0 foundation" text.
    3. Else → the **real home**: a "New chat" CTA at top; "Recent chats" (top 5, each links to `/chat/[id]`); "In-progress labs" (top 3, each links to `/lab/[id]`); "Recent quizzes" (top 3, each links to `/quiz/[id]`). Reuse the `timeAgo` helper already in `src/routes/chat/+page.svelte:80-89` — extract it to `src/lib/utils/time.ts` (new) so both routes share it.
- `src/routes/chat/+page.svelte` — defensive guard (the B1 half): if `listProviders()` is empty, the "New chat" button still works (it just lands on a brief-less chat that will fail to stream with a `MissingKeyError`). To close the trap, when `providers.length === 0`, the chat-list empty-state replaces *"Click 'New chat' to begin"* (`:117-121`) with *"Add a provider first"* + an "Open Settings" button. The chat list keeps loading normally otherwise.
- `src/lib/utils/time.ts` **(new)** — `export function timeAgo(ts: number): string` extracted verbatim from `chat/+page.svelte:80-89`.
- `src/routes/chat/+page.svelte` — replace the inline `timeAgo` (`:80-89`) with the shared import.

**Decision surfaced while planning — the gate reads providers, not keys**

`listProviders()` returns provider *config* rows (handle fields only — name, baseUrl, defaultModel). It does **not** tell you whether a key exists (keys live in the keychain / IndexedDB and are never echoed into the DB). So the gate is "has at least one provider configured." A provider configured but keyless still passes the gate and will surface a `MissingKeyError` at send time with the existing "Open Settings" link (`chat/[id]/+page.svelte:596-600`). That is acceptable and consistent: the gate removes the *discovery* trap; the key-missing card remains the *send-time* trap it already is. Checking keys proactively would require a keychain round-trip on every home load — not worth it.

**Tests** (Vitest, in-memory driver)
- A `+page.svelte`-level test is out of scope (component + routing). Instead, add a repository contract test that the gate depends on: `repos.providers.list()` returns `[]` on an empty DB, and returns exactly the configured rows after inserts (already likely covered; add if missing).
- `timeAgo` unit test in `src/lib/utils/time.test.ts`: boundaries (just now, 5m, 3h, 2d).

**Manual gate**
- Fresh DB (no providers): `pnpm dev` → `/` shows **only** the "Add a provider to start" card → click → lands on `/settings`. `/chat` empty-state says "Add a provider first" + "Open Settings".
- After adding one provider (no key needed for the gate): `/` shows the genuine empty-state ("Start your first chat").
- With data: `/` shows "New chat" + recent chats/labs/quizzes, each navigable. No "P0 foundation" text anywhere. "Home" in the sidebar (`AppShell.svelte:28`) lands here, not on scaffolding.

### UJ1 — decisions / open items
- **RESOLVED:** the first-run gate reads `listProviders()` (config rows), not keys. Keyless providers pass the gate; the send-time `MissingKeyError` card is unchanged.

---

## UJ2 — Honest "deep" reasoning tiers (A2)

**Mechanism (decided — per the `[!NOTE]` on audit A2: "Let's label honestly"):**
- When the active model cannot honor `deep` (i.e. `supportsReasoningEffort(modelId)` is false for `openai-compatible`, or the model is Anthropic/Gemini/Ollama where `deep` *does* differ), the Composer keeps the 3-state cycle but the **label** is honest.
- For `openai-compatible` models where `deep` is a no-op: when `effort === 'deep'`, the tooltip/aria-label reads *"Thinking: on (deep not supported by this model)"* instead of *"Thinking: deep (more reasoning tokens)"*, and the dot indicator is suppressed (it currently promises "more reasoning" that isn't delivered).
- The cycle stays `on → deep → off` (we do **not** collapse to 2 states — the user can still select `deep` and see the honest label; this preserves muscle memory and leaves room for future models). This is the explicit `[!NOTE]` decision: "label honestly," not "hide it."

**Decision surfaced while planning — where the capability check lives**

The Composer is a controlled input; it doesn't know the active model. Two options:

1. Pass `supportsDeep: boolean` as a prop into `Composer` from `chat/[id]/+page.svelte`, which resolves it from `getActiveSdkProvider()` (async, but the chat page already awaits provider resolution on send).
2. Export `supportsReasoningEffort` from `sdk-factory.ts` and have the Composer read the active model id directly.

**Decided:** option 1 (prop in). The Composer stays a thin, controlled input and the capability truth flows from the same `getActiveSdkProvider()` the send path uses. The active model id is resolved reactively in the chat page via a small `$state` set on provider change, and `supportsReasoningEffort(modelId)` is computed there and passed down. This keeps `sdk-factory.ts` as the single owner of the capability rule (already the case at `:67-69`) and the Composer free of provider-resolution concerns.

**Files modified**
- `src/lib/ai/sdk-factory.ts`
  - **Export** `supportsReasoningEffort` (currently module-private at `:67-69`) so the chat page can call it. No logic change.
- `src/lib/components/chat/Composer.svelte`
  - Add prop `supportsDeep = true` (default true so the component is safe in isolation / other call sites).
  - Change the `title`/`aria-label` for the `deep` branch (`:99-108`) to be conditional on `supportsDeep`:
    - `supportsDeep === true` → *"Thinking: deep (more reasoning tokens) — tap to disable"* (unchanged).
    - `supportsDeep === false` → *"Thinking: on (deep not supported by this model)"*.
  - Gate the dot indicator (`:112-117`) on `effort === 'deep' && supportsDeep`.
- `src/routes/chat/[id]/+page.svelte`
  - Add `let activeModelId = $state<string | undefined>(undefined)` and `let activeKind = $state<ProviderConfig['kind'] | undefined>(undefined)`.
  - Resolve them reactively: a `$effect`/`onMount` that calls `getActiveSdkProvider()` once (best-effort; it's cached client-side) and sets both. Re-resolve when the active provider changes (the settings page already mutates provider rows; the chat page can re-read on `onMount` and on route focus if needed — keep it simple: read on mount + on `chatStore.chat` change).
  - Compute `const supportsDeep = $derived(activeKind === 'openai-compatible' ? supportsReasoningEffort(activeModelId) : true)` and pass `supportsDeep` to `<Composer>`.

**Tests** (Vitest)
- Add to the existing `sdk-factory` test module (or create `src/lib/ai/sdk-factory.test.ts` if none): `supportsReasoningEffort('glm-5.2')` → true; `supportsReasoningEffort('gpt-4o')` → false; `supportsReasoningEffort('glm-5.1')` → false; `supportsReasoningEffort(undefined)` → false.
- Composer-level: out of scope (purely presentational conditional). The capability rule is the testable unit.

**Manual gate**
- Active provider = Z.AI GLM-5.2: cycle shows all three states, `deep` shows the dot + *"more reasoning tokens"* tooltip. (Unchanged behavior — regression check.)
- Active provider = OpenAI / OpenRouter / Z.AI 5.1: cycle shows all three, but `deep` shows **no dot** and the tooltip reads *"Thinking: on (deep not supported by this model)"*.
- Anthropic / Gemini: `deep` shows the dot + the honest full label (these models *do* honor deep, so behavior is unchanged).

### UJ2 — decisions / open items
- **RESOLVED:** label honestly (per audit `[!NOTE]`), keep the 3-state cycle, suppress the dot when deep is unsupported.
- **RESOLVED:** capability check flows as a `supportsDeep` prop from the chat page → Composer; `supportsReasoningEffort` is exported from `sdk-factory.ts`.

---

## UJ3 — Model / provider chip in chat (A3)

The single highest-leverage definitiveness fix: in a BYOK app the model is the product, and right now it's invisible mid-conversation.

**Mechanism (decided):**
- A small, always-visible chip in the **composer row** (the bottom pane of `chat/[id]/+page.svelte`, next to the textarea): `<provider name> · <model id>`.
- It updates reactively when the user switches the active provider in Settings (same reactive resolution as UJ2 — `getActiveSdkProvider()` on mount / provider change).
- Optional per-message model label on the assistant row is **deferred to P1b** (it touches `MessageRow.svelte` and the `message.metadata.model` path at `chat.svelte.ts:241-243`; do it in the chat-polish wave to keep this P0 small). This phase ships the always-visible chip only.
- Fix the latent bug noted in A3: `createAndNavigate` never sets `chat.provider` (`chat.svelte.ts:147-153`), so the chat *list* shows it as null. **Do not** fix `chat.provider` here — that column is a stale idea (the active provider can change freely; stamping it at create time would lie). Instead, the chip reads the *current* active provider, not a stored column. Leave `chat.provider` null and remove the dead `{#if chat.provider}` render at `chat/+page.svelte:134-136` (it never fires today).

**Files modified**
- `src/lib/components/chat/Composer.svelte`
  - Add an optional snippet prop `chip` (`chip?: Snippet`) rendered at the start of the composer row (`:85`), left of the textarea. Keeping it a snippet lets the chat page own the resolution + formatting; the Composer stays presentational.
  - Alternatively (simpler, fewer moving parts): add `providerName?: string` and `modelId?: string` props and render the chip inline when both are present. **Decided: inline props** — the chip is a single `<span>` and a snippet is overkill.
- `src/routes/chat/[id]/+page.svelte`
  - Reuse the `activeModelId` / active-provider-name resolution from UJ2 (same `$state` + `$effect`).
  - Resolve the provider *display name* too: `getActiveSdkProvider()` returns `{ config }` where `config.name` is the handle. Pass `providerName={activeProviderName}` and `modelId={activeModelId}` to `<Composer>`.
- `src/routes/chat/+page.svelte` — remove the dead `{#if chat.provider}` block (`:134-136`) since `chat.provider` is never set and the chip now lives in the composer row.

**Tests**
- None automated (presentational). The provider resolution is already exercised by the send path.

**Manual gate**
- `/chat/[id]`: the composer row shows `<provider name> · <model id>` (e.g. "Z.AI · glm-5.2").
- Switch active provider in `/settings` → return to the chat → chip updates to the new provider/model.
- Different provider kinds (OpenAI, Anthropic, Gemini, Ollama) all show a sensible chip. The chat list no longer has a dead provider line.

### UJ3 — decisions / open items
- **RESOLVED:** chip lives in the composer row (always visible), not the header. Per-message label deferred to P1b.
- **RESOLVED:** do **not** stamp `chat.provider` at create time (it would lie when the user switches providers). Remove the dead render in the chat list.
- **[DECISION? — for sign-off]:** chip format — `<provider> · <model>` (recommended) vs `<provider>:<model>` vs provider-only. **Recommendation: `<provider> · <model>`** (matches the audit's suggestion and the existing `·` separator used elsewhere in the UI).

---

## UJ4 — Honest lab/quiz generation state (the "Other comments" note)

> *"When I generate a lab or a quiz, both become 'Generating...'. It's not true because only one is generating. Disable the other and add an animation for feedback."*

**Root cause (verified):** the stores already have **separate** flags (`labsStore.generating` at `labs.svelte.ts:34`, `quizzesStore.generating` at `quizzes.svelte.ts:57`), but the chat page collapses them into one boolean at the call site:

```svelte
<!-- chat/[id]/+page.svelte:677 (desktop rail) and :700 (mobile sheet) -->
generating={labsStore.generating || quizzesStore.generating}
```

`ChatRail.svelte` then renders that single boolean on **both** buttons (`:111-123` labs, `:148-160` quizzes), so generating a lab lights up "Generating…" on the quiz button too.

**Mechanism (decided):**
- Split the single `generating` prop into `generatingLab` and `generatingQuiz`.
- Each button shows its own state; the **other** button is disabled (not "Generating…") while one is running, per the user's note ("disable the other one").
- Add a small spinner animation to the active button's "Generating…" label (the user asked for "a simple animation so the user has feedback whether the generation is still running").

**Files modified**
- `src/lib/components/chat/ChatRail.svelte`
  - Replace the `generating: boolean` prop (`:30`) with `generatingLab: boolean` and `generatingQuiz: boolean`.
  - Labs button (`:111-123`): `disabled={generatingLab || generatingQuiz}`; label = `generatingLab ? <Spinner size="xs" /> Generating…` : `Generate lab`.
  - Quizzes button (`:148-160`): `disabled={generatingLab || generatingQuiz}`; label = `generatingQuiz ? <Spinner size="xs" /> Generating…` : `Generate quiz`.
  - The `disabled` on the *other* button implements "disable the other one"; the spinner on the active button implements the feedback animation.
- `src/routes/chat/[id]/+page.svelte`
  - Desktop rail (`:667-681`): replace `generating={labsStore.generating || quizzesStore.generating}` with `generatingLab={labsStore.generating}` `generatingQuiz={quizzesStore.generating}`.
  - Mobile sheet rail (`:690-702`): same change.
- `src/lib/components/chat/Spinner.svelte` — confirm it accepts a `size` prop (or add `"xs"` to its variants). It already has `variant="orbit"` / `"pulse"` (`MessageList.svelte:68,80`); add an `xs` size if missing.

**Tests**
- None automated (presentational). The store-level `generating` flags are already correct; this is purely a prop-wiring fix.

**Manual gate**
- In a chat, click "Generate lab": the labs button shows "Generating…" + spinner; the quizzes button is **disabled** (greyed, not "Generating…"). When the lab finishes (navigates to `/lab/[id]`), both buttons return to normal.
- Symmetric for "Generate quiz".
- (Edge case, accepted): navigating away mid-generation aborts (existing behavior); returning shows both buttons normal (the store flags reset in `finally`).

### UJ4 — decisions / open items
- None unresolved. The fix is mechanical.

---

## Decisions surfaced & made while planning (summary)

These are implementation-level decisions the audit did **not** make. Each is resolved here; the two marked **[DECISION?]** are offered for sign-off (recommendation given).

| # | Decision | Status |
|---|----------|--------|
| A | **UJ1:** the first-run gate reads `listProviders()` (config rows), not keys. Keyless providers pass the gate; the send-time `MissingKeyError` card is unchanged. | Decided |
| B | **UJ2:** label honestly (per audit `[!NOTE]`); keep the 3-state cycle; suppress the dot when deep is unsupported. | Decided |
| C | **UJ2:** capability check flows as a `supportsDeep` prop (chat page → Composer); `supportsReasoningEffort` exported from `sdk-factory.ts`. | Decided |
| D | **UJ3:** chip lives in the composer row (always visible); per-message label deferred to P1b. Do **not** stamp `chat.provider` at create time; remove the dead chat-list render. | Decided |
| E | **UJ3:** chip format = `<provider> · <model>`. | **[DECISION?]** — recommend accept |
| F | **UJ4:** split the single `generating` prop into `generatingLab`/`generatingQuiz`; disable the other button (not "Generating…"); add a spinner to the active one. | Decided |

## Verification gates (per phase)

| Phase | Automated (`pnpm test`, in-memory) | Manual (OPFS + Tauri) |
|-------|------------------------------------|------------------------|
| UJ1 | `timeAgo` unit; `providers.list()` empty/populated contract | fresh-DB provider gate; empty-state; real home with data; no "P0 foundation" text |
| UJ2 | `supportsReasoningEffort` for glm-5.2 / gpt-4o / glm-5.1 / undefined | GLM-5.2 dot+label; OpenAI honest label, no dot; Anthropic/Gemini unchanged |
| UJ3 | n/a (presentational) | chip shows `<provider> · <model>`; updates on provider switch; chat-list dead line gone |
| UJ4 | n/a (presentational) | generate-lab disables quiz button + spinner; symmetric for quiz |

## Suggested order of work

1. **UJ4** (one-file prop fix; smallest, unblocks nothing but is a fast win and removes a visible "the app lies" moment).
2. **UJ2** (one capability export + Composer conditional; pairs naturally with UJ3 since both need provider resolution).
3. **UJ3** (chip in composer row; reuses UJ2's provider resolution).
4. **UJ1** (home rewrite + provider gate; largest, but independently shippable and the highest perceived-quality jump).

## Needs sign-off

- **E** — chip format (`<provider> · <model>` recommended).
- Confirm the split: UJ1–UJ4 in this file, with the P1s in `user-journey-p1a.md` / `user-journey-p1b.md` and the P2s in `user-journey-p2.md`.
