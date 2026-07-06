# Plan — User-journey Wave 1 (P0 fixes: UJ1–UJ4)

Execution plan for `refinement/user-journey-p0.md`. The design doc is
authoritative for product decisions and task scope; **this file is authoritative
for mechanism** — every `file:line` below was verified against the live code on
2026-07-05, and the three spots where the code disagrees with the design doc are
corrected in **Verification corrections** below.

Four independent phases, shipped as one wave. Order below = suggested order of
work from the design doc (smallest first), but any order is safe — they touch
disjoint files except UJ2/UJ3 sharing the provider-resolution logic on
`chat/[id]/+page.svelte` (so do UJ2 **before or with** UJ3).

---

## Verification corrections (code-vs-doc; plan wins on mechanism)

1. **There is no `repos.providers`.** The design doc's gate reads
   `repos.providers.list()` (doc:42,53) — that repository does not exist.
   Providers are read via **`listProviders()` from `$lib/ai/client.ts:24`**,
   which loads the `providers` settings KV (`Record<string, ProviderConfig>`) and
   returns `ProviderConfig[]`. → **All provider-list calls in UJ1 use
   `listProviders()`**, not a repo. Consequently the "already likely covered"
   provider-list test target changes from `repos.providers.list()` to
   `listProviders()` (it's a settings-KV read; covered by settings repo tests,
   but the UJ1 test should hit `listProviders()` directly).

2. **`getActiveSdkProvider()` throws.** UJ2/UJ3 resolve the active provider on
   mount via `getActiveSdkProvider()` (`$lib/ai/client.ts:88`), which **throws
   `MissingKeyError`** when no provider is active or the active one has no key
   (`:90-102`). A `/chat/[id]` page can be open in exactly that state. → The
   on-mount resolution **must be wrapped in try/catch**: on `MissingKeyError`,
   fall back to `supportsDeep = true` (no label change) and hide the chip. The
   design doc calls this "best-effort" but does not flag the throw.

3. **`Spinner` has no `size` prop.** `Spinner.svelte` accepts only
   `variant: 'pulse' | 'orbit'` + `class`; its inner glyphs are fixed `size-4`
   (`:6,:15`) so a `class="size-3"` only resizes the wrapper, not the glyph.
   → UJ4 uses an inline lucide spinner (`LoaderCircle` + `animate-spin`) in the
   button label instead of extending `Spinner`. No shared-component change.

All other `file:line` citations in the design doc verified accurate (see
**Verified anchors** at the end of each phase).

---

## UJ4 — Honest lab/quiz generation state  *(do first: one-file prop fix)*

**Root cause (verified):** `ChatRail` takes a single `generating: boolean`
(`ChatRail.svelte:17,30`) and renders it on **both** the labs button
(`:111-123`) and the quizzes button (`:148-160`). The call site collapses two
correct store flags into that one boolean:
`generating={labsStore.generating || quizzesStore.generating}` at
`chat/[id]/+page.svelte:677` (desktop) and `:700` (mobile sheet). So generating a
lab lights up "Generating…" on the quiz button too.

**Tasks**
1. `src/lib/components/chat/ChatRail.svelte`
   - Props (`:7-33`): replace `generating: boolean` with
     `generatingLab: boolean` and `generatingQuiz: boolean`.
   - Labs button (`:111-123`): `disabled={generatingLab || generatingQuiz}`;
     label = `{#if generatingLab}<LoaderCircle class="size-3 animate-spin" /> Generating…{:else}Generate lab{/if}`.
   - Quizzes button (`:148-160`): `disabled={generatingLab || generatingQuiz}`;
     label = `{#if generatingQuiz}<LoaderCircle class="size-3 animate-spin" /> Generating…{:else}Generate quiz{/if}`.
   - Import `LoaderCircle` from `@lucide/svelte` alongside the existing icons
     (`:2`).
   - The `disabled` on the **other** button = "disable the other one"; the
     spinner on the active button = the feedback animation.
2. `src/routes/chat/[id]/+page.svelte`
   - Desktop rail (`:667-681`): replace the `generating={…}` line (`:677`) with
     `generatingLab={labsStore.generating}` `generatingQuiz={quizzesStore.generating}`.
   - Mobile sheet rail (`:690-702`): same change at `:700`.

