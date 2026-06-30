# UI/UX Refinement — Markdown polish, bubbles, mermaid preview, right rail

Phased plan for the seven items in `refinement/ui-refinement-00.md`. Each phase is
independently shippable and testable. Math (#5) is already implemented — spot-check only.

## Decisions (all resolved with the user)

1. **Expound mark (#1):** solid underline in `--highlight` (drop the dotted style).
   Click → small popover anchored at the mark showing the linked chat's **title + Open**
   action. Uses the existing `data-branch-chat` attribute already set by `Highlighter`.
2. **External links (#2):** absolute `http(s)` links → `--muted-foreground` + a small
   external-link icon, `target="_blank" rel="noopener noreferrer"`. Internal app links
   (`/chat`, `/lab`, …) keep the current blue underline. Implemented by DOM
   post-processing in `Markdown.svelte` (off the rehype-sanitize pipeline).
3. **Mermaid preview (#3):** click a rendered diagram → modal **Dialog** with pan + zoom
   via the `panzoom` dep (~3KB, reliable wheel + touch pinch).
4. **Right rail (#4, chat-page-only):** sections = Labs, Quizzes, Branches (children),
   Siblings, Parents (ancestors), Cross-links. Collapsible; collapses into the existing
   `Sheet` primitive on `<lg`. Keep the compact Breadcrumb header; move the Generate
   Lab/Quiz buttons into their rail sections (inline actions); Tree + Diagnostics stay in
   the header.
5. **Math (#5):** already shipped (`remark-math` + `rehype-katex` + `katex.min.css`, tested
   in `render.test.ts`). Spot-check only — no code.
6. **Bubbles (#6):** user messages right-aligned, Mayon left-aligned; keep small role
   labels (`You` / `Mayon`); cap bubble `max-width` ~75%.
7. **Rename (#7):** `Assistant` → `Mayon` everywhere it is shown to the user.

### Out of scope / assumptions
- The user-side label stays **"You"** (only `Assistant` → `Mayon` changes).
- The external-link icon is injected post-sanitize as a DOM node, so **no** sanitize-schema
  change is required.
- Math needs no code change beyond a manual verification step.
- No persistence/migration: all changes are presentational; no schema or DB touch.

---

## Phase 1 — Message & inline-markdown polish

### 1.1 Rename Assistant → Mayon (#7)
- `src/lib/components/chat/MessageRow.svelte:30` — `roleLabel.assistant` `'Assistant'` → `'Mayon'`.
- `src/lib/components/chat/MessageList.svelte:61` — the streaming bubble's hardcoded
  `Assistant` label → `Mayon`.
- Grep for any other user-facing `Assistant` string (diagnostics panels, approvals) and
  align only where it labels *the assistant role*.

### 1.2 Chat bubbles (#6)
- `src/lib/components/chat/MessageRow.svelte` — restructure the non-tool branch:
  - user role: outer column `items-end`; bubble container `max-w-[75%]` (or `max-w-prose`,
    whichever is smaller) right-aligned. Keep existing `bubbleClass.user`
    (`bg-[var(--highlight)] …`).
  - assistant role: outer column `items-start`; bubble `max-w-[75%]`, left-aligned.
  - Keep the small role label line above each bubble. The assistant `Branch` button stays
    on the assistant row's label line.
- `src/lib/components/chat/MessageList.svelte` — the streaming bubble already renders as a
  left assistant bubble; ensure it follows the same `max-w` + label (`Mayon`) styling.
- system/tool rows: leave as-is (they are not user/assistant bubbles).
- The `Highlighter` wraps assistant content only; alignment changes do not affect
  selection/expound logic.

### 1.3 External links (#2)
- Extract a pure predicate in a new `src/lib/markdown/links.ts`:
  `isExternalLink(href: string): boolean` → true only for `http:` / `https:` absolute URLs.
  Unit-test it (mirror `render.test.ts` style).
- In `src/lib/components/chat/Markdown.svelte`, add an `$effect` (keyed on the derived
  `html`) that, after each render, walks `container.querySelectorAll('a[href]')`; for each
  external link: add class `external-link`, set `target="_blank"` + `rel="noopener
  noreferrer"`, and append a small inline external-link SVG (lucide `ExternalLink` path).
  Internal links are left untouched.
- CSS in `Markdown.svelte <style>`:
  - `.markdown-body a.external-link { color: var(--muted-foreground); }`
  - keep the default `.markdown-body a` blue rule for internal links.
- The icon is appended as a DOM node after sanitize, so the sanitize schema is unchanged.
- Coexistence with `Highlighter`: decorating anchors mutates the DOM and trips the
  `Highlighter` MutationObserver, but its signature guard (`fullText` + span ids) is
  unchanged → `renderUnderlines()` is a no-op. Verify no loop.

### 1.4 Expound mark styling + click popover (#1)
- `src/app.css:246` `.expound-mark` — change to a **solid** `--highlight` underline:
  - `text-decoration: underline;`
  - `text-decoration-style: solid;`
  - `text-decoration-color: var(--highlight);`
  - `text-decoration-thickness: 2px;`
  - keep `cursor: pointer;`
  - drop the dotted style; remove the `--accent` background wash (cleaner) OR keep a very
    faint `--highlight` tint — confirm visually, default to dropping it.
- `src/lib/components/chat/Highlighter.svelte` — add a delegated click handler on the
  container: when the click target is (or is inside) a `.expound-mark`, read
  `data-branch-chat`, lazily fetch the chat title via `repos.chats.get(id)`, and open a
  small popover anchored near the clicked mark showing **title + an `Open` link**
  (`/chat/<id>`).
- New tiny component `src/lib/components/chat/ExpoundMarkPopover.svelte` (hand-built,
  ContextMenu-style: fixed position clamped to viewport, close on outside pointerdown /
  Escape / scroll). Reuse the positioning/close patterns from `ContextMenu.svelte`.
- This is a **left-click** interaction; it must not collide with the existing
  **right-click** selection → `ContextMenu` (Expound…/Copy). Keep them on separate events.

### 1.5 Math spot-check (#5)
- No code. Manual only: send a message containing `$a^2+b^2=c^2$` and a `$$\int_0^1 x\,dx$$`
  block; confirm both render. Note result in the PR.

### Phase 1 validation
- `pnpm check`, `pnpm lint`, `pnpm test` (add `links.test.ts`; existing tests must pass).
- Manual (`pnpm dev`): rename shows `Mayon`; user bubble right + Mayon bubble left, capped;
  external link is muted + icon + new tab, internal link stays blue; expound mark is a
  solid highlight underline and its popover shows the linked chat title + Open; math renders.

---

## Phase 2 — Mermaid interactive preview (#3)

### 2.1 Add primitives/dep
- `pnpm add panzoom`.
- Add a shadcn-svelte `dialog` primitive under `src/lib/components/ui/dialog/` (bits-ui
  `Dialog`, consistent with the existing `button`/`sheet` primitives). Provides focus trap,
  Esc-to-close, overlay.

### 2.2 Click → pan/zoom modal
- `src/lib/components/chat/Markdown.svelte` — after a mermaid SVG is swapped in, make the
  wrapper clickable (`cursor-zoom-in`, `title="Click to preview"`). On click, open the
  `Dialog` with the same SVG cloned into a full-bleed pan/zoom surface.
- New `src/lib/components/chat/MermaidPreview.svelte`:
  - hosts the Dialog content; lazily `import('panzoom')` on mount (keeps it out of the main
    bundle until used).
  - applies panzoom to the SVG host; provides a **Reset** button (panzoom reset) and a
    **Close** affordance (the Dialog handles Esc/overlay).
  - ensure the SVG scales (viewBox present; `width/height: auto` / `max-size: none` so zoom
    is unbounded).
- Keep the inline SVG behaviour otherwise unchanged (still `overflow-x-auto` for reading).

### 2.3 Tests
- No meaningful unit test for pan/zoom; keep `render.test.ts` mermaid block test green.
- Optionally extract `isMermaidBlock(el)` and unit-test it.

### Phase 2 validation
- `pnpm check`, `pnpm lint`, `pnpm test`.
- Manual: render a ```mermaid fenced block; click it; pan (drag), zoom (wheel / pinch),
  Reset, close (Esc / overlay / click-out). Confirm mid-stream render still becomes clickable.

---

## Phase 3 — Right navigation rail (#4)

### 3.1 New component
- `src/lib/components/chat/ChatRail.svelte` — chat-page-only right panel. Props: the data
  already loaded in `chat/[id]/+page.svelte::loadNav` (`breadcrumb` (parents), `children`,
  `siblings`, `labs`, `quizzes`, `chatId`) plus callbacks (`onGenerateLab`,
  `onGenerateQuiz`). The `CrossLinks` component is rendered inside the rail as-is.
- Sections (each a labelled block; render only when non-empty):
  1. **Parents** — vertical ancestor list root › … › current (reuse the `Breadcrumb` data;
     render as a stacked list of links, current = non-link).
  2. **Branches (children)** — link chips.
  3. **Siblings** — link chips.
  4. **Labs** — link chips **+ inline "Generate lab"** button (moved from the header).
  5. **Quizzes** — link chips **+ inline "Generate quiz"** button (moved from the header).
  6. **Cross-links** — `<CrossLinks chatId>`.
- Collapsible state: local `$state` (mirror the left `Sidebar` `collapsed` pattern) with a
  header toggle (`PanelRight` icon). On `<lg`, the rail content renders inside the existing
  `Sheet` primitive instead of a pinned column; the same toggle opens/closes the Sheet.

### 3.2 Refactor the chat page layout
- `src/routes/chat/[id]/+page.svelte`:
  - Change the outer container from a single `mx-auto max-w-3xl flex-col` column to a flex
    row: `[chat column: flex-1 min-w-0]` + `[ChatRail: w-72 shrink-0, hidden on <lg]`.
  - Keep the chat column content centered: inner `mx-auto max-w-3xl`.
  - Move the rail toggle button into the chat header (next to Tree/Diagnostics) for `<lg`
    and as the collapse control on `lg+`.
  - Remove the bottom Labs/Quizzes/Branches/Siblings block (current lines ~423–509) — now
    in the rail.
  - Remove the top `<CrossLinks>` render (line ~282) — now in the rail.
  - Keep the compact `<Breadcrumb>` in the header (parents also appear in the rail; the
    header one is the compact "you are here").
  - Remove the **Generate lab / Generate quiz** buttons from the header; pass
    `onGenerateLab` / `onGenerateQuiz` into `ChatRail`.
  - Keep **Tree** and **Diagnostics** buttons in the header.
- Ensure the existing error/raw-offer/gate banners and `Composer` stay in the chat column.

### 3.3 Responsive / a11y
- `lg+`: pinned rail (`w-72`), toggle collapses it.
- `<lg`: rail hidden; toggle opens a `Sheet` (right side) containing the same sections.
- Preserve keyboard reachability of all links/buttons; the Sheet handles its own focus.

### Phase 3 validation
- `pnpm check`, `pnpm lint`, `pnpm test` (logic in `loadNav` is untouched; existing tests
  must pass).
- Manual (`pnpm dev`, resize across `lg`/mobile): all six sections appear and are correct;
  Generate lab/quiz work from inside the rail; toggle collapses/expands; on narrow width
  the rail opens as a Sheet; messages remain readable (chat column stays centered, ~max-w-3xl).

---

## Cross-cutting notes
- `Markdown.svelte` post-processing (external links) and the `Highlighter`
  MutationObserver share the assistant container; the signature guard prevents loops —
  verify during Phase 1.
- External-link icon and the expound popover are injected post-sanitize; the rehype-sanitize
  schema (`render.ts`) is **not** modified.
- Bundle: `panzoom` (~3KB) and the `dialog` primitive are small; mermaid + panzoom stay
  lazy. No impact on the P5 desktop transport/keychain/CSP gates (presentational only).
- No DB/schema/migration changes; run `pnpm db:generate` is **not** required.

## Rollout
- Land phases in order (1 → 2 → 3). Each is a self-contained PR with its own
  `check`/`lint`/`test` + manual gate. No data migration; no coordination with the desktop
  build beyond the standard `pnpm tauri:build` smoke (unchanged behaviour).

## Open follow-ups (not in scope)
- Streaming-safe mermaid rendering (today's `onMount` runs once; mid-stream fenced blocks
  appear after the handler ran). Out of scope here; file separately if observed.
- Richer expound popover (message preview) and equation numbering / mhchem — deferred.
