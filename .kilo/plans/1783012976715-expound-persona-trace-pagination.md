# Chat/Tree UX fixes: expound tool error, persona labels, trace crash, pagination, tree redesign

Six independent user-reported issues. #1–#4 are bugs; #5–#6 are UX. Only #5
and #6 intersect (both edit `/tree/+page.svelte`); implement them together.

## Background / root causes (confirmed against code)

- **#1 ("missing chatId" on the expound branch):** Not a UI string — it's a
  tool-**result** row rendered above the assistant's Branch button. The
  `list_artifacts` (`src/lib/agent/registry.ts:117-118`) and
  `summarize_progress` (`registry.ts:198-199`) tools require a `chatId`
  **argument from the model**, but the model cannot know the current chat id.
  The expound prompt (`expound.ts:49` "Summarize the current discussion.")
  invites a `summarize_progress` call that omits `chatId` → result
  `missing chatId`. All other tools correctly source identity from
  `ctx.chatId` / `ctx.rootChatId` (see `deterministic-tools.ts:27,31,69,82,99`).
- **#2 (ExpoundCard sticky + not full-width):** The card is rendered in the
  non-scrolling `topPane` (`src/routes/chat/[id]/+page.svelte:527-537`), which
  is `shrink-0` above the scroll `viewport`. Its root div uses `self-start`
  (`ExpoundCard.svelte:23`), so it never spans the message area.
- **#3 (assistant label "Mayon" not the persona):** Hardcoded at
  `MessageRow.svelte:31` (`assistant: 'Mayon'`) and `MessageList.svelte:62`
  (live bubble). The selected persona (`rootBrief.persona`) is never threaded
  down. `DEFAULT_PERSONA = 'dr-kim'` (`personas.ts:122`).
- **#4 (can't select a chat trace):** Each tool call's `toolCallId` is recorded
  **twice** in the trace JSON — once via the `part` stream event
  (`trace.ts:148-153`, fed by `loop.ts:85`) and again via the explicit
  `tool-call` event (`loop.ts:334-339` and `394-399`). `DiagnosticsPanel`
  keys `{#each iter.toolCalls as tc (tc.toolCallId)}` (`:448`) and
  `{#each iter.toolResults … (tr.toolCallId)}` (`:477`) → Svelte throws
  `each_key_duplicate`, which crashes the selected-trace section. Traces already
  persisted in the DB carry the dupes, so a code-only fix won't repair old data.
- **#5 (no pagination):** `/chat`, `/lab`, `/tree` render their full lists. No
  pagination UI exists in `src/lib/components/ui/`.
- **#6 (tree page cramped):** `tree/+page.svelte` uses `max-w-4xl`, root forests
  in `space-y-1 rounded-lg … p-3`, rows at `gap-2` / `py-1.5`, indent
  `{depth*1.25}rem`.

## Decisions (all resolved)

- **#1:** Identity comes from `ctx.chatId` (current chat — matches how
  `ChatRail`/labs scope artifacts to the open chat). Drop the `chatId` parameter
  from both tool schemas; ignore any model-supplied id.
- **#2:** Move the card into the scrolling `viewport` as a `MessageList` header
  snippet; make it `w-full`.
- **#3:** Show the persona name when a brief exists
  (`rootBrief ? personaForId(rootBrief.persona ?? DEFAULT_PERSONA).name : 'Mayon'`);
  keep the "Mayon" brand as the brief-less fallback.
- **#4:** Dedupe in `TraceBuilder` (future traces) **and** composite each-keys
  in `DiagnosticsPanel` (repairs old + future traces).
- **#5:** 7 items per page on all three. Labs: slice the flat lab list, then
  group the slice by chat on the page. Trees: paginate root forests.
- **#6:** Spacious card design — each root is an elevated card with a prominent
  header and generous spacing.

---

## #1 — Stop the "missing chatId" tool result

- File `src/lib/agent/registry.ts`:
  - `list_artifacts` (def ~107): remove `chatId` from `parameters`
    (`toolSchema({ chatId: … })` → `toolSchema({})`). In `run(args, ctx)`, use
    `const chatId = ctx.chatId;` (delete the `if (!chatId) …` guard, or keep it
    asserting `ctx.chatId` truthy — it always is).
  - `summarize_progress` (def ~187): same change — drop the `chatId` parameter,
    use `ctx.chatId`.
