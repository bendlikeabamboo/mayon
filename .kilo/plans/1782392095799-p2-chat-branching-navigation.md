# P2 — Chat, branching & navigation

Derived from `refinement/architecture.md` §4–5 and `refinement/phased-plan.md` §P2.
Builds on the P0 data layer and P1 provider layer, which are complete and tested.

## Goal

The product's core loop: chat with streaming persistence, highlight a dense span of an
assistant reply, branch a child conversation that inherits excerpt + history, and navigate
the resulting tree (full `/tree` page + in-chat breadcrumb). Minimal cross-links included.

## Resolved decisions

| Decision | Choice |
| --- | --- |
| Stream persistence | Persist on completion only (user row appended immediately; assistant tokens accumulated in memory, appended on finish/Stop; reload mid-stream loses the in-flight turn — accepted) |
| Routing | `/chat` (list + new chat) and `/chat/[id]` (single conversation); branch/tree navigation changes the `[id]` |
| Branch offsets | Map browser selection on rendered message → raw markdown `content` offsets for `startChar`/`endChar`; snapshot selected text as `excerpt` |
| Offset fallback | Graceful: if mapping can't resolve (e.g. selection touches generated content like an expanded Mermaid SVG), store `startChar=0`/`endChar=excerpt.length` against raw content and proceed — branch always succeeds, only re-pin precision degrades |
| Tree UI | Full `/tree` page (collapsible subtrees) + in-chat breadcrumb (root › … › current) + child/sibling list under composer |
| Cross-links | Minimal create + list + delete via existing `crossLinksRepo`; rendered as reference edges atop the chat |
| Markdown stack | unified/remark: `remark-parse` + `remark-gfm` + `remark-mermaid` + `remark-math` + `rehype-katex` + `highlight.js` + `rehype-sanitize` + `rehype-stringify`; Mermaid lazy-loaded per-message only when a mermaid block is present |
| Session state | Runes-class store `src/lib/stores/chat.svelte.ts` (mirrors `stores/db.svelte.ts` / `dbStatus`) |

## What already exists (reuse — do not rebuild)

- `assembleContext(targetChatId)` (`src/lib/chat/context.ts`) — fully tested; returns ordered
  `ChatMessage[]` with leading excerpt system-note.
- Tree repos: `chatsRepo.createRoot/createChild/getById/listRoots/listChildren/listSubtree`,
  `messagesRepo.append/listByChat/getById`, `branchSourcesRepo.create/getByBranchChat`,
  `crossLinksRepo.create/listForChat/delete`.
- `getActiveProvider()`, `formatProviderError()` and typed error classes.
- The streaming/abort/error pattern in `StreamDemo.svelte` — mirror it in the store.
- Svelte 5 runes store convention (`stores/db.svelte.ts`, `stores/theme.svelte.ts`).

## Schema notes

