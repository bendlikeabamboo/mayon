# Plan — User-journey Wave 3 (P2 polish: UJ21–UJ29)

Execution plan for `refinement/user-journey-p2.md`. The design doc is
authoritative for **product decisions and task scope**; **this file is
authoritative for mechanism** — every `file:line` below was verified against the
live code on **2026-07-06**, and the spots where the code disagrees with the
design doc (or where line numbers have drifted since the doc was written) are
corrected in **Verification corrections** below.

Nine phases, of which **six are code** (UJ21, UJ23, UJ24, UJ25, UJ26, UJ27) and
**three are no-ops** recorded only to close the loop (UJ22 declined by the
owner; UJ28 forwarded to `ui-ux-phased.md` UX3; UJ29 forwarded to the P5 release
gate). Every code phase is independently shippable and small. Suggested order at
the end; any order is safe — none touch the same lines except UJ23a/UJ23b, which
are intentionally one phase (both are quiz-runner UX and should land together).

---

## Verification corrections (code-vs-doc; plan wins on mechanism)

1. **Composer has already absorbed the P0/P1a waves.** The doc's UJ24 cites
   `NEXT` at `:48`, `cycleThinking` at `:49-53`, and the Brain button at
   `:94-118`. Those are stale — the P1a wave made `prompt` `$bindable`
   (`Composer.svelte:17`) and added auto-resize, shifting everything down.
   Verified current anchors: `effort` `$state` `:36`; `NEXT` + `cycleThinking`
   `:67-72`; the Brain button `:117-145` (it already wires `supportsDeep` into
   the `title`/`aria-label` at `:126-135`, and renders the deep dot at
   `:139-144`). The `supportsDeep` prop (`:22`) is already present and passed by
   the chat page — UJ24 keeps it to drive the *Deep* item's subtitle. → UJ24
   replaces `:67-72` + `:117-145`, not `:48/49-53/94-118`.

2. **There is no `dropdown-menu` UI component yet.** `src/lib/components/ui/`
   contains only `button`, `dialog`, `sheet`. However **`bits-ui` ^2.18.1 is
   already a dependency**, so the shadcn `DropdownMenu` primitive the doc wants
   can be added without a new top-level dep. → UJ24 adds the `dropdown-menu`
   component (bits-ui, `side="top"`) as its first task; see the **Sign-off** item
   for the hand-rolled fallback if the shadcn add is unavailable in the sandbox.

3. **Tools live in three files, not `src/lib/agent/tools/`.** The real registry
   is `src/lib/agent/registry.ts` (+ `deterministic-tools.ts`,
   `generative-tools.ts`). Verified tool ids (11 total):
   `read_checklist`, `list_artifacts`, `read_artifact`, `summarize_progress`
   (readonly, in `registry.ts`); `branch_chat`, `save_brief`,
   `draft_lab_skeleton`, `draft_quiz_outline`, `toggle_checklist_item` (in
   `deterministic-tools.ts`); `create_quiz`, `create_lab` (in
   `generative-tools.ts`). **There is no `create_cross_link` tool** (the doc
   guessed one). → UJ25's `tool-summary.ts` registry is seeded from these 11 real
   ids; the doc's `create_cross_link` formatter is dropped.

4. **`PublicApprovalEntry` already carries `toolName`.** `ApprovalEntry`
   (`chat.svelte.ts:44-50`) has `toolCallId`, `toolName`, `description`, `args`,
   `resolve`; `PublicApprovalEntry` (`:52`) is `Omit<…, 'resolve'>`. → UJ25 needs
   **no type change** — `entry.toolName` is directly available on the card.

5. **LabRunner model line is at `:48-50`, not `:47-51`.** Off-by-one in the doc;
   the structure (`{#if lab.model}<p class="text-xs text-muted-foreground">…`)
   is exactly as described. QuizRunner's line at `:48-50` matches the doc.

6. **`app.css` is Tailwind v4 CSS-first with no component classes** (`@import
   "tailwindcss"`, no `.something { }` chip rules — chips elsewhere are inline
   utility classes). → UJ23b's rail uses **inline Tailwind utilities**, not the
   doc's `.quiz-nav-chip` custom CSS class. (Adjusts the doc's snippet; the
   behavior is identical.)

