# Mayon — User Journey Audit

- **Date:** 2026-07-05
- **Lens:** Principal user-journey review of the **as-built** app (code, not design docs).
- **Priorities (per request):** ease-of-use · performance · **definitiveness** (being true to what the app actually is).
- **Context:** local-first, bring-your-own-key learning app. Every finding cites `file:line` and was verified against the live code.
- **Scope:** enhancement of *current* features — not new epics. Open design questions (semantic search, deeper orchestration) are out of scope here.
- **Relationship to other refinement docs:** this is a *findings* doc, not a phased plan. Where a finding overlaps an existing plan (`ui-ux-phased.md`, the agentic/learning-structure/teacher-personas phases), it's flagged so the owner can fold it in rather than re-litigate.

---

## How to read this

Three severity bands:

| Band | Meaning |
|------|---------|
| **P0** | Breaks, misleads, or actively lies to the user. Ship-blocking for a "real product" feel. |
| **P1** | Real friction or a noticeable gap between what the app claims and what it does. |
| **P2** | Polish. Worth doing, not urgent. |

Findings are grouped by the requested priorities, then by severity inside each group. The final section is a prioritized matrix + suggested sequencing.

---

## A. Definitiveness — "being true to what it actually is"

This is where Mayon diverges most from its real nature. Several surfaces still present as a developer scaffold or actively misrepresent behavior. These read as "I can tell this was built by an engineer iterating fast" rather than "this is a finished learning tool." Fixing this band yields the biggest perceived-quality jump for the least code.

### A1 · The home page is still a P0-era placeholder **[P0]**

`src/routes/+page.svelte` (the entire file, 22 lines) renders:

> *"P0 foundation is live. The data layer boots in both the browser (SQLite-WASM + OPFS) and the desktop shell (native SQLite via Tauri). Use the sidebar to explore the route placeholders."*

This is build-status scaffolding, still live in a shipped product. A returning user who bookmarks `/`, or anyone who clicks "Home" in the sidebar (`AppShell.svelte:28`), lands on a phase-report instead of their learning app.

**Fix:** make `/` a real home — recent chats (top 5), a prominent "New chat" CTA, quick links to in-progress labs/quizzes, and a genuine empty-state when there's nothing yet. The data already exists (`repos.chats.listRoots`, `repos.labs`, `repos.quizzes`); this is a composition task, not new infra.

### A2 · "Deep" reasoning is a no-op for every model except GLM-5.2 **[P0 — the app lies]**

- `Composer.svelte:107-118`: when effort is `deep`, the tooltip says *"Thinking: deep (more reasoning tokens) — tap to disable"* and a dot indicator renders. The user is explicitly told they're getting more reasoning.
- `sdk-factory.ts:67-69,107-112`: `supportsReasoningEffort()` returns true **only** for `/^glm-5\.2/i`. For every other `openai-compatible` model (OpenAI, OpenRouter, Z.AI 5.1/4.7, Kilo Gateway), the `deep` branch produces **byte-identical** `{ [pKey]: { thinking: { type: 'enabled' } } }` to the `on` branch. Anthropic and Gemini *do* differ.

So for the majority BYOK path the UI promises "more reasoning tokens" and the backend delivers nothing of the kind. This is the clearest "not true to what it is" defect in the app.

**Fix (pick one):**
1. **Honor the promise or hide it.** Gate the `deep` tier on `supportsReasoningEffort(modelId)` for openai-compatible; when unsupported, the cycle collapses to `on → off → on` and the tooltip says so. Anthropic/Gemini keep all three.
2. **Or label honestly:** when the active model can't honor `deep`, demote the dot/tooltip to "Thinking: on (deep not supported by this model)".

> [!NOTE]
> Let's label honestly.

Either is small — the capability check already exists; it just isn't consulted by the Composer.

### A3 · The user never sees which model they're talking to **[P0 — the core BYOK fact is invisible]**

- `Composer.svelte:90` placeholder: *"Message the active provider…  (⌘/Ctrl+Enter to send)"* — generic, names nothing.
- No provider/model chip anywhere in `/chat/[id]`: not the header, not the composer row, not per-message. `chatStore.send` resolves and holds the full active config (`getActiveSdkProvider()` returns `{ model, config, toolCapability }`, `chat.svelte.ts:211`) but it is never rendered.
- The chat *list* shows `chat.provider` (`chat/+page.svelte:134-135`), but `createAndNavigate` never sets that column (`chat.svelte.ts:147-153`), so it's effectively always null.

