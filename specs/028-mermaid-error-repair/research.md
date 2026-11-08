# Research: Mermaid Diagram Error Repair & Containment

**Feature**: 028-mermaid-error-repair | **Date**: 2026-11-08

Research ran as two parallel read-only explorations of the worktree: (A) the mermaid
render/error surfaces, (B) the LLM-generation, critic, and chat-send patterns. All
file:line citations below were verified in the reports.

## Current-state findings

### F1. The page-corruption defect is mermaid's own error SVG

- `src/lib/markdown/mermaid.ts:44-48` initializes mermaid with exactly three options
  (`startOnLoad: false`, `securityLevel: 'strict'`, theme). `suppressErrorRendering`
  is **not set**.
- mermaid's `render()` (used at `mermaid.ts:75` via `renderMermaidBlock`) inserts its
  "Syntax error in text" error SVG at the bottom of `<body>` before rejecting when
  `suppressErrorRendering` is false/default. The app's catch handlers
  (`Markdown.svelte:114-119` initial pass, `:56-60` theme pass) handle only the
  rejection — the injected error node stays. That node is the observed page-level
  scroll + bottom banner.
- Installed mermaid is exactly **11.16.1** (`package.json:69`, `pnpm-lock.yaml:3101`)
  and its shipped `MermaidConfig` includes `suppressErrorRendering?: boolean`
  ("Suppresses inserting 'Syntax error' diagram in the DOM"). Supported since the
  10.x line (mermaid-js/mermaid#4358).

### F2. The render seam is a single choke point

- `renderMermaidBlock(source)` (`mermaid.ts:60-79`) is the only render entry: it
  reads the resolved theme, serializes initialize+render on a module-wide
  `renderChain` (so renders never straddle a theme re-init), and rejects on parse
  error ("the caller decides whether to show a fallback", `mermaid.ts:63-64`).
- Both Markdown passes use it: the `onMount` initial pass
  (`Markdown.svelte:75-122`, guarded off when `live`) and the theme re-render pass
  (`rerenderStaleMermaid`, `Markdown.svelte:42-63`, triggered by the theme
  `$effect` at `:69-73`). On success the wrapper `div.mermaid-svg` stores
  `data-mermaid-source` (original) and `data-rendered-theme`; the theme pass
  re-renders **from the stored original source** in place, preserving listeners.
- Other mermaid consumers come along free: `LabRunner.svelte:54` reuses
  `<Markdown>`; the pan/zoom preview (`MermaidPreview.svelte`) just re-injects the
  wrapper's already-rendered `innerHTML` (`Markdown.svelte:106-108`) and never
  re-renders from source.

### F3. The current error `<p>` silently degrades expound alignment

- Failure notes are plain `<p class="my-3 text-xs text-red-600...">` elements
  (`Markdown.svelte:57-60`, `:115-118`) — none of
  `EXCLUDED_CHROME_SELECTORS` (`src/lib/chat/selection.ts:27-38`) matches them.
- Mermaid segments contribute zero characters to the canonical text
  (`sourcemap.ts:149-159`, `rendered: ''`), so the note's text fails canonical
  matching (`selection.ts:113`), marks the message `unaligned`
  (`selection.ts:135-140`), and thereby disables the whole underline pass and
  breaks any selection intersecting the note (`Highlighter.svelte:294-333`).
- Success-path chrome (`.mermaid-svg`, `.mermaid-pending`, `code.language-mermaid`)
  is already excluded; the error path was simply missed. Fixing containment must
  also fix this (add the new error block's selectors to the excluded list).

### F4. Streaming already never renders mermaid

- The live reply body is `<Markdown raw live>` (`AssistantMessage.svelte:147-149`)
  and every mermaid path hard-skips on `live` (`Markdown.svelte:71,76,43`); an
  open/incomplete fence parses as a plain code block and accumulates as source
  text. Diagrams render only when the durable message mounts after stream
  completion (new Markdown instance, `live=false`). FR-011 is satisfied by the
  existing structure — the plan must merely preserve the guards.
- One caveat: `ReasoningEntry.svelte:49` renders the live reasoning buffer without
  `live`, so its mount pass can attempt a fence that closed mid-reasoning. Repair
  + containment handle whatever happens there; no new guard is needed (the mount
  is one-shot and the fence must be syntactically closed to reach mermaid).

### F5. Model-assisted diagram correction already exists — at generation time

- The agent critic validates every finished reply: `validateMermaid`
  (`critic.ts:18-40`) extracts closed ```mermaid fences and calls
  `api.parse(source)`; failures become `{type:'mermaid', message, locator}`
  issues.
- `runCriticPhase` (`loop.ts:227-300`) feeds the first issue (with the parser
  message) back as a corrective user message and re-streams a full corrected
  reply, up to `MAX_CORRECTIONS = 2`, persisting a `self_corrected` report
  (`loop.ts:461-462`). Fresh faulty diagrams therefore already get up to two
  model-assisted repairs per turn, before the message is persisted.

### F6. Patterns for the pieces we do need

- **Canned in-conversation message**: `chatStore.send(text, opts?)`
  (`chat.svelte.ts:436-444`) persists a user row and runs a turn; the
  `ChoicesOffer` quick-action pattern (`MessageList.svelte:202-211`) sends canned
  visible text and links it via metadata. A visible follow-up message is an
  established, honest pattern.
- **Context-free `<Markdown>`**: the component is rendered by labs, quizzes, user
  messages, reasoning, and tool results — it cannot assume a chat store. Actions
  must arrive as an optional callback prop wired only by chat rows
  (`AssistantMessage.svelte`).
- **Settings/flag pattern (if ever needed)**: settings-KV row + fail-closed
  reader + `$state` singleton (telemetry: `telemetry/state.svelte.ts:6-27`,
  `capture.ts:10-13`). Not needed for this feature — nothing here is gated.

## Design decisions

### D1 — Containment via `suppressErrorRendering` + contained error block

- **Decision**: set `suppressErrorRendering: true` in the `api.initialize` call
  (`mermaid.ts:44-48`), and replace both red-`<p>` fallbacks with a styled,
  self-contained error block (notice + on-demand reason + formatted source) inside
  the diagram's own area. Add the block's selectors to
  `EXCLUDED_CHROME_SELECTORS`.
- **Rationale**: the banner/scroll defect is exactly mermaid's injected error SVG;
  one supported config flag eliminates it at the source. The excluded-selectors
  update simultaneously fixes the alignment degradation (F3). Contained block
  satisfies FR-001/FR-002/FR-008 with existing styling vocabulary.
- **Alternatives considered**: catching and deleting mermaid's injected error node
  after the fact (fragile — depends on mermaid internals/DOM shape; still flashes);
  pre-validating with `api.parse` to avoid `render()`'s error path (wasteful —
  parses twice for every diagram; `render()` rejects either way).

### D2 — Deterministic repair as a pure module at the shared render seam

- **Decision**: new `src/lib/markdown/mermaid-repair.ts`, a pure
  `repairMermaidSource(source): { source, repaired, changed }` style function
  covering a small, corpus-tested set of high-frequency fault classes. It is
  applied inside/around `renderMermaidBlock`'s callers as: render original → on
  failure, render repaired → on failure, contained error. Because both Markdown
  passes go through the same seam and the wrapper keeps the **original** in
  `data-mermaid-source`, theme re-renders deterministically reproduce the same
  repaired result (FR-012) with no stored state.
- **Rationale**: repair-after-failure means valid diagrams pay nothing (FR-006,
  SC-003); a pure function is unit-testable without DOM and shared by all
  consumers (chat, labs, quizzes) for free; idempotence keeps historical messages
  stable across re-mounts and theme flips.
- **Alternatives considered**: repair inside `renderMermaidBlock` itself (viable —
  final placement is a tasks-level choice between "seam function wraps render" and
  "callers wrap seam"; contract in `contracts/render-pipeline.md` fixes the
  behavior either way); a web-worker repair pipeline (over-engineering for
  bounded string edits); regex-free AST repair via mermaid's jison parser hooks
  (no public API; brittle).
- **Fault classes for the initial corpus** (from the spec example + common
  model-output faults; exact rules finalized in tasks): quoted edge/node labels
  containing embedded double quotes and/or commas (`-->|"sad", "SAD"|` — the spec's
  example), unquoted labels containing reserved characters, and mixed/smart quote
  normalization inside labels. Corpus tests must include the spec's example
  verbatim.

### D3 — No render-time LLM calls; model-assisted recovery = existing critic + user-triggered fix action

- **Decision**: do **not** add a hidden model-assisted repair call at render time.
  Provider-dependent repair is realized as (a) the **existing critic
  self-correction loop** at generation time (F5 — up to two corrections per turn,
  already shipped and tested), and (b) the spec's **in-conversation "fix this
  diagram" action** (user-triggered, one send per action). Deterministic repair
  covers render-time for everything else, including historical messages.
- **Rationale**: `<Markdown>` mounts for *every* historical message scrolled into
  view; a render-time LLM call would spend unpredictable tokens on old
  conversations — violating the spec's own cost-predictability criterion (SC-004:
  "at most one model-assisted repair request per failed diagram, never more" —
  the cheapest way to guarantee "never more" is to bind model spend to explicit,
  bounded events: the critic's existing per-turn budget and one send per user
  click). It also avoids duplicating the critic's mechanism. FR-010 is satisfied:
  with no provider, deterministic repair still applies, the critic never ran, and
  the fix action is simply unavailable.
- **Alternatives considered**: render-time hidden repair call on failure (rejected:
  unbounded spend on history mounts, adds latency to scrolling, duplicate of the
  critic); post-stream standalone repair request appended after the critic
  (rejected: second self-correction mechanism for the same defect, more turns,
  more cost); freshness-window gating of render-time calls (rejected: fragile
  heuristic complexity for no user-visible gain).

### D4 — Fix affordance: visible canned follow-up message via callback prop

- **Decision**: the error block offers a "fix this diagram" action only when
  `<Markdown>` receives an optional callback prop; `AssistantMessage.svelte`
  (durable assistant rows) wires it to `chatStore.send(...)` with a canned,
  visible message containing the broken source and the failure reason. The
  original message is untouched; the corrected diagram arrives as the assistant's
  next reply.
- **Rationale**: visible canned sends are an established honest pattern
  (`ChoicesOffer`, F6); the callback prop keeps `<Markdown>` context-free for
  labs/quizzes/user messages; provider absence is the normal "can't send" state
  the composer already handles, so the action hides when a handler isn't wired.
- **Alternatives considered**: `hidden: true` internal message (rejected: the fix
  is a user action on the visible record — hiding the prompt makes the corrected
  reply look unprompted; expound-branch hidden prompts are a different,
  UI-internal case); a dedicated repair LLM endpoint on the server (rejected:
  bypasses the conversation, no transcript of the fix, new server surface for
  zero benefit).

### D5 — Repaired indication: wrapper dataset + subtle badge + original-source disclosure

- **Decision**: when a render used repaired source, the wrapper is stamped
  (e.g. `data-mermaid-repaired`) and shows a small badge consistent with existing
  conventions; the badge discloses the original source (formatted `<pre>`,
  excluded from selection like all generated chrome). `data-mermaid-source`
  always keeps the original.
- **Rationale**: satisfies FR-005 (indication + access to original) and the
  edge case "repaired render may differ from model intent"; keeping the original
  as the re-render source makes theme stability structural (F2).
- **Alternatives considered**: replacing the stored message with repaired source
  (rejected: violates transcript immutability and FR-004, breaks expound offsets);
  toast/transient indication (rejected: not durable across re-mounts/theme flips).

## Resolved NEEDS CLARIFICATION

None were raised in the spec's Technical Context; the spec's one layered-repair
assumption ("single model-assisted repair attempt as fallback") is refined by D3
into critic-at-generation + user-triggered action, with the rationale recorded
above. No open clarifications remain.