7. **QuizRunner renders the question list twice.** The active-attempt `<ol>` is
   `:76-109` (the `{:else if !quizzesStore.allAnswered}` branch); a second
   all-answered/review `<ol>` is `:114-137`. The numbered rail belongs **only**
   above the active `<ol>` — review mode is already locked per-question
   (`readonly={true}` at `:122`), so a nav rail adds nothing there. The
   `id="quiz-q-{q.id}"` anchors go on the active `<li>` at `:79`.

8. **The search route has no initial data load.** `search/+page.svelte:96`
   `onMount` runs an empty query (data is input-driven via the `run()` handler at
   `:48`). → UJ26 **excludes `/search`**: migrating it to `+page.ts load` yields
   no chunking/prefetch win (there is nothing to prefetch). The doc over-listed
   it. UJ26 covers chat-list, lab-list, quiz-list, and the chat-detail
   chunk-enabler only.

9. **No `+page.ts` exists anywhere yet** (only `src/routes/+layout.ts`, which
   sets `ssr = false; prerender = false`). UJ26 adds the first `+page.ts` files;
   they stay client-side (the SPA `ssr=false` already covers them, so no per-file
   `ssr=false` is needed).

All other `file:line` citations in the design doc verified accurate (see
**Verified anchors** at the end).

---

## UJ21 — "Generated by `<model>`" attribution *(do first: two strings)*

**Root cause (verified):** `LabRunner.svelte:48-50` and `QuizRunner.svelte:48-50`
render the raw model id (`{lab.model}` / `{quizzesStore.current.model}`) as bare
muted text with no framing — reads as a debug token. The stored value is
`config.defaultModel` at generation time (`generative-tools.ts:44`, `:97`).

**Tasks**
1. `src/lib/components/labs/LabRunner.svelte` (`:48-50`):
   ```svelte
   {#if lab.model}
     <p class="text-xs text-muted-foreground">Generated by {lab.model}</p>
   {/if}
   ```
2. `src/lib/components/quizzes/QuizRunner.svelte` (`:48-50`):
   ```svelte
   {#if quizzesStore.current.model}
     <p class="text-xs text-muted-foreground">Generated by {quizzesStore.current.model}</p>
   {/if}
   ```
   (Symmetric. Keep it text, not a heavy chip — the header is already compact;
   visually it pairs with the chat composer's `{providerName} · {modelId}` chip
   at `Composer.svelte:105-107`.)

**Tests:** none automated (string change).

**Manual gate:** `/lab/[id]` and `/quiz/[id]` — the model line reads "Generated
by glm-5.2" (or whichever model produced the artifact), no longer a bare token.

### UJ21 — decisions
- **RESOLVED:** "Generated by `<model>`" (option 1); do **not** reverse-resolve
  the provider name from the model id (model ids aren't unique across providers;
  the stored value is the model that actually produced the artifact).

---

## UJ22 — "New chat" inside a conversation — DECLINED (B9)

**Decision: do not implement** (owner's explicit `[!NOTE]`: keep the user
on-topic; to start fresh, navigate to `/chat`; mid-conversation, encourage
*continue* or *expound*).

- **No file changes.** The "New chat" affordance stays on `/chat/+page.svelte`
  (the list page) only.
- Recorded here so the decision isn't re-litigated.

### UJ22 — decisions
- **RESOLVED (declined):** no in-conversation "New chat".

---

## UJ23 — Two-step MCQ + numbered quiz rail *(both are quiz-runner UX; ship together)*

### UJ23a — Two-step MCQ (select → Submit)

**Root cause (verified):** `McqQuestion.svelte:31-35` `choose(i)` sets
`localPick = i` **and** immediately calls `onAnswer(i)` → a misclick persists
permanently. The optimistic highlight already keys off `localPick`
(`selected` `:29`, `optionClass` `:37-49`), and `locked` (`:24`) is true once an
`answer` row exists or in review mode — so splitting "select" from "submit" is a
pure local change.

**Tasks** — `src/lib/components/quizzes/McqQuestion.svelte`
1. `choose(i)` (`:31-35`) → set `localPick = i` only; **remove** the `onAnswer(i)`
   call:
   ```ts
   function choose(i: number) {
     if (locked) return;
     localPick = i;
   }
   ```