In a BYOK app the **model is the product**. Quality, latency, cost, and capability all pivot on it, and the user can switch providers freely in Settings. Right now they cannot tell — mid-conversation — who they're addressing. This is the single highest-leverage definitiveness fix.

**Fix:** a small, always-visible chip in the composer row (or chat sub-header): `<provider name> · <model id>`. Update reactively when the user switches the active provider. Optional: a per-message model label on the assistant row (the data is already in `message.metadata` via `opts.model`, `chat.svelte.ts:241-243`).

### A4 · The Diagnostics panel is fully user-facing and leaks system-prompt internals **[P1]**

`DiagnosticsPanel.svelte` (629 lines) renders the assembled **system prompt** (brief + strategy + persona blocks), raw provider JSON, part sequences, tool-call args/results, and model internals. It is toggled by a wrench icon on `/chat/[id]`, `/lab/[id]`, and `/quiz/[id]` — and a grep for `import.meta.env.DEV` in that file returns **zero matches**. It is not dev-gated.

This is prompt-engineering tooling presented as a feature. For a learner it's noise, and it contradicts the careful design work that treats the strategy/persona/capabilities scaffolding as *invisible* framing. A student opening it sees the entire stage machinery.

**Fix:** gate it behind `import.meta.env.DEV`, or relocate to a "Developer" section in Settings behind a clear label, or remove the wrench from the chat/lab/quiz headers. The dev `strategy-lint` hook (`chat.svelte.ts:196`) is already correctly DEV-gated — follow that precedent.

> [!NOTE]
> I disagree. Let's keep the diagnostic panel but maybe name it as "developer" or "dev console" or "Mayon console" and replace the tool icon with the developer icon. If it's possible, let's also have an estimate of the tokens being used vs. what the model supports and present it as a toggle-able text switching between percentage (25%) and actual amount (250k/1.0M)

### A5 · "Expound" is opaque jargon; Branch vs Expound is never explained **[P1]**

- `MessageRow.svelte:87-95`: every assistant message has a **"Branch"** ghost button (whole-message fork).
- `ContextMenu.svelte:86`: right-clicking a selection shows **"Expound…"** — same `GitBranch` icon.
- Both create child chats. Nowhere in the UI is the distinction surfaced: *branch* forks the whole conversation from a message; *expound* creates a focused sub-chat about a selected excerpt (with a `branch_sources` row, a staged prompt, auto-send).

A user who discovers both has no way to infer the difference; a user who only finds "Branch" never learns expound exists (and expound is the flagship dense-content feature).

**Fix:** either rename for honesty (*"Branch from this message"* vs *"Branch from this text"*), or add a one-line explainer in the `ExpoundPromptConstructor` panel header. The underlying mechanics are fine; only the labeling is broken.

### A6 · The runtime is hidden from the user **[P1]**

`AppShell.svelte:114`: `{dbStatus.runtime}` rendered at `text-muted-foreground/50` (50% opacity), unlabeled, in the sidebar footer. The user has no clear sense of whether they're in the desktop (keychain, no CORS, native SQLite) or browser (IndexedDB, CORS-exposed) runtime — and that difference directly determines what works (Anthropic in-browser, key storage location, offline guarantee).

The *reactive* guidance is good: the CORS fallback message (`errors.ts:48-53`) accurately says "use the desktop app." But the *proactive* signal is invisible.

**Fix:** a readable label ("Desktop app" / "Web") instead of the raw `tauri`/`browser` token, at full opacity. Optionally surface it contextually where it matters (e.g., a subtle hint near the Anthropic provider config: "Works best in the desktop app").

### A7 · Lab/quiz "model" labels are bare debug strings **[P2]**

- `LabRunner.svelte:48-50`: renders raw `{lab.model}` (e.g. `glm-5.2`) with no framing.
- Quiz runner similar.

Reads as developer output, not product copy. Minor; pair with A3's model-chip work.



> [!NOTE]
> ### Other comments (filled by user):
> 1. When i generate a lab or a quiz, both the lab and quiz becomes "Generating...". It's not true because only one of them is generating. Let's disable the other one and add a simple animation so the user has a feedback wether the generation is still running.
> 
---

## B. Ease-of-use

### B1 · First-run is a dead end with no provider guidance **[P0]**