- No other tool is affected (only these two carry the `missing chatId` summary).
- Note: this also removes a low-value place the model could hallucinate an id.

---

## #2 — ExpoundCard scrolls with the messages + full width

- File `src/lib/components/chat/ExpoundCard.svelte`:
  - Root div: change `self-start rounded-md …` → `w-full rounded-lg …`
    (drop `self-start`; keep/extend the border+`bg-card` styling).
- File `src/lib/components/chat/MessageList.svelte`:
  - Add an optional `header?: Snippet` prop; render `{@render header?.()}`
    as the **first** child of the outer `flex flex-col gap-4` container (so it
    picks up the existing `gap-4` spacing and scrolls with the rows).
- File `src/routes/chat/[id]/+page.svelte`:
  - Move the `{#if chatStore.chat?.parentId !== null && branchSource}` block
    (currently lines ~527-537, inside `topPane`) **out** of `topPane` and pass
    it to `<MessageList>` via the new `header` snippet. Keep the same
    `{@const formats = …}` / `<ExpoundCard …/>` content.
  - Result: the card now lives inside the scroll `viewport` (line ~544) and
    scrolls away with the messages; `topPane` keeps only breadcrumb + brief chip.

---

## #3 — Show the selected persona name on assistant messages

- File `src/routes/chat/[id]/+page.svelte`:
  - Import `personaForId`, `DEFAULT_PERSONA` (already imported).
  - Add a derived: `const personaName = $derived(rootBrief ? personaForId(rootBrief.persona ?? DEFAULT_PERSONA).name : 'Mayon');`
  - Pass `personaName` to `<MessageList … personaName={personaName}>`.
- File `src/lib/components/chat/MessageList.svelte`:
  - Add `personaName: string = 'Mayon'` prop.
  - Use it for the live-streaming label (replace the hardcoded `Mayon` at line
    ~62).
  - Forward `personaName` to each `<MessageRow>`.
- File `src/lib/components/chat/MessageRow.svelte`:
  - Add `personaName: string = 'Mayon'` prop.
  - Replace the static `roleLabel` map's `assistant: 'Mayon'` with a derived so
    the assistant entry uses `personaName` (e.g. compute the label inline, or
    `const assistantLabel = personaName;` and render that in the label span).
  - The user/tool/system labels are unchanged.

---

## #4 — Repair the chat-trace selection crash

- File `src/lib/agent/trace.ts` (`TraceBuilder.emit`):
  - In the `part` handler's `tool-call` branch (~148) and the `tool-call` kind
    handler (~164): before pushing, skip if `toolCallId` already exists in
    `this.current.toolCalls` (dedupe, keep-first). Apply the same dedupe to
    `toolResults` in the `part` `tool-result` branch (~154) and the `tool-result`
    kind handler (~175). Keeps the persisted JSON clean going forward.
- File `src/lib/components/diagnostics/DiagnosticsPanel.svelte` (robustness,
  also repairs historical traces):
  - `{#each iter.toolCalls as tc (tc.toolCallId)}` (~448) → key by
    `` {`${tc.toolCallId}@${i}`} `` (add index `i`).
  - `{#each iter.toolResults as tr (tr.toolCallId)}` (~477) → same composite
    key with index.
  - (Other each-blocks already key by index or by an aggregated unique field —
    leave them.)
- Leave `loop.ts` trace emissions as-is (dedupe absorbs the redundancy; the
  explicit execution-time emission is harmless once deduped).

---

## #5 — Paginate Chat / Labs / Trees (7 per page)

- New shared component `src/lib/components/ui/pagination/Pagination.svelte`
  (or `src/lib/components/Pagination.svelte` — pick the simpler path; no
  shadcn pagination exists today):
  - Props: `page: number = $bindable()`, `totalPages: number`.
  - UI: centered row — `Prev` (disabled at page 1) · `Page {page} of {totalPages}`
    · `Next` (disabled at last). Reuse `<Button variant="outline" size="sm">`.