- No migration needed for P2 (all tables/columns exist from P0). Verify with `pnpm test`.
- `messages.tokens` stays null (adapters don't emit token counts; column is nullable).

## Implementation tasks

### 1. Markdown pipeline + `<Markdown>` component
- Add deps: `unified`, `remark-parse`, `remark-gfm`, `remark-mermaid`, `remark-math`,
  `rehype-katex`, `rehype-sanitize`, `hast-util-sanitize`, `rehype-stringify`, `highlight.js`,
  and `katex` (stylesheet). (`pnpm add …`)
- `src/lib/markdown/render.ts`: pure `renderMarkdown(raw: string): string` → sanitized HTML.
  Pipeline order: remark-parse → remark-gfm → remark-mermaid → remark-math → rehype-katex →
  rehype-highlight (highlight.js) → rehype-sanitize → rehype-stringify.
- `src/lib/markdown/mermaid.ts`: lazy `import('mermaid')` + render-to-SVG for fenced mermaid
  blocks; called by the component only when the rendered HTML contains a mermaid code block.
- `src/lib/components/chat/Markdown.svelte`: takes `raw` prop, renders sanitized HTML via
  `{@html}`, then scans for `.language-mermaid` blocks and swaps in rendered SVG. Each message
  instance is its own component so Mermaid loads lazily per-message.
- Wire KaTeX CSS once globally (import in `app.css` or the component).
- Keep `renderMarkdown` pure so it is unit-testable against the highlighter/branching logic.

### 2. Selection → raw-offset mapping (`src/lib/chat/highlight.ts`)
- `resolveSelectionOffsets(rawContent: string, selection: { startNode, startOffset, endNode, endOffset, containerEl }): { startChar, endChar, excerpt } | null`
- Strategy: collect the concatenated visible text of the message's render container and the
  raw markdown; map selection boundary indices from rendered-text-space back into raw-content
  space by searching for the surrounding text in `rawContent` (anchor on a surrounding
  substring to survive markdown→prose reflow like list markers/emphasis).
- Return null when mapping can't be confidently resolved → caller uses the fallback.
- Pure, no DOM dependency beyond the passed-in range data → unit-testable.

### 3. Chat session store (`src/lib/stores/chat.svelte.ts`)
Runes class (singleton), exposing:
- `$state`: `chatId`, `chat` (Chat|null), `messages` (Message[]), `streaming` (bool),
  `streamBuffer` (string, the in-flight assistant text), `error` (FormattedProviderError|null),
  `loading` (bool), and a private `controller: AbortController|null`.
- `load(chatId)`: set chatId, load chat + `messages.listByChat`, clear streaming/error.
- `createAndNavigate()` (used by New Chat): `chatsRepo.createRoot`, return id (router navigates).
- `send(text)`:
  1. `messages.append(chatId, 'user', text)`; append returned row to `messages`; `chatsRepo.touch`.
  2. `streaming=true`, `streamBuffer=''`, new AbortController.
  3. `const ctx = await assembleContext(chatId)`; `const provider = await getActiveProvider()`.
  4. for-await tokens → `streamBuffer += token.text ?? token.delta ?? ''`.
  5. on finish/stop (and not aborted-empty): `messages.append(chatId,'assistant',streamBuffer)`;
     push row to `messages`; `chatsRepo.touch`; reset buffer/streaming.
  6. errors → `formatProviderError(err)` into `error` (AbortError swallowed, like StreamDemo).
- `stop()`: `controller?.abort()`.
- `branchFromSelection(messageId, rawContent, selection)`:
  1. `const off = resolveSelectionOffsets(...) ?? { startChar:0, endChar:excerpt.length, excerpt }`.
  2. `child = chatsRepo.createChild({ parentId: chatId, branchPointMessageId: messageId, title })`
     (title = first line of excerpt or "Branch of <chat.title>").
  3. `branchSourcesRepo.create({ sourceMessageId: messageId, startChar, endChar, excerpt, branchChatId: child.id })`.
  4. return `child.id` (router navigates to `/chat/<childId>`; store.load runs).
- `branchFromMessage(messageId)`: same without a span (no branch_source row; full message as
  context seed) — convenience for branching from a whole message.
- Reset state when `load` is called for a different chat.

### 4. Branch/tree helpers (pure, testable) — `src/lib/chat/tree.ts`
- `breadcrumbToRoot(chat, byId)` → ordered ancestor list root…current (walk `parentId`).
- `buildSubtreeModel(chats)` → nested `{ chat, children[] }` from a flat `listSubtree` result.
- These operate on plain data so they're unit-tested without the DOM.

### 5. Routes
- `src/routes/chat/+page.svelte` — chat list: "New chat" button (→ `createAndNavigate` then
  `goto('/chat/'+id)`), recent roots from `chatsRepo.listRoots`, each linking to `/chat/[id]`.
  Replace the current `StreamDemo`-only render here.
- `src/routes/chat/[id]/+page.svelte` — the conversation view: `<MessageList>`, error block
  (reuse StreamDemo's styling), `<Composer>`, breadcrumb (root › … › current, each a link),
  child/sibling list under composer, cross-links panel atop, and a top "open in /tree" affordance.
- `src/routes/tree/+page.svelte` — collapsible tree from `listSubtree(rootId)` per root;
  clicking a node navigates to `/chat/[id]`.

### 6. Components (`src/lib/components/chat/`)
- `MessageList.svelte` — renders `messages` (and the live `streamBuffer` as a trailing
  in-progress assistant bubble when streaming). Each assistant message is a `<MessageRow>`.
- `MessageRow.svelte` — renders role label + `<Markdown raw={message.content} />`; for
  assistant rows wires the `Highlighter` (selection capture) and shows a "Branch from here"
  affordance when a selection is active.
- `Highlighter.svelte` — wraps an assistant message; listens for selection within its
  container; on selection + button click, gathers the range and calls up via a callback prop
  `onbranch(selection)`.
- `Composer.svelte` — textarea + Send/Stop (mirror StreamDemo; ⌘/Ctrl+Enter to send).
- `Breadcrumb.svelte` — receives the ancestor chain; renders clickable links to each.
- `CrossLinks.svelte` — lists `crossLinksRepo.listForChat`; "Link chat…" action (picker over
  roots/children) → `crossLinksRepo.create`; remove → `crossLinksRepo.delete`.

### 7. Cleanup
- Remove `src/lib/components/ai/StreamDemo.svelte` once `/chat/[id]` ships its composer
  (the P1 ephemeral demo is superseded). Keep `ProviderConfig.svelte` (still used by /settings).

## Validation

### Automated (Vitest, in-memory driver)
- `highlight.test.ts`: `resolveSelectionOffsets` — clean mapping, emphasis/list-marker reflow,
  and the can't-resolve → null case.
- `tree.test.ts`: `breadcrumbToRoot` and `buildSubtreeModel` shapes (incl. multi-level).
- Extend `context.test.ts` only if a new branch path is added (it already covers
  excerpt-injection + multi-ancestor cutoffs).
- A store-level branch round-trip test (seed parent + message, branch via the store's helper,
  assert `assembleContext(child)` includes excerpt + cutoff history) — run against the memory
  driver like `context.test.ts`.
- `pnpm check` (svelte-check) + `pnpm lint` clean.

### Manual acceptance gates
- **Streaming + persistence:** `pnpm dev` → `/chat` → New chat → send prompt → tokens stream →
  **reload** → messages survive (proving persistence).
- **Highlight → branch:** from an assistant reply, select a span → "Branch from here" → child
  opens; send a prompt → the reply is grounded in the excerpt + ancestor history (verify via
  the assembled context, or by the assistant referencing the excerpt). Reload survives.
- **Offset fallback:** select across a rendered Mermaid diagram / generated content → branch
  still succeeds (excerpt-only); no error thrown.
- **Tree + breadcrumb:** `/tree` shows roots + collapsible subtrees; breadcrumb in `/chat/[id]`
  jumps to any ancestor; child/sibling list navigates to children.
- **Cross-links:** link two chats; link renders as a reference edge atop the chat; remove works.
- **Desktop:** `pnpm tauri dev` → same flow survives an **app restart**.
- **No active provider:** `/chat/[id]` → send → shows the MissingKeyError affordance (links to
  /settings), never a raw error.

## Risks / notes
- **Selection→offset mapping** is the riskiest piece; the graceful fallback guarantees the
  branch action never fails, only re-pin precision degrades on generated content.
- **Mermaid/highlight bundle weight:** Mermaid is large — lazy-load per-message and only when a
  mermaid block exists. highlight.js is lighter than Shiki and avoids a wasm worker.
- **Reload-mid-stream** loses the in-flight assistant turn (accepted by decision). A future
  enhancement could persist incrementally; not needed for P2.
- **`{@html}` with sanitized output:** rely strictly on `rehype-sanitize` (configured
  allowlist); never bypass it. Re-pin the sanitize schema if Mermaid SVG is injected post-hoc
  (sanitize the SVG or trust mermaid's own output, documented in the component).

## Out of scope for P2
- Incremental stream persistence, message editing/deletion UI, drag-to-merge chats,
- Shiki syntax highlighting, lab/quiz generation (P3/P4),
- The P5 Rust transport / secure key storage.