- `/` (A1) tells the user nothing about providers.
- `/chat` empty state (`chat/+page.svelte:117-121`): *"Click 'New chat' to begin"* — text only, no button, and "New chat" leads to brief intake, not to provider setup.
- The user only discovers they need a provider when they try to stream and hit `MissingKeyError` (`client.ts:88-103`), surfaced as a red error card (`chat/[id]/+page.svelte:589-601`).

For a BYOK app, "configure a provider first" is the literal first step. Today it's a trap.

**Fix:** a first-run gate. If `listProviders()` is empty, the home page (or a redirect) shows a single focused card: "Add a provider to start" → `/settings`. Optionally block `/chat` creation until a provider + key exist, with a clear message and a link.

### B2 · The brief intake is 7 fields with no progressive disclosure **[P1]**

`BriefCard.svelte` presents, at once: **goal** (required), level, mode, structure, teacher persona, context, scope. Only `goal` is required (`canSubmit` at `:91`), but every field has equal visual weight — it reads like a registration form, not a chat starter. The jargon ("Socratic", "Guided curriculum", "Devil's advocate", five persona names) is unexplained for a first-time user.

The learner profile pre-fill (`profile.ts`, `applyProfile`) helps returning users, but a brand-new user faces all seven fields cold.

**Fix:** progressive disclosure. Lead with **goal** only (full-width), with a collapsed "Calibration" disclosure for level/mode/structure/persona, and an "advanced" disclosure for context/scope. The profile defaults still apply silently; the user just doesn't *see* seven controls on first contact. The "Just start chatting" escape (`BriefCard.svelte:239-241`) stays.

### B3 · Composer: fixed 2-row textarea, no auto-resize, no draft persistence **[P1]**

- `Composer.svelte:86-92`: `<textarea rows="2" class="resize-none">`. Long prompts scroll inside a tiny box.
- `prompt` is local `$state` (`:28`); navigating away (to Settings, the chat list, another chat) **loses the draft**. No localStorage/DB draft.

**Fix:** auto-grow the textarea to a max height (e.g. `rows` derived from content, cap ~12 lines, then scroll). Persist a per-chat draft to the `settings` KV (keyed by chat id) on input with a debounce; restore on mount.

### B4 · No scroll-to-bottom during streaming; no "jump to latest" button **[P1]**

- `chat/[id]/+page.svelte:87-93`: the auto-scroll `$effect` watches `chatStore.messages.length` — it fires on **new persisted messages**, not on streaming tokens.
- During a stream, the live bubble (`MessageList.svelte:62-86`) grows but the viewport does not follow. A user who scrolled up to read context is left staring at old content while the reply streams below the fold.
- There are fade gradients (`:566-577`) hinting there's more below, but **no clickable "↓ latest" affordance**.

**Fix:** track viewport scroll position relative to the bottom; if the user is near the bottom, auto-follow the stream. If they've scrolled up, show a floating "Jump to latest ↓" button. Standard chat-UX pattern.

> [!NOTE]
> I don't like auto-follow of the bottom because I read slow and when I start reading, I want to follow my own reading speed, not the token/second speed of the LLM (which is high).

### B5 · User input is lost on a failed send; no retry/edit **[P1]**

- `Composer.svelte:60-65`: `send()` reads `prompt`, then **clears it** (`prompt = ''`) *before* the async `onSend` resolves.
- If `chatStore.send` throws (network, 401, 429, CORS), the composer is already empty. The user's text is persisted as a message row (`chat.svelte.ts:193`), but there's no "edit and retry" affordance on that row.
- The error card (`:589-601`) has **no retry button** — only the missing-key case gets an "Open Settings" link.

**Fix:** don't clear `prompt` until the send is observed successful (or keep a `lastPrompt` you can restore into the composer on error). Add a "Retry" action to the error card that re-sends the last prompt. Optionally allow editing a user message row in place (bigger change).

> [!NOTE]
> `lastPrompt` sounds good. But the behavior I want is this: if a chat failed to send, a retry button will appear for the failed chat (and also preferrably a different color of the chat so the user quickly knows it failed). Once the retry button is clicked, the lastPrompt will replace whatever is in the composer.

### B6 · No copy-to-clipboard on code blocks **[P1]**

`Markdown.svelte:159-178` styles `<pre>/<code>` but adds **no copy button**. The only copy path is selecting text and right-clicking (which is also the only path to Expound — overloaded). In a *learning* app where runnable code is a first-class output (the Build/workshop strategy literally mandates copy-pasteable fenced blocks), this is a notable gap.

**Fix:** a small copy button (top-right of each `<pre>`, fades in on hover) that copies the code text. Pure client-side; no backend.