- Each list page holds `let page = $state(1)`, a `$derived` slice of 7, and a
  `$derived` `totalPages = Math.max(1, Math.ceil(n/7))`. Reset `page = 1`
  whenever the source list changes (load, delete, regroup).
  - `src/routes/chat/+page.svelte`: `paged = roots.slice((page-1)*7, page*7)`;
    render `paged` in the `{#each}`; `<Pagination bind:page totalPages={…} />`
    under the `<ul>`.
  - `src/routes/lab/+page.svelte`: paginate the **flat** `labsStore.list` (newest
    first) by 7; then `regroup()` only the current slice (group the slice by
    chat, preserving order) so each page shows up to 7 labs with their chat
    headers. Recompute the slice + groups when `page` or the list changes.
  - `src/routes/tree/+page.svelte`: paginate `forests` (root trees) by 7;
    render `pagedForests`. (See #6 for the redesigned rendering.)
- Keep empty-state and loading-state branches exactly as they are.

---

## #6 — Spacious Tree page redesign (on top of #5)

- File `src/routes/tree/+page.svelte`:
  - Layout: widen to `max-w-5xl` with more page padding (`p-8`, `gap-6`).
  - Each root forest becomes an elevated card:
    `rounded-xl border border-border bg-card p-5 shadow-sm space-y-2`.
  - Root row: prominent — root title as a header
    (`text-base font-semibold text-foreground`), with a subtle depth/metadata
    badge (e.g. branch count or "root"). Keep the collapse caret.
  - Child rows: comfortable — larger row padding (`px-4 py-2.5`), rounded
    hover chip (`rounded-lg hover:bg-accent`), `text-sm`, and a deeper indent
    (`{depth * 1.5}rem`). Keep the current-node highlight
    (`bg-primary`/`text-primary-foreground`).
  - Add subtle per-node metadata where cheap (e.g. relative time from
    `chat.updatedAt`) without crowding.
  - Restyle the empty/loading states to match the new card language.
- Keep the recursive `row(node, depth)` snippet structure; only adjust spacing,
  typography, and the card wrapper.

---

## Failure modes / edge cases

- **#1:** If a provider stream ever delivered a chat with no `ctx.chatId`
  (impossible — `send()` guards on `chatId`), the tools would now read
  `ctx.chatId` directly; no regression.
- **#3:** A chat whose root brief sets an unknown `persona` value is impossible
  (`isPersonaId` guards persistence); `personaForId` is safe. Brief-less chats
  fall back to "Mayon" by design.
- **#4:** Composite keys are stable across renders (index is deterministic within
  a sorted iteration); old traces render without crashing.
- **#5:** Client-side pagination is fine — all lists already load fully from the
  local OPFS/Tauri SQLite. Deleting on a non-first page that becomes empty
  clamps `page` via the reset-to-1 rule (and `Math.max(1, …)`).
- **#2/#3:** Threading new props through `MessageList` is additive; defaults keep
  any other caller (`MessageList` is only used on `/chat/[id]`) green.

## Validation

- `pnpm test`:
  - `registry`/tools: `list_artifacts` and `summarize_progress` succeed without
    a `chatId` arg, using `ctx.chatId`; their parameter schemas no longer list
    `chatId`.
  - `trace`: a `part` `tool-call` followed by a `tool-call` kind for the same id
    yields a single entry in `iterations[*].toolCalls` (and same for results).
  - (Existing loop/registry tests stay green.)
- `pnpm check` (svelte-check) + `pnpm lint` (ESLint + Prettier `--check`).
- Manual gates:
  - #1: open a chat, Expound an excerpt → the branch streams a summary with **no**
    "missing chatId" tool row.
  - #2: on the expound branch the `ExpoundCard` spans the message width and
    scrolls up with the messages (not pinned at the top).
  - #3: select persona "Kit" in the brief → assistant rows and the live bubble
    read "Kit"; a brief-less chat still reads "Mayon".
  - #4: open the Diagnostics panel, select any chat trace (including older ones)
    → it renders without an `each_key_duplicate` crash; Tool Calls shows each
    call once.
  - #5: with >7 items on `/chat`, `/lab`, `/tree`, the list shows 7 and paginates;
    page resets to 1 after a delete; Labs groups the visible slice by chat.
  - #6: Tree page reads as breathable cards with clear hierarchy and comfortable
    spacing, paginated 7 roots/page.

## Out of scope

- Reworking tool-result rendering/styling (only the crash + identity source).
- Changing the expound prompt text or model behaviour beyond removing the
  `chatId` arg requirement.
- Server-side/infinite-scroll pagination (client slicing is sufficient here).
- Persisting collapsed-state or filters on the Tree page.