**Tests:** none automated (presentational). Store flags
(`labs.svelte.ts:34`, `quizzes.svelte.ts:57`) already correct and covered.

**Manual gate:** in a chat, "Generate lab" → labs button shows "Generating…" +
spinner, quizzes button **disabled** (greyed, not "Generating…"). Lab finishes
(navigates to `/lab/[id]`) → both buttons normal. Symmetric for quiz. (Accepted
edge: navigating away mid-generation aborts; flags reset in `finally`.)

---

## UJ2 — Honest "deep" reasoning tier  *(capability export + Composer conditional)*

**Mechanism (decided in design doc, NOTE on audit A2):** keep the 3-state cycle
`on → deep → off`; when the active model can't honor `deep`, **label honestly**
and suppress the dot — do **not** collapse to 2 states.

**Tasks**
1. `src/lib/ai/sdk-factory.ts:67-69` — **export** `supportsReasoningEffort`
   (currently module-private). Change `function supportsReasoningEffort` →
   `export function supportsReasoningEffort`. No logic change.
2. `src/lib/components/chat/Composer.svelte`
   - Add prop `supportsDeep = true` (default true so the component is safe in
     isolation): add `supportsDeep?: boolean` to the prop type (`:16-26`) and to
     the destructure.
   - `deep`-branch `title` (`:99-103`): when `effort === 'deep'`, render
     `supportsDeep ? 'Thinking: deep (more reasoning tokens) — tap to disable'
     : 'Thinking: on (deep not supported by this model)'`.
   - `deep`-branch `aria-label` (`:104-108`): symmetric —
     `supportsDeep ? 'Thinking deep' : 'Thinking on (deep not supported)'`.
   - Dot indicator (`:112-117`): gate on `effort === 'deep' && supportsDeep`.