### B7 · Expound is effectively undiscoverable **[P1]**

- The only entry is a **right-click** context menu on a selection (`Highlighter.svelte:112-119`).
- The sole hint is an `aria-label` (`:334-335`) — invisible to sighted users.
- No selection toolbar appears on mouse-up. No mobile/long-press equivalent exists (right-click doesn't exist on touch).

Expound is the flagship dense-content feature and it's hidden behind an interaction most users won't try.

**Fix:** a floating selection toolbar (appears above the selection on mouse-up / long-press) with a "Branch from this" button. Keep the right-click menu as a secondary path. This also fixes the mobile gap.

### B8 · The ChatRail (Labs, Quizzes, Siblings, Cross-links) is a discoverability black hole **[P1]**

- On desktop, `ChatRail.svelte` is a right panel that can be collapsed and forgotten (`railCollapsed` persisted, `chat/[id]/+page.svelte:59`).
- On mobile, it's entirely behind a Sheet toggle whose header is just "Navigation" (`:687`) — no hint it contains the generate-lab / generate-quiz triggers.
- "Generate lab" / "Generate quiz" are the primary artifact-creation affordances and they live *only* here (`ChatRail.svelte:111-123, 148-160`).

**Fix:** at minimum, label the mobile Sheet ("Branches · Labs · Quizzes"). Consider hoisting "Generate lab / quiz" into the chat header or a message-row action menu so it's reachable without the rail. The rail stays for *browsing* artifacts; the *creation* trigger shouldn't require finding it.

> [!NOTE]
> Yeah let's do the labelling. And also agree with adding buttons to generate labs & quizzes on the header. Maybe the icons of Labs and Quizzes but with a plus sign? to say "Generaing"

### B9 · No "New chat" affordance inside a conversation **[P2]**

To start fresh you must navigate back to `/chat`. A header "New chat" button (or FAB) would match expectations from every other chat app.

> [!NOTE]
> I think this is not needed. I would discourage creating a new chat inside an already created chat because I want the user to stay on topic. Either continue the current chat or expound an excerpt.

### B10 · MCQ auto-locks on first click; no question navigation in quizzes **[P2]**

- `McqQuestion.svelte:31-35`: `choose(i)` fires `onAnswer(i)` immediately on click. A misclick is permanent; there's no "Submit" confirmation.
- `QuizRunner.svelte:76-109`: all questions in one vertical scroll. No numbered nav, no jump-to-question. In a 10+ question quiz, scrolling is the only way around.

**Fix:** two-step MCQ (select → confirm), or an "are you sure?" on the first answer. Add a question rail/progress indicator for longer quizzes.

> [!NOTE]
> two-step mcq and numbered rail for longer quizzes.

### B11 · Reasoning toggle discoverability **[P2]**

`Composer.svelte:94-118`: a 3-state cycle button (`on → deep → off`) whose only "deep" signal is a 1.5px dot in the corner. First-time users won't find the third state. Pair with A2: if `deep` is hidden for incapable models, the toggle becomes a cleaner 2-state.

> [!NOTE]
> Or let's do that when they click it, will show a drop down (but drop up, I think, because it's in the bottom of the page.)

### B12 · Approval cards show raw JSON args **[P2]**

`ApprovalCard.svelte:18-20`: renders `JSON.stringify(args, null, 2)`. Fine for `create_quiz { topic }`, developer-facing for anything complex. A tool-specific summary line ("Create a quiz on: <topic>") would land much better.

---

## C. Performance

### C1 · No virtualization in MessageList **[P1]**

`MessageList.svelte:56`: a flat `{#each visibleMessages}` renders **every** message row into the DOM. No windowing, no `IntersectionObserver`. A long conversation (hundreds of turns, common in a curriculum that gates per-unit) puts the full tree in the DOM. Combined with C2, this will jank.

**Fix:** virtualize (e.g. `svelte-virtual-list` or a lightweight `IntersectionObserver` windowing wrapper). Keep the reference-based context assembly unchanged — this is purely a render concern.

### C2 · Full markdown re-render on every streaming token **[P1]**

- `MessageList.svelte:77`: `<Markdown raw={stripGateFence(streamBuffer)} />` inside the streaming block.
- `chat.svelte.ts:237`: `updateStreamBuffer: (n) => (this.streamBuffer = n)` — direct `$state` assignment per delta, no throttle/debounce.
- `render.ts`: the unified pipeline (remark-gfm + remark-math + rehype-katex + rehype-highlight + admonition + sanitize) runs **synchronously on every token**.