2. Add a Submit button after the `<ul>` (`:71`), shown only when not locked and a
   pick is pending:
   ```svelte
   {#if !locked && localPick !== null}
     <Button variant="default" size="sm" onclick={() => onAnswer(localPick!)}>
       Submit answer
     </Button>
   {/if}
   ```
   (Import `Button` from `$lib/components/ui/button/index.js`. The existing
   radio `onchange={() => choose(i)}` `:65` now just selects; `checked={i ===
   selected}` `:63` still reflects the optimistic pick.)
3. **Edge:** navigating away with a `localPick` but no submit persists nothing
   (correct — `onAnswer` is the only persist path). Review mode (`readonly` →
   `locked`) hides the button, so the all-answered `<ol>` render at
   `QuizRunner.svelte:114-137` is unaffected.

### UJ23b — Numbered question rail for longer quizzes

**Tasks** — `src/lib/components/quizzes/QuizRunner.svelte`
1. In the **active-attempt** branch (`{:else if !quizzesStore.allAnswered}`,
   `:75`), insert a numbered rail above the `<ol>` (`:76`). Inline Tailwind
   utilities (correction #6 — no custom CSS class):
   ```svelte
   {#if quizzesStore.total >= 5}
     <div class="flex flex-wrap gap-1">
       {#each quizzesStore.questions as q, ord (q.id)}
         {@const answered = !!quizzesStore.answers[q.id]}
         <button
           type="button"
           class="size-7 rounded border text-xs font-medium transition-colors {answered
             ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
             : 'border-border bg-card text-muted-foreground hover:bg-accent'}"
           title="Question {ord + 1}"
           onclick={() => document.getElementById('quiz-q-' + q.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
         >
           {ord + 1}
         </button>
       {/each}
     </div>
   {/if}
   ```
2. Add `id="quiz-q-{q.id}"` to the active-attempt `<li>` at `:79` (the jump
   target). Do **not** add ids to the review `<ol>` (`:117`) — no rail there.
3. **Threshold ≥5** (decided). `quizzesStore.total`, `.questions`, `.answers` are
   all already used in this component (`:54,76-78`).

**Tests:** none automated (DOM/scroll). The `answerMcq` store path is unchanged
— it still fires on submit, just later (UJ23a). The rail is presentational.

**Manual gate:** a 3-question quiz — no rail (below threshold); MCQ is two-step
(select → Submit; can change selection before Submit). A ≥5-question quiz —
numbered rail appears, answered chips turn emerald, click a chip → smooth-jumps
to that question. Misclick no longer locks.

### UJ23 — decisions
- **RESOLVED (UJ23a):** two-step MCQ (select → Submit); persist on submit only.
- **RESOLVED (UJ23b):** numbered rail when `total >= 5`; inline Tailwind (not a
  custom CSS class); rail only in the active-attempt branch; jump via
  `scrollIntoView`.

---

## UJ24 — Reasoning toggle as a drop-up *(Composer change; pairs with UJ2)*

**Mechanism (decided):** replace the 3-state cycle button with a button that
opens a **drop-up** menu listing Off / On / Deep explicitly, current selection
marked. The *Deep* item shows the honest subtitle "not supported by this model"
when `supportsDeep === false` (consistent with UJ2 — don't hide it, explain it).

**Task 0 — add the menu component** (correction #2). Add the shadcn-svelte
`dropdown-menu` (bits-ui is already a dep):
```bash
pnpm dlx shadcn-svelte@latest add dropdown-menu
```
→ creates `src/lib/components/ui/dropdown-menu/`. Verify the generated barrel
exports `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`,
`DropdownMenuItem`. (If the sandbox blocks the CLI, fall back to a hand-rolled
drop-up — see **Sign-off** item.)

**Tasks** — `src/lib/components/chat/Composer.svelte`
1. Imports: add the dropdown-menu barrel; drop nothing else yet.
2. Replace the `NEXT` cycle map + `cycleThinking` (`:67-72`) with a single setter:
   ```ts
   async function setEffort(next: ReasoningEffort) {
     if (streaming) return;
     effort = next;
     await repos.settings.set('reasoningEffort', effort);
   }
   ```
   (Persistence path unchanged from the current `cycleThinking`.)
3. Replace the Brain button (`:117-145`) with a `DropdownMenu` whose trigger is
   the `<Brain/>` button (current variant logic kept) and whose content opens
   `side="top"`:
   ```svelte
   <DropdownMenu>
     <DropdownMenuTrigger asChild let:builder>
       <Button {...builder.props} variant={effort === 'off' ? 'outline' : 'secondary'}
         size="icon" builder={builder.action} disabled={streaming}
         title="Thinking" aria-label="Thinking" aria-pressed={effort !== 'off'}>
         <Brain class="size-4" />
       </Button>
     </DropdownMenuTrigger>
     <DropdownMenuContent side="top" align="end" class="w-56">
       <DropdownMenuItem onSelect={() => void setEffort('off')} selected={effort === 'off'}>
         Off
       </DropdownMenuItem>
       <DropdownMenuItem onSelect={() => void setEffort('on')} selected={effort === 'on'}>
         On
       </DropdownMenuItem>
       <DropdownMenuItem onSelect={() => void setEffort('deep')} selected={effort === 'deep'}>
         <div class="flex flex-col">
           <span>Deep <span class="text-xs text-muted-foreground">(more reasoning tokens)</span></span>
           {#if !supportsDeep}
             <span class="text-xs text-amber-600 dark:text-amber-400">not supported by this model</span>
           {/if}
         </div>
       </DropdownMenuItem>
     </DropdownMenuContent>
   </DropdownMenu>
   ```
   (Exact prop spellings — `selected`, `onSelect`, `asChild`/`let:builder` — must
   match the bits-ui v2 API the generated component exposes; reconcile on read.
   The deep dot at `:139-144` is removed — the menu's marked item replaces it,
   which is the whole point: make *Deep* discoverable.)
4. The `onMount` restore (`:55-65`) and the `reasoningEffort`/legacy
   `reasoningEnabled` migration are **unchanged**.

**Tests:** none automated (menu interaction). The persistence path (`setEffort`
→ `repos.settings.set`) is unchanged.

**Manual gate:** click the Brain button in the composer → a menu drops **up**
with Off / On / Deep, current marked. Select Deep → persists; on a non-deep model
the Deep item shows "not supported by this model" but is still selectable. Reload
→ selection persists.

### UJ24 — decisions
- **RESOLVED:** drop-up menu (shadcn `dropdown-menu`, `side="top"`); Deep item
  with honest "not supported" subtitle when `!supportsDeep`; remove the cycle map
  and the deep dot.
- **OPEN (sign-off Q):** if `pnpm dlx shadcn-svelte add dropdown-menu` is
  unavailable, hand-roll a minimal `$state`-toggled drop-up with a click-outside
  handler (3 items, no keyboard trap). Prefer the bits-ui component for a11y.

---

## UJ25 — Approval cards: tool-specific summary line *(new registry + card tweak)*

**Root cause (verified):** `ApprovalCard.svelte:17` renders `entry.description`
(the tool's generic `def.description`) and `:18-20` dumps
`JSON.stringify(entry.args, null, 2)` as a `<pre>` — developer-facing for
anything non-trivial. `entry.toolName` is available (correction #4).

**Tasks**
1. `src/lib/agent/tool-summary.ts` **(new)** — pure, testable registry seeded
   from the real tool ids (correction #3):
   ```ts
   type Args = Record<string, unknown>;
   const FORMATTERS: Record<string, (a: Args) => string> = {
     create_quiz: (a) => `Create a quiz on: ${a.topic ?? 'this chat'}`,
     create_lab: (a) => `Create a lab on: ${a.topic ?? 'this chat'}`,
     branch_chat: (a) => (a.topic ? `Branch this conversation (${a.topic})` : 'Branch this conversation'),
     save_brief: (a) => `Set learning goal: ${a.goal ?? '(unspecified)'}`,
     draft_lab_skeleton: (a) => `Draft a lab outline: ${a.topic ?? 'this chat'}`,
     draft_quiz_outline: (a) => `Draft a quiz outline: ${a.topic ?? 'this chat'}`,
     toggle_checklist_item: () => 'Toggle a checklist step',
     read_checklist: () => 'Read the lab checklist',
     list_artifacts: () => 'List labs and quizzes',
     read_artifact: (a) => `Read a ${a.kind ?? 'artifact'}`,
     summarize_progress: () => 'Summarize progress'
   };
   /** Human-readable headline for a tool call, or null to fall back to the description. */
   export function summarizeToolCall(toolName: string, args: unknown): string | null {
     const fn = FORMATTERS[toolName];
     if (!fn) return null;
     try {
       return fn((args ?? {}) as Args);
     } catch {
       return null; // malformed args → fall back, never throw in the card
     }
   }
   ```
2. `src/lib/components/chat/ApprovalCard.svelte`
   - Import: `import { summarizeToolCall } from '$lib/agent/tool-summary';`
   - Derive: `const summary = $derived(summarizeToolCall(entry.toolName, entry.args));`
   - Render the summary as the headline above the description when present, and
     demote the raw JSON into a collapsible `<details>` (don't remove it — power
     users / debugging want it). Replace the `<p>` + `<pre>` block (`:17-20`):
     ```svelte
     {#if summary}
       <p class="font-medium">{summary}</p>
       <p class="mt-0.5 text-xs text-muted-foreground">{entry.description}</p>
     {:else}
       <p class="font-medium">{entry.description}</p>
     {/if}
     {#if argsJson !== 'undefined' && argsJson !== 'null'}
       <details class="mt-2">
         <summary class="cursor-pointer text-xs text-muted-foreground">Raw arguments</summary>
         <pre class="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">{argsJson}</pre>
       </details>
     {/if}
     ```

**Tests** (`pnpm test`, colocation `src/lib/agent/tool-summary.test.ts`)
- Each of the 11 known ids → expected string (with/without the optional field
  where relevant, e.g. `create_quiz` with and without `topic`).
- Unknown tool name → `null`.
- Malformed args (e.g. `args = null`, `args = 42`, an arg field that's not a
  string where interpolation expects one) → never throws; returns `null` or the
  defensive fallback.

**Manual gate:** trigger an approval (e.g. ask for a quiz) → the card headline
reads "Create a quiz on: <topic>"; the raw JSON is collapsed under "Raw
arguments". An unknown/future tool → falls back to the description headline.

### UJ25 — decisions
- **RESOLVED:** new `tool-summary.ts` registry seeded from the 11 real tool ids
  (no `create_cross_link`); summary headline + `entry.description` subtitle +
  collapsible raw JSON; unknown → `null` (fall back to description); pure
  formatters are defensive (never throw).

---

## UJ26 — Route-level code splitting *(P2; light touch)*

**Mechanism (decided):** add thin client-side `+page.ts` `load` functions so
SvelteKit code-splits per route and can prefetch on hover. The app is a static
SPA (`+layout.ts` already sets `ssr=false`), so `load` runs client-side only —
the win is chunking + prefetch, not server rendering. Light touch (P2):
prioritize the list routes; keep store-dependent detail loads in-component
(correction #8 — exclude `/search`).

**Tasks**
1. `src/routes/chat/+page.ts` **(new)** — migrate the list fetch currently in
   `onMount` (`chat/+page.svelte:24-29`):
   ```ts
   import { listRootChats } from '$lib/stores/chat.svelte';
   import { listProviders } from '$lib/ai/client';
   export async function load() {
     const [roots, providers] = await Promise.all([listRootChats(), listProviders()]);
     return { roots, hasProviders: providers.length > 0 };
   }
   ```
   - `chat/+page.svelte`: replace `onMount` (`:24-29`) with `let { data } = $props();`
     and derive `roots = $state(data.roots)` / `hasProviders = data.hasProviders`.
     (The `roots` array stays mutable — `deleteChat` reassigns it at `:79`.)
2. `src/routes/lab/+page.ts` **(new)** — thin enabler (the list lives in
   `labsStore`; move the initial `labsStore.loadList()` trigger here):
   ```ts
   import { labsStore } from '$lib/stores/labs.svelte';
   export async function load() {
     await labsStore.loadList();
     return {};
   }
   ```
   - `lab/+page.svelte`: drop the `labsStore.loadList()` from `onMount`
     (`:25-28`), keep `regroup()` in `onMount` (it reads the now-populated store).
3. `src/routes/quiz/+page.ts` **(new)** — same pattern as lab (thin enabler; move
     the initial `quizzesStore.loadList()` here, keep grouping in the page).
     Verify the quiz list page's `onMount` first; if it uses a store `loadList`
     like lab, mirror task 2; otherwise just add an empty `load()` to enable the
     route chunk.
4. `src/routes/chat/[id]/+page.ts` **(new)** — chunk-enabler only:
   ```ts
   export function load({ params }) {
     return { chatId: params.id };
   }
   ```
   The heavy `chatStore.load` + nav load **stays in the component** (it depends
   on the store singleton and runs on every chat switch, not just first paint).
   This `+page.ts` exists purely so the chat-detail route (the markdown/KaTeX/
   mermaid stack) chunks separately from the initial bundle.

**Tests:** none automated (build output). Verify chunking via `pnpm build` +
inspecting `build/` for per-route chunks.

**Manual gate:** `pnpm build` → the initial bundle no longer carries every route
(verify chunk sizes; the chat-detail chunk should separate from `/`). `pnpm dev`
→ hover a sidebar link → the route prefetches (Network tab). First-paint on `/`
is no worse (ideally better) than before. List routes still render their data.

### UJ26 — decisions
- **RESOLVED:** thin client-side `+page.ts` loads for route chunking + prefetch
  (SPA, no SSR — `+layout.ts` covers it). Migrate the chat-list fetch to `load`;
  move lab/quiz initial `loadList` into `load`; chat-detail gets a chunk-enabler
  `+page.ts` only (store load stays in-component). **Exclude `/search`** (no
  initial load; query-driven).

---

## UJ27 — Self-check amber label contradiction *(one dev-only conditional)*

**Root cause (verified):** `DbStatus.svelte:22-27` already turns the badge amber
when `status === 'ready' && selfCheck === 'fail'`, but `statusLabel` (`:9-15`)
still reads "DB ready" in that case — text contradicts color. Self-check only
runs when `import.meta.env.DEV`, so this is dev-only.

**Tasks** — `src/lib/components/DbStatus.svelte`
- Extend the `ready` branch of `statusLabel` (`:9-15`):
  ```ts
  const statusLabel = $derived(
    dbStatus.status === 'initializing'
      ? 'DB…'
      : dbStatus.status === 'ready'
        ? import.meta.env.DEV && dbStatus.selfCheck === 'fail'
          ? 'DB ready (self-check failed)'
          : 'DB ready'
        : 'DB error'
  );
  ```

**Tests:** none automated (trivial conditional; the DEV branch is stripped in
production builds).

**Manual gate:** `pnpm dev` with a forced self-check failure → badge is amber and
reads "DB ready (self-check failed)". `pnpm build && pnpm preview` → label is
just "DB ready" regardless (the `import.meta.env.DEV` branch is stripped).

### UJ27 — decisions
- **RESOLVED:** dev-only "DB ready (self-check failed)" label; production
  unaffected.

---

## UJ28 — Snapshot/restore seam asymmetry — NO-OP here (D3)

**Decision: no code change in this wave.** The audit explicitly forwards this to
the `ui-ux-phased.md` UX3 owner (the desktop `DataSection` already routes through
separate Rust `backup.rs` commands — functionally correct, just an asymmetric
seam). `ui-ux-phased.md` UX3 already specifies making the Tauri driver implement
the byte-based `snapshot()`/`restore(bytes)` seam by delegating to a Rust temp
path, for symmetry.

- **No file changes.** Forward-pointer only: verify seam symmetry when UX3 lands.

### UJ28 — decisions
- **RESOLVED (no-op here):** owned by `ui-ux-phased.md` UX3; this wave records
  the pointer only.

---

## UJ29 — Updater endpoint placeholder — NO-OP here (D4)

**Decision: no code change in this wave.** This is a P5 release-prep blocker:
`tauri.conf.json` `endpoints` points at a placeholder owner/repo, so
`updater.check()` will 404 until configured. It surfaces only when cutting a
desktop release, which is already tracked in `AGENTS.md`'s P5 acceptance section.

- **No file changes.** When the real GitHub repo exists, update
  `tauri.conf.json` `endpoints` to the real `latest.json`. The
  `TAURI_SIGNING_PRIVATE_KEY` env-only secret (required for signed releases) is
  already documented in `AGENTS.md`.

### UJ29 — decisions
- **RESOLVED (no-op here):** release-prep task owned by P5; no code change in
  this wave.

---

## Sign-off

- **Q — UJ24 menu component:** prefer the shadcn `dropdown-menu` (bits-ui is
  already a dep; gives keyboard a11y). **Fallback:** if `pnpm dlx
  shadcn-svelte@latest add dropdown-menu` is unavailable in the environment,
  hand-roll a minimal `$state`-toggled drop-up with a click-outside handler (3
  items). Recommend the bits-ui component; confirm on implementation.

(All other phases follow the owner's stated preferences or the audit's
recommendations directly — no further blocking sign-off.)

---

## Verification gates (per phase)

| Phase | Automated (`pnpm test`, in-memory) | Manual (OPFS + Tauri) |
|-------|------------------------------------|------------------------|
| UJ21 | n/a (string) | lab/quiz model line reads "Generated by <model>" |
| UJ22 | n/a (declined) | n/a |
| UJ23 | n/a (DOM/scroll) | two-step MCQ; numbered rail for ≥5-question quizzes; jump-to-question |
| UJ24 | n/a (menu) | Brain button → drop-up menu; Deep item honest subtitle; persists on reload |
| UJ25 | `summarizeToolCall` × 11 ids + unknown + malformed args | approval card headline + collapsible raw JSON; unknown tool falls back |
| UJ26 | n/a (build output) | per-route chunks; hover prefetch; first-paint no worse |
| UJ27 | n/a (trivial) | dev amber label reads "self-check failed"; prod unaffected |
| UJ28 | n/a (no-op) | n/a |
| UJ29 | n/a (no-op) | n/a (release-prep) |

**Every phase:** `pnpm lint && pnpm check` clean before done.

---

## Suggested order of work

1. **UJ27** (one dev-only conditional — trivial).
2. **UJ21** (two-string framing — trivial).
3. **UJ23a + UJ23b together** (quiz-runner UX; both touch QuizRunner, ship as
   one change).
4. **UJ25** (new tiny `tool-summary.ts` registry + card tweak; pure + tested).
5. **UJ24** (Composer drop-up — resolve sign-off Q first; pairs with UJ2's
   `supportsDeep`).
6. **UJ26** (route splitting — build-output win; do once the render path is
   stable).
7. **UJ22 / UJ28 / UJ29** — no work (declined / forwarded to UX3 / forwarded to
   P5).

---

## Risks / edge cases

- **UJ24 bits-ui API surface:** the generated `dropdown-menu` component's exact
  prop names (`selected` vs `active`, `onSelect` vs `onclick`, `asChild`/
  `let:builder` wiring) depend on the bits-ui v2 version. Reconcile against the
  generated files on read before finalizing the snippet. If the CLI is blocked,
  the hand-rolled fallback (sign-off Q) is a clean 3-item menu — but it loses
  keyboard arrow navigation and focus-trap; acceptable for P2 polish.
- **UJ23a half-answer on navigate:** `localPick` is component-local and never
  persisted until Submit, so leaving a question mid-pick loses nothing (correct).
  But a user who picks then submits, then navigates back via the rail (UJ23b),
  sees the stored `answer` (locked) — `localPick` resets because the component is
  re-keyed by `q.id` (`:77`). Verify no stale `localPick` lingers across the
  re-render.
- **UJ23b scroll-vs-render:** `scrollIntoView` targets `#quiz-q-{q.id}` on the
  active `<li>` only (`:79`); if a future change renders the rail in the review
  branch too, add matching ids there. The rail is hidden below `total >= 5`, so
  short quizzes never call `scrollIntoView`.
- **UJ25 defensive formatters:** args come from the model's tool call and may be
  missing or mistyped (e.g. `topic` absent, or a number where a string is
  expected). Every formatter coerces with `?? '<default>'`; the top-level
  `try/catch` returns `null` so a formatter bug never crashes the approval card
  (it falls back to `entry.description`). The unit tests cover `args = null` and
  non-object args explicitly.
- **UJ26 SPA `load` semantics:** `+page.ts` `load` runs client-side (SPA). Moving
  the chat-list fetch out of `onMount` into `load` means it runs slightly earlier
  (during navigation, before the component mounts) — a prefetch win, but
  `data.roots` becomes the source of truth on first paint. The page still keeps a
  mutable `roots = $state(data.roots)` so `deleteChat` can reassign it (`:79`).
  Verify the empty/loading/`hasProviders` branches still render correctly with
  `data` instead of `onMount`-set state.
- **UJ27 dev-only string:** the `import.meta.env.DEV` branch is statically
  stripped in `pnpm build`, so the production bundle never contains the
  "self-check failed" text. Confirm with `pnpm build && grep` if paranoid.
- **UJ26 / UJ21 line drift:** both cite lines that will shift as earlier phases
  land in the same wave. UJ23 (QuizRunner) lands before UJ21's reading of
  QuizRunner `:48-50` only if implemented in the suggested order; if order
  changes, re-verify the model-line anchor before editing.

---

## Verified anchors (line refs confirmed 2026-07-06)

- `LabRunner.svelte`: import `:2`, model line `:48-50`, diag panel call `:91`.
- `QuizRunner.svelte`: import `:2`, model line `:48-50`, active-attempt `<ol>`
  `:76-109` (`<li>` `:79`, `id` target goes here), review `<ol>` `:114-137`
  (`readonly` McqQuestion `:122`), diag panel call `:151`. Store getters used:
  `total`/`questions`/`answers` (`:54,76-78`), `allAnswered` (`:75`),
  `activeAttempt` (`:52`).
- `McqQuestion.svelte`: props `:11-21`, `locked` `:24`, `localPick` `:28`,
  `selected` `:29`, `choose` `:31-35`, `optionClass` `:37-49`, radio `:58-66`
  (`onchange` `:65`, `checked` `:63`), `<ul>` end `:71`.
- `Composer.svelte`: props `:16-34` (`prompt` `$bindable` `:17`, `supportsDeep`
  `:22`), `effort` `:36`, auto-resize `$effect` `:39-49`, `onMount` restore
  `:55-65`, `NEXT` + `cycleThinking` `:67-72`, Brain button `:117-145`
  (`supportsDeep` in title/aria `:126-135`, deep dot `:139-144`), provider chip
  `:105-107`, Stop/Send `:147-161`.
- `ApprovalCard.svelte`: props `:5-11`, `argsJson` `:13`, description `<p>` `:17`,
  raw JSON `<pre>` `:18-20`.
- `chat.svelte.ts`: `ApprovalEntry` `:44-50` (`toolName` `:46`, `description`
  `:47`, `args` `:48`), `PublicApprovalEntry` `:52`.
- `registry.ts` (readonly tools): `read_checklist` `:79`, `list_artifacts` `:106`,
  `read_artifact` `:137`, `summarize_progress` `:184`; register loop `:233-234`.
- `deterministic-tools.ts`: `branch_chat` `:15`, `save_brief` `:47`,
  `draft_lab_skeleton` `:91`, `draft_quiz_outline` `:135`,
  `toggle_checklist_item` `:173`.
- `generative-tools.ts`: `create_quiz` `:18` (saves `config.defaultModel` `:44`),
  `create_lab` `:72` (saves model `:97`).
- `DbStatus.svelte`: `statusLabel` `:9-15`, amber color branch `:22-27`,
  `error` block `:33-44`, badge render `:45-57`.
- Routes: `+layout.ts` `ssr=false; prerender=false` (`:3-4`); `chat/+page.svelte`
  `onMount` fetch `:24-29`, `roots` reassign on delete `:79`, pagination `:62-63`;
  `lab/+page.svelte` `onMount` `:25-28` (`labsStore.loadList` `:26`), `regroup`
  `:41-58`; `chat/[id]/+page.svelte` (store-dependent load stays in-component);
  `search/+page.svelte` `onMount` `:96` (empty/query-driven — **excluded**).
- UI components present: `src/lib/components/ui/{button,dialog,sheet}` only —
  **no `dropdown-menu`** (UJ24 adds it; `bits-ui` ^2.18.1 is a dep).
- Test config: `vite.config.ts` `test.include = ['src/**/*.{test,spec}.{js,ts}']`,
  `environment: 'node'` — tests are colocated (`src/lib/agent/*.test.ts`).
- `src/app.css`: Tailwind v4 CSS-first (`@import "tailwindcss"`), no component
  classes → inline utilities are the convention (UJ23b).
