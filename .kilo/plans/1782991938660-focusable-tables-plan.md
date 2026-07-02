# Plan: Focusable / expandable markdown tables

Make rendered markdown tables explorable without breaking chat layout: each table
sits in an invisible scrollable box (horizontal + vertical, capped at ~50vh) with a
subtle always-visible **expand** button (top-left). Clicking it opens a focused
"preview" window (shadcn `Dialog`) showing the table at natural size with its own
scroll. Built generically so other elements (wide code blocks, images) can opt in
later by selector.

Mirrors the existing Mermaid post-processing pattern: markdown → sanitized HTML
string via `{@html}`, then DOM enhancement after injection.

## Decisions (confirmed)

- **Overlay primitive:** add shadcn-svelte `dialog` (bits-ui) — focus trap, body
  scroll lock, Escape, `aria-modal`, portal. Reusable; MermaidPreview migration is
  explicitly out of scope.
- **Inline vertical cap:** viewport-relative `max-height: 50vh` (internal vertical
  scrollbar only when exceeded).
- **Expand button:** always visible, subtle (`opacity-60` → `100` on hover/focus),
  top-left, sticky within the scroll box.
- **Reusability scope:** build the generic `enhanceFocusable` helper + shared
  `FocusModal` now; wire **tables only**. Non-table elements are a one-line
  selector addition later.

## Files

### 1. Install dialog primitive
```
npx shadcn-svelte@latest add dialog
```
Drops into `src/lib/components/ui/dialog/` (alias `ui` → `$lib/components/ui`,
per `components.json`).

### 2. New `src/lib/markdown/focusable.ts` — generic enhancer
Export:
```ts
enhanceFocusable(
  container: ParentNode,
  selector: string,                 // e.g. 'table'
  onExpand: (node: HTMLElement, label: string) => void,
  opts?: { maxHeight?: string; buttonLabel?: string }
): void
```
Behavior:
- For each `container.querySelectorAll(selector)` node **not** already marked
  `data-focusable`:
  - Wrap it: insert a `<div class="md-focusable" data-focusable>` around it with
    `position: relative; overflow: auto; max-height: 50vh; width: 100%;`.
  - Inject a `<button>` positioned absolutely top-left (`position: sticky` within
    scroll so it stays visible), `z-10`, `aria-label` = `buttonLabel ?? 'Expand'`,
    containing the `Maximize2` lucide icon (set via `innerHTML` SVG string, same
    style as the external-link icon injection in `Markdown.svelte`).
  - Wire `button.addEventListener('click', () => onExpand(node, label))`.
- Mark wrapper + skip already-marked nodes → **idempotent** (safe to re-run on
  every streaming tick).
- Return nothing; callers own the expand callback.

### 3. New `src/lib/components/chat/FocusModal.svelte` — reusable overlay
- Thin wrapper over `Dialog.*` (Content/Title/Close) from `$lib/components/ui/dialog`.
- Props: `{ open: boolean; title: string; onClose: () => void; node: HTMLElement | null }`.
- Content area: `~90vw × 90vh`, `overflow: auto`, padding.
- Renders the table via a deep **clone** (`node.cloneNode(true)`) using a Svelte
  action `use:mountNode={node}` that appends the clone to a target div on mount and
  removes it on cleanup. This keeps the live message DOM untouched.
- Overlay-click + Escape handled by bits-ui.

### 4. Edit `src/lib/components/chat/Markdown.svelte`
- Add state:
  ```ts
  let focusNode = $state<HTMLElement | null>(null);
  let focusTitle = $state('Table');
  ```
- In the **existing `$effect` keyed on `html`** (currently only wires external
  links), after the link loop add:
  ```ts
  enhanceFocusable(container, 'table', (node) => { focusNode = node; focusTitle = 'Table'; });
  ```
  Do **not** use `onMount` — the `$effect` re-runs as the table streams in;
  idempotency guard prevents double-wrap.
- Render at the bottom (next to the `MermaidPreview` block):
  ```svelte
  <FocusModal open={focusNode !== null} title={focusTitle} node={focusNode}
    onClose={() => { focusNode = null; }} />
  ```
- Table CSS change (`.markdown-body table`, ~line 163): set
  `display: block; width: max-content; min-width: 100%;` (drop forced `width:100%`).
  Narrow tables still fill width (`min-width:100%`); 18-col tables overflow into the
  wrapper's scrollbars. Keep border/padding/font styles.
- Button style classes live in `focusable.ts` (inline string) — no new global CSS
  needed beyond the table tweak.

## Validation

- `pnpm check` (svelte-check), `pnpm lint`, `pnpm test`.
- Add `src/lib/markdown/focusable.test.ts` (jsdom): given a container with a
  `<table>`, `enhanceFocusable` wraps it, adds the button, button `click()` fires
  `onExpand` with the node, and a second call does not double-wrap. (Confirm jsdom
  is available in the Vitest setup; if not, set `// @vitest-environment jsdom` at
  the top of the test file.)
- **Manual (`pnpm dev`, http://localhost:5173):** send/force a message containing
  (a) an 18-column table and (b) a ~1000-row table. Confirm:
  - Inline box scrolls both ways; table never exceeds ~50vh tall.
  - Chat message column gains **no** horizontal scrollbar.
  - Expand button (top-left) opens the focused `Dialog`; table is scrollable;
    overlay-click + Escape close; focus is trapped while open.
  - Narrow (2-col) tables still render full-width as before.

## Risks / notes

- **Streaming correctness:** enhancement must run in the `html`-keyed `$effect`
  (re-applies as tokens arrive), guarded by `data-focusable` for idempotency.
- **Stable message DOM:** modal shows a deep clone, never detaching the original
  table from the message.
- **Portal:** `Dialog` teleports to `body`, so the chat column's `overflow` cannot
  clip or scroll-jack the overlay.
- **Sanitization is unaffected:** enhancement runs after `rehype-sanitize`; the
  injected button/clone never touch raw markdown.
- **LabRunner.svelte** reuses `Markdown.svelte` for generated bodies — it gets the
  behavior for free, no extra wiring.

## Out of scope

- Migrating `MermaidPreview.svelte` to `Dialog`.
- Wiring non-table elements (wide code blocks, images) — only the selector hook is
  prepared; add in a follow-up.
- Copy-to-clipboard / persisted table view state.