For a fast stream (100+ tokens/sec) with complex markdown (tables, KaTeX, code), this re-parses and re-renders the whole buffer continuously. The only debounce in the entire app is the 200ms search input (`search/+page.svelte:65-79`).

**Fix:** throttle the streaming render (e.g. coalesce deltas on a `requestAnimationFrame` cadence), or render a lightweight *raw text* view during streaming and run the full markdown pass once on completion. The persisted message already re-renders via `MessageRow` — the live buffer doesn't need full fidelity mid-stream.

### C3 · Heavy render work on the main thread **[P2]**

Markdown parsing, KaTeX, Shiki highlighting, and Mermaid (~600KB, lazy-loaded per message) all run on the main thread. The OPFS worker offloads SQLite; nothing offloads render. Mermaid also flashes raw fenced code before the SVG swaps in (`Markdown.svelte:36-44`) with no loading indicator.

**Fix (later):** move Shiki/KaTeX/Mermaid to a worker, or at least defer Mermaid render until idle (`requestIdleCallback`). Add a skeleton/spinner during the mermaid swap.

> [!NOTE]
> Yeah let's defer Mermaid render until idle. Let's also add a spinner (but ideally the \|/- animation to signal that it is code right now and it says "Generating Diagram...")
> I also don't see Shiki working? I don't see any highlighting being done to my renders. Or maybe we need the language plug-ins or something.

### C4 · No route-level code splitting **[P2]**

No `+page.ts` load functions exist; all data loading is in `onMount`. SvelteKit's `sveltekit-preload-data="hover"` (`app.html:23`) prefetches on hover, but there's no lazy route chunking — the initial bundle carries every page. For a local app this is less critical than for a web product, but it still affects first-paint on the browser runtime.

### C5 · Mid-stream navigation silently discards the reply **[P1 — also robustness]**

- `chat.svelte.ts:9-11` documents the contract: "A reload mid-stream loses the in-flight turn (accepted)."
- `load()` (`:108-139`) calls `stop()` on navigation, which aborts and clears `streamBuffer`. The user message persists; the assistant reply does not.
- After reload/navigation, the user sees their message with no reply and **no indication** a turn was interrupted.

"Accepted" is doing a lot of work here. Silent data loss in a learning app — where the user just paid tokens for a reply — erodes trust.

**Fix (lighter):** persist the partial `streamBuffer` as a draft assistant row on abort/navigation, marked `metadata: { interrupted: true }`, rendered with a "interrupted — regenerate" affordance. **Fix (heavier):** true resumability. The lighter fix closes the trust gap; recommend that.

---

## D. Robustness & state (cross-cutting)

### D1 · DB error badge is hover-only, no retry **[P1]**

`DbStatus.svelte`: the error path shows "DB error" text but the actual message lives in the `title` attribute (`:32`) — you must hover to see *why*. No inline message, no retry/reload button. A migration failure leaves the DB partially migrated (`migrator.ts:14-43`, no rollback) and the user sees a red badge with no path forward.

**Fix:** when `status === 'error'`, expand the badge into an inline error strip with the message + a "Reload" button. Migration failures are rare but catastrophic when they happen; the user needs a handle.

### D2 · Self-check amber state is confusing **[P2]**

`DbStatus.svelte:25-26`: when the dev self-check fails, the badge turns amber but still reads **"DB ready"**. The text contradicts the color. (Self-check is correctly DEV-only at the call site, `+layout.svelte:37`.) Minor; change the label to "DB ready (self-check failed)" in dev.

### D3 · Storage seam asymmetry: snapshot/restore **[P2]**

`StorageDriver.snapshot`/`restore` are optional (`types.ts:26-28`). The OPFS driver implements them (`opfs-driver.ts:81-87`); the Tauri driver does **not** (`tauri.ts:34-75` has no such methods). `DataSection.svelte` routes desktop through separate Rust commands (`backup.rs`) — functionally correct, but the seam is asymmetric. This is a note for whoever owns `ui-ux-phased.md` UX3, not a user-facing bug.

### D4 · Updater endpoint is a placeholder **[P2 — shipping blocker for desktop releases]**

`tauri.conf.json:33-34`: `endpoints` points at `github.com/mayon-app/mayon/...` — a placeholder owner/repo (per `AGENTS.md`). `updater.check()` will 404 in any real deployment until configured. Not user-facing until you cut a release, but flag it before P5 distribution.

---

