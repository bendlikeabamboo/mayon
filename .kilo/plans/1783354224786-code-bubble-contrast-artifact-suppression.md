# Plan: User-bubble code contrast + artifact-duplication suppression

Two independent UX bugs, shipped as two phases (A = pure CSS, zero agent risk; B =
agent/loop behavior fix). Phase A is the fast visible win; Phase B is the correctness fix.

---

## Context (what's actually broken, grounded in code)

### Note #1 — unreadable code inside the user chat bubble
The user bubble is **theme-inverted**: in dark mode `dark:bg-primary` (near-white, `oklch(0.922)`)
+ `dark:text-primary-foreground` (near-black); in light mode `bg-[var(--highlight)]` (#a54d27 orange)
+ `text-white` (`MessageRow.svelte:44`). So everything inside it should follow the *bubble's*
luminance, which is the inverse of the app.

But the markdown code styles are app-themed, not bubble-aware:
- Inline + plain fenced code bg = `var(--muted)`, text color **inherited** (no color rule) —
  `Markdown.svelte:194-215`. Inverted inherited text on a same-app-theme bg = low contrast in
  **both** modes (white-on-light in light; black-on-dark in dark).
- Highlighted blocks (`.hljs`) get a hardcoded dark island in dark mode: `.dark .hljs { background:
  #0d1117; color:#c9d1d9 }` (`app.css:158`). Light token colors globally come from the imported
  `highlight.js/styles/github.min.css` (`app.css:3`); the `.dark .hljs*` block (`app.css:158-199`)
  overrides them for dark mode. None of this flips inside the inverted bubble.

> Correction to the original report: the highlighter is **highlight.js** via `rehype-highlight`
> (`render.ts:71`), not Shiki. Fix targets `.hljs` classes, not shiki.

### Note #2 — model reproduces the quiz inside the chat after calling the tool
Root causes (both real):
1. The model emits a tool-call **and** the artifact text in the same turn. The text streams live
   into `buf` and is persisted as an assistant message **before** the tool runs
   (`loop.ts:326-329`).
2. The tool contract never tells the model *not* to duplicate artifact content nor to acknowledge
   via a link. The capabilities preamble (`brief.ts:243 buildCapabilitiesPreamble`) only says "ask
   before creating; at most one artifact per turn."

The model **is** already informed of success: `create_quiz`/`create_lab` return
`{ ok, summary, detail:{ artifact:{ kind, id } } }` (`generative-tools.ts:56,99`), and that flows
back as a `tool-result` part (`context.ts:79-81`, `toCoreMessages:191-202`). The fix is to make the
result instructive AND to deterministically kill the streamed duplicate.

---

## Decisions (locked)

- **Note #1**: container-class approach on the user bubble; token colors as CSS custom properties
  on `:root`/`.dark`, flipped via `.bubble-user` / `.dark .bubble-user` overrides; code background =
  `color-mix(in oklch, var(--bubble-bg), black 7%)` so it's "slightly darker than the bubble bg" in
  both modes. User bubble only (the `tool` bubble is `bg-muted/50`, not inverted — leave it). Add a
  reusable `.markdown-invert` class.
- **Note #2**: (a) enrich tool result summaries with the route + a "do not reproduce" instruction;
  (b) prompt engineering in the preamble + each artifact tool's `description`; (c) **deterministic
  suppression** — when a `generative: true` tool is among the turn's tool calls, do NOT persist `buf`
  and clear the live stream buffer; (d) drive the suppression predicate off the existing
  `generative` flag (create_quiz / create_lab only — NOT branch_chat / cross-link; those get prompt
  guidance only).
- **Suppressed-text UX** (user-chosen): show a transient **"Creating your quiz…" chip** while the
  generative tool runs, then the model's fresh acknowledgment (with link) replaces it in the next
  loop iteration. The loop already continues for a fresh turn after tool results, so the
  acknowledgment is the model's natural next turn — this IS the two-step flow.

---

## Phase A — Bubble-inverted code theme (CSS only)

### A1. `src/app.css` — introduce token + bubble vars
- On `:root`: add `--hljs-bg`, `--hljs-fg`, and `--hljs-<token>` vars with the **light** (GitHub-light)
  palette. Add `--bubble-bg`, `--bubble-fg`.
- On `.dark`: override the same vars with the **dark** palette (lift the current hardcoded values
  from the `app.css:158-199` block into these vars).
- Refactor the existing `.dark .hljs` / `.dark .hljs-*` block to **consume the vars** instead of
  hardcoding hexes (behavior-preserving for the app surface).

### A2. `src/app.css` — bubble inversion overrides
- `.bubble-user { /* DARK palette vars */ }` — overrides `:root` so a light-app user bubble (orange)
  gets dark-themed code.
- `.dark .bubble-user { /* LIGHT palette vars */ }` — overrides `.dark` so a dark-app user bubble
  (white) gets light-themed code.
  (Specificity: `.dark .bubble-user .hljs-keyword` (0,3,0) beats both `.hljs-keyword` (0,1,0) from
  the imported sheet and `.dark .hljs-keyword` (0,2,0). Verified cooperative.)
- Add `.markdown-invert` rules: `pre` and `:not(pre) > code` use
  `background: color-mix(in oklch, var(--bubble-bg), black 7%)` and `color: var(--bubble-fg)`; the
  `.hljs` bg uses the same mix. These win by specificity over `.markdown-body pre` /
  `.markdown-body :not(pre) > code` when the `.markdown-invert` class is on the bubble.

### A3. `src/lib/components/chat/MessageRow.svelte` — apply the class to the user bubble only
- On the user bubble div (`:111-118`), add classes `markdown-invert bubble-user` and inline
  `style="--bubble-bg: var(--highlight); --bubble-fg: #fff;"`. Add the `.dark` equivalent: in dark
  mode `--bubble-bg: var(--primary); --bubble-fg: var(--primary-foreground);` (set both via a single
  inline style that references the theme vars — `var()` resolves per-mode automatically, so one
  inline declaration using `var(--highlight)` / the dark override may need two values; simplest:
  set `--bubble-bg: var(--highlight)` here and redefine it under `.dark .bubble-user` in CSS to
  `var(--primary)` so only ONE inline style is needed).

### A4. Manual gate (Note #1)
- `pnpm dev` → in **both** light and dark themes: send a user message containing inline `` `code` ``,
  a plain ```` ``` ```` block, a ```` ```ts ```` highlighted block, and a ```` ```txt ```` block.
  Confirm all four are readable inside the user bubble (contrast good, bg = slightly darker than the
  bubble) and that the **assistant** and **tool** bubbles are unchanged. Toggle theme and re-check.

---

## Phase B — Kill duplicate artifact content (agent/loop)

### B1. `src/lib/agent/generative-tools.ts` — instructive result summaries
- `create_quiz`: change the success `summary` to include the route and a "do not reproduce" cue, e.g.
  ``Created quiz "<topic>" (<n> questions). Saved and ready to run at /quiz/<id>. Do not reproduce its questions in chat — the artifact owns them.``
  Keep `detail: { artifact: { kind:'quiz', id } }` unchanged. Do the same for `create_lab` with
  `/lab/<id>`.

### B2. `src/lib/chat/brief.ts` (`buildCapabilitiesPreamble`) + tool `description`s — the contract
- Add to the preamble: "The create_quiz / create_lab tools create and persist the artifact
  themselves and return a link. When you call one, emit NONE of its content as chat text. After it
  succeeds, acknowledge in 1–2 sentences and point the learner to the link."
- Add a one-line contract to each of `create_quiz` / `create_lab` / `branch_chat` `description`
  fields (registry entries) reinforcing "do not reproduce artifact content inline; the tool owns it."

### B3. `src/lib/agent/loop.ts` — deterministic suppression + chip signaling
- After `toolCalls` are collected (around `:331`), compute
  `hasGenerative = toolCalls.some(tc => getToolDefinition(tc.toolName)?.generative)`.
- **If `hasGenerative`**: do NOT run the existing `if (buf) { appendAssistantText(buf) }` block
  (`:326-329`); instead call `deps.updateStreamBuffer('')` to hide the streamed duplicate. (The
  bookkeeping `appendAssistantToolCall` rows at `:331-337` still run — they're empty/hidden per
  `MessageRow.svelte:78-79`.)
- **Optional refinement** (reduce flash): in `consumeStream`'s `onToolCall` callback, if the call is
  generative, clear the buffer on the *first* generative tool-call delta rather than waiting for
  stream end.
- **Chip signaling**: add a new optional dep
  `notifyGenerativeStatus?(active: { toolName: string; label: string } | null): void`. Right before
  running an **approved** generative high call (inside the `highResults` branch, `:431`), call it
  with `{ toolName, label: 'Creating your quiz…' | 'Creating your lab…' }`; call it with `null`
  after that call's result is appended (`:459`). For declined/aborted generative calls, call `null`.
- Non-generative high calls (branch_chat) are unaffected — their `buf` persists normally (their text
  is rarely artifact content; prompt guidance covers them).

### B4. `src/lib/stores/chat.svelte.ts` — chip state + dep wiring
- Add `generativeStatus = $state<{ toolName: string; label: string } | null>(null)`.
- Implement `notifyGenerativeStatus` to set/clear it; wire it into the `AgentTurnDeps` built in
  `send` (alongside `requestApproval` / `notifyLowRisk`, `:287-288`).
- Reset `generativeStatus = null` in the same places `streamBuffer` is reset (`:130, :214, :358,
  :405`) so a stuck chip can't survive an abort/reload.

### B5. `src/routes/chat/[id]/+page.svelte` — render the chip
- In the bottom pane (near the `{#each chatStore.pendingApprovals}` block, `:706`), add a chip when
  `chatStore.generativeStatus` is set: small rounded card, `LoaderCircle` spinner + the label. It is
  non-interactive and clears itself when the loop nulls the status.

### B6. Tests (Note #2)
- `src/lib/agent/loop.test.ts`: extend the existing `create_quiz` cases (`:789, :827, :869`) to
  assert that when a generative tool call is present, the pre-tool `buf` is **not** persisted
  (`appendAssistantText` not called for it) and `updateStreamBuffer('')` was called; also assert
  `notifyGenerativeStatus` is invoked with the active label before run and `null` after. Add a
  declined-generative case asserting status is cleared to `null` and no chip label lingers.
- `src/lib/agent/generative-tools.test.ts`: assert the success `summary` contains the `/quiz/` (resp.
  `/lab/`) route fragment.
- Manual gate: in a real chat, say "let's create a quiz out of it" → expect ONLY: approval card →
  (approve) → "Creating your quiz…" chip → tool-result link → a short model acknowledgment that
  links to `/quiz/<id>` and contains **no** quiz questions inline.

---

## Risks / edge cases
- **Note #1 specificity**: if a future Tailwind utility sets an inline color on code inside the
  bubble, the `.markdown-invert` rules must keep winning. Mitigation: scope under `.bubble-user` and
  verify with the A4 manual gate.
- **Note #2 declined-after-stream**: if the user declines the quiz, the duplicate text was already
  cleared; the model then gets a fresh turn to respond to the decline. Acceptable — and the
  duplicate would have been wrong to keep anyway.
- **Note #2 no-tool-call duplication**: if the model writes a quiz in chat *without* calling the
  tool, there is no tool call to gate on, so only the prompt (B2) can discourage it. This is a
  residual, inherent limitation — noted as out of scope for a deterministic guard.
- **Stuck chip**: a throw mid-generation could leave `generativeStatus` set. B4's resets on every
  `streamBuffer` reset path mitigate; also clear in the loop's `finally`-equivalent (the existing
  abort/error returns).

## Out of scope
- Adding a `producesArtifact` flag distinct from `generative` (only revisit if branch/cross-link
  start duplicating content).
- Server-side / persistence changes (all logic stays client-side, single-threaded).
- The `tool` bubble and assistant bubble code theming (already correct).