3. `src/routes/chat/[id]/+page.svelte`
   - Add `let activeModelId = $state<string | undefined>(undefined)` and
     `let activeKind = $state<ProviderConfig['kind'] | undefined>(undefined)`.
   - Resolve reactively: an `onMount` (or `$effect`) calling
     `getActiveSdkProvider()` **inside try/catch** (see correction #2). On
     success set both from `config.defaultModel` / `config.kind`; on
     `MissingKeyError` leave them `undefined`. Re-resolve on
     `chatStore.chat` change is optional — keep it simple: read on mount only.
   - `const supportsDeep = $derived(activeKind === 'openai-compatible'
     ? supportsReasoningEffort(activeModelId) : true)` and pass
     `supportsDeep` to `<Composer>` (call site `:655-657`).
   - Import `supportsReasoningEffort` from `$lib/ai/sdk-factory` and
     `getActiveSdkProvider`, `type ProviderConfig` from `$lib/ai/client`.

**Tests** (`pnpm test`)
- `src/lib/ai/sdk-factory.test.ts` (create if absent): `supportsReasoningEffort`
  → `'glm-5.2'` true · `'glm-5.2[1m]'` true · `'gpt-4o'` false · `'glm-5.1'`
  false · `undefined` false.
- Composer conditional: out of scope (presentational).

**Manual gate:** GLM-5.2 active → all 3 states, `deep` shows dot + "more
reasoning tokens" (regression). OpenAI / OpenRouter / Z.AI 5.1 active → `deep`
shows **no dot**, tooltip "Thinking: on (deep not supported by this model)".
Anthropic / Gemini → unchanged (they honor deep).

---

## UJ3 — Provider/model chip in composer row  *(reuse UJ2's resolution)*

**Mechanism (decided):** an always-visible chip in the composer row of
`chat/[id]/+page.svelte`, format `<provider> · <model>` (decision E — see
Sign-off). Per-message label **deferred to P1b**. Do **not** stamp `chat.provider`
at create time (it would lie on provider switch); instead remove the dead
chat-list render.

**Tasks**
1. `src/lib/components/chat/Composer.svelte`
   - Add props `providerName?: string` and `modelId?: string` (decision: inline
     props, not a snippet — single `<span>`).
   - Render a chip at the start of the composer row (left of the textarea,
     `:85`), only when both are present:
     `<span class="text-xs text-muted-foreground">{providerName} · {modelId}</span>`.
2. `src/routes/chat/[id]/+page.svelte`
   - Add `let activeProviderName = $state<string | undefined>(undefined)`.
   - In the same on-mount try/catch from UJ2, set it from `config.name`
     (`ProviderConfig.name` is a required string, `types.ts:67`).
   - Pass `providerName={activeProviderName}` `modelId={activeModelId}` to
     `<Composer>`.
3. `src/routes/chat/+page.svelte` — remove the dead `{#if chat.provider}` block
   (`:134-136`). `chat.provider` is never set by `createAndNavigate`
   (`chat.svelte.ts:147-153`), so the block never fires; the chip now lives in
   the composer row.

**Tests:** none automated (presentational); provider resolution exercised by the
send path.

**Manual gate:** `/chat/[id]` composer row shows e.g. `Z.AI · glm-5.2`. Switch
active provider in `/settings` → return → chip updates. OpenAI / Anthropic /
Gemini / Ollama all show a sensible chip. Chat list no longer has a dead provider
line.

---

## UJ1 — Home page + first-run provider gate  *(largest; do last)*

**Mechanism (decided):** `/` becomes a real home. Empty-state branches on
**`listProviders()`** (correction #1): if empty → single "Add a provider to
start" card → `/settings` (the B1 gate). The P0 scaffolding text is deleted.

**Tasks**
1. `src/lib/utils/time.ts` **(new)** — extract `timeAgo` verbatim from
   `chat/+page.svelte:80-89`:
   ```ts
   export function timeAgo(ts: number): string {
     const diff = Date.now() - ts;
     const mins = Math.floor(diff / 60000);
     if (mins < 1) return 'just now';
     if (mins < 60) return `${mins}m ago`;
     const hrs = Math.floor(mins / 60);
     if (hrs < 24) return `${hrs}h ago`;
     const days = Math.floor(hrs / 24);
     return `${days}d ago`;
   }
   ```
2. `src/routes/chat/+page.svelte` — delete the inline `timeAgo` (`:80-89`) and
   `import { timeAgo } from '$lib/utils/time'`.
3. `src/routes/+page.svelte` — rewrite the whole 22-line file:
   - `<script>`: `onMount` loads in parallel:
     - `listProviders()` from `$lib/ai/client` (correction #1) → the gate.
     - `repos.chats.listRoots()` (`chats.ts:121`, newest-first) → `.slice(0, 5)`.
     - `repos.labs.listAll()` (`labs.ts:69`) → in-progress filter (see note).
     - `repos.quizzes.listAll()` (`quizzes.ts:47`) → `.slice(0, 3)`.
   - **In-progress labs note:** `Lab.checklist` is a raw JSON string of
     `LabChecklistItem[]` (`{id,text,done}`), not a boolean. "In-progress" =
     parses to an array containing any item with `done === false`; take top 3.
     Use the existing `LabChecklistItem` type (`$lib/db`, re-exported at
     `db/index.ts:34`). Guard the `JSON.parse` (labs with empty/invalid
     checklist are not "in-progress").
   - Render order:
     1. `providers.length === 0` → **first-run card**: "Add a provider to start"
        + one `Button` → `goto('/settings')`. Nothing else. (B1 fix.)
     2. else `chats.length === 0 && inProgressLabs.length === 0 &&
        quizzes.length === 0` → **genuine empty-state**: "Start your first chat"
        CTA → `goto('/chat')`. No "P0 foundation" text.
     3. else → **real home**: "New chat" CTA; "Recent chats" (top 5 →
        `/chat/[id]`); "In-progress labs" (top 3 → `/lab/[id]`); "Recent
        quizzes" (top 3 → `/quiz/[id]`). Use `timeAgo` for timestamps.
   - Delete the "P0 foundation is live…" block (`:16-21`).
4. `src/routes/chat/+page.svelte` — B1 half: when `listProviders()` is empty,
   the chat-list empty-state (`:117-121`) replaces *"Click 'New chat' to
   begin"* with *"Add a provider first"* + an "Open Settings" button →
   `goto('/settings')`. (Load `listProviders()` in that page's `onMount` too.)

**Decision surfaced — the gate reads providers, not keys** (carried from design
doc A): `listProviders()` returns config rows only (name/baseUrl/defaultModel);
it never tells you whether a key exists (keys live in the keychain/IndexedDB,
never echoed into the DB). So the gate is "≥1 provider configured." A keyless
provider passes the gate and surfaces the existing send-time `MissingKeyError`
card (`chat/[id]/+page.svelte:589-601`) — that trap is unchanged and correct.

**Tests** (`pnpm test`)
- `src/lib/utils/time.test.ts`: boundaries — just now, 5m, 3h, 2d.
- Provider gate contract: `listProviders()` returns `[]` on an empty DB and the
  configured rows after inserts (extend an existing client/settings test; this
  replaces the design doc's `repos.providers.list()` target which doesn't exist).

**Manual gate:** fresh DB → `/` shows **only** the "Add a provider" card → click
→ `/settings`. `/chat` empty-state says "Add a provider first" + "Open
Settings". After adding one provider (no key) → `/` shows "Start your first
chat". With data → "New chat" + recent chats/labs/quizzes, each navigable. No
"P0 foundation" text anywhere; "Home" in the sidebar (`AppShell.svelte:28`)
lands here.

---

## Sign-off (one open item)

- **E — chip format:** `<provider> · <model>` (recommended; matches the audit
  and the existing `·` separator used elsewhere in the UI). Alternatives:
  `<provider>:<model>` · provider-only. **Recommendation: accept `<provider> · <model>`.**

(The phase split — UJ1–UJ4 here, P1s in `user-journey-p1a.md` / `-p1b.md`, P2s
in `-p2.md` — is already confirmed by those files existing.)

---

## Verification gates (per phase)

| Phase | Automated (`pnpm test`, in-memory) | Manual (OPFS + Tauri) |
|-------|------------------------------------|------------------------|
| UJ4 | n/a (presentational) | lab-gen disables quiz btn + spinner; symmetric |
| UJ2 | `supportsReasoningEffort` × {glm-5.2, glm-5.2[1m], gpt-4o, glm-5.1, undefined} | GLM-5.2 dot+label; OpenAI honest label no dot; Anthropic/Gemini unchanged |
| UJ3 | n/a (presentational) | chip `<provider> · <model>`; updates on switch; chat-list dead line gone |
| UJ1 | `timeAgo` boundaries; `listProviders()` empty/populated | fresh-DB provider gate; empty-state; real home w/ data; no "P0 foundation" |

**Every phase:** `pnpm lint && pnpm check` clean before done.

---

## Risks / edge cases

- **UJ2/UJ3 on-mount throw:** `getActiveSdkProvider()` throws `MissingKeyError`
  when no active/keyless provider. Must try/catch (correction #2) or the chat
  page errors on mount for keyless users. Fallback: `supportsDeep = true`, chip
  hidden.
- **UJ1 in-progress parsing:** `Lab.checklist` is a JSON string; a malformed row
  must not crash the home — guard `JSON.parse`.
- **UJ1 gate vs send-time trap:** a keyless provider passes the home gate; the
  send-time `MissingKeyError` card is the intentional second gate. Documented,
  not a bug.
- **UJ4 no shared `Spinner` change:** inline lucide `LoaderCircle` avoids
  touching the shared spinner (whose fixed inner sizes would need a `size` prop
  to scale correctly).

## Verified anchors (line refs confirmed 2026-07-05)

- `Composer.svelte`: title/aria `:99-108`, dot `:112-117`, props `:16-26`,
  composer row `:85`.
- `sdk-factory.ts:67-69` `supportsReasoningEffort` (module-private → export).
- `chat/+page.svelte`: `timeAgo :80-89`, empty-state `:117-121`, dead provider
  `:134-136`.
- `chat/[id]/+page.svelte`: desktop rail `:667-681` (gen at `:677`), mobile
  `:690-702` (gen at `:700`), Composer call `:655-657`, error card `:589-601`.
- `ChatRail.svelte`: `generating` prop `:17/:30`, labs btn `:111-123`, quizzes
  `:148-160`.
- `Spinner.svelte`: `variant`/`class` only — no `size`.
- `$lib/ai/client.ts`: `listProviders :24`, `getActiveSdkProvider :88`
  (throws `:90-102`).
- Repos: `chats.listRoots chats.ts:121` (newest-first), `labs.listAll labs.ts:69`,
  `quizzes.listAll quizzes.ts:47`; `ProviderConfig` `types.ts:64-85`
  (`name :67`, `defaultModel :69` both required strings).