## Prioritized matrix

| # | Finding | Band | Effort | Overlaps existing plan? |
|---|---------|------|--------|-------------------------|
| A1 | Home page is a P0 placeholder | P0 | S | — |
| A2 | "Deep" reasoning is a no-op for non-GLM | P0 | S | `reasoning-effort.md` (open Q #1/#3) |
| A3 | Model/provider invisible in chat | P0 | S | — |
| B1 | First-run dead end, no provider gate | P0 | M | — |
| A4 | Diagnostics panel leaks system prompts (not dev-gated) | P1 | S | — |
| A5 | "Expound" opaque; Branch vs Expound unexplained | P1 | S | — |
| A6 | Runtime hidden (50%-opacity token) | P1 | S | — |
| B2 | 7-field brief intake, no progressive disclosure | P1 | M | `learning-brief-refinement.md` |
| B3 | Composer: no auto-resize, no draft persistence | P1 | S | — |
| B4 | No scroll-to-bottom / "jump to latest" during stream | P1 | S | — |
| B5 | Input lost on failed send; no retry | P1 | S | — |
| B6 | No copy button on code blocks | P1 | S | — |
| B7 | Expound undiscoverable (right-click only, no mobile) | P1 | M | — |
| B8 | ChatRail is a discoverability black hole | P1 | M | — |
| C1 | No MessageList virtualization | P1 | M | — |
| C2 | Full markdown re-render per token | P1 | M | — |
| C5 | Mid-stream navigation silently discards reply | P1 | M | — |
| D1 | DB error badge hover-only, no retry | P1 | S | — |
| A7 | Lab/quiz model label is bare debug string | P2 | S | — |
| B9 | No "New chat" inside a conversation | P2 | S | — |
| B10 | MCQ auto-lock; no quiz question nav | P2 | S | — |
| B11 | Reasoning toggle discoverability | P2 | S | pairs with A2 |
| B12 | Approval cards show raw JSON | P2 | S | `agentic-capabilities-phased.md` AG4 |
| C3 | Heavy render on main thread | P2 | M | — |
| C4 | No route-level code splitting | P2 | M | — |
| D2 | Self-check amber "ready" contradiction | P2 | S | — |
| D3 | Snapshot/restore seam asymmetry | P2 | S | `ui-ux-phased.md` UX3 |
| D4 | Updater endpoint placeholder | P2 | S | P5 (release prep) |

---

## Suggested sequencing

Three loose waves. Each is independently shippable and each visibly moves the app toward "real product."

**Wave 1 — Make it true to itself (definitiveness, mostly S effort).**
A1 (home), A3 (model chip), A2 (honest reasoning tiers), A4 (gate diagnostics), A6 (runtime label), A7 (model labels). After this wave the app no longer presents as scaffolding or lies about behavior. Low risk, high perceived quality.

**Wave 2 — Make the core loop feel good (chat ease-of-use + perf).**
B4 (scroll-to-bottom), B5 (input preservation + retry), B6 (code copy), B3 (composer auto-resize + draft), C2 (streaming render throttle), C1 (virtualization), C5 (interrupted-turn marker), B1 (first-run gate). This is the "does it feel like a polished chat app" wave; it touches the path every user hits every session.

**Wave 3 — Make features findable (branching/artifacts).**
B7 (expound selection toolbar + mobile), B8 (hoist generate-lab/quiz out of the rail), A5 (branch vs expound labeling), B2 (progressive intake disclosure), B10/B11/B12 (quiz + toggle + approval polish). This is where the *unique* value of Mayon (branchable graph, generated artifacts) becomes discoverable instead of hidden.

Robustness items (D1–D4) slot in alongside whichever wave is touching the same files.

---

## Notes on methodology & non-findings

- Every citation was verified against the live code at audit time; the four parallel deep-dive reports (BYOK onboarding, chat journey, branching/artifacts, robustness/runtime) were cross-checked against direct reads of `Composer.svelte`, `MessageList.svelte`, `MessageRow.svelte`, `sdk-factory.ts`, `+page.svelte`, `+layout.svelte`, and `AppShell.svelte`.
- **Not audited here** (out of scope or already-planned): the agentic loop internals (AG3–AG5), semantic search (UX5), teacher-persona block content, and strategy-block prompt tuning — these are open *design* questions with their own docs, not as-built journey defects.
- **Deliberately not recommended:** any new epic, any schema migration, any change to the reference-based branching model, any network/cloud feature. The brief was *enhancement of current features*.
