# UI Refinement 02 — Thinking dot, callout spacing, remove top bar

Source request: `refinement/ui-refinement-02.md`. Four UI fixes. UI/markup only — no schema, DB, or business-logic changes.

## Affected files
- `src/lib/components/chat/Spinner.svelte`
- `src/lib/components/chat/Markdown.svelte`
- `src/lib/components/AppShell.svelte`
- `src/lib/components/Sidebar.svelte`
- `src/lib/components/chat/ChatRail.svelte`
- `src/routes/chat/[id]/+page.svelte`

## 1. Pulse ring follows its dot (Spinner.svelte)
**Root cause:** In the `pulse` variant, the pulsing ring is an `absolute`-positioned span, but its parent `.mayon-spinner` span is `inline-flex` (static). The ring therefore escapes to the nearest positioned ancestor — the chat `middleWrapper` (`relative`, **non-scrolling**) in `chat/[id]/+page.svelte:412` — so it stays glued to the page while the "Thinking…" dot scrolls inside `viewport` (`overflow-auto`).

**Fix:** Add `relative` to the `pulse` variant's outer `.mayon-spinner` span so the ring is contained by the spinning dot and scrolls with it.
- Change: `<span class="mayon-spinner inline-flex size-4 items-center justify-center {className}">` → add `relative`.
- The `orbit` variant animates the span itself (transform rotate), so it is unaffected; do not change it.

## 2. Callout breathing room (Markdown.svelte) — rendering only
Increase vertical margin on admonition boxes so they stand out. Touch only the CSS in the `<style>` block; do **not** change the markdown render/sanitize pipeline.
- `Markdown.svelte:176` `.callout` margin `0.5em 0` → `1.25em 0` (top & bottom; tunable during build).
- All variants (`.callout`, `.callout-warning`, `.callout-concept`) inherit this margin since the variant rules only override border/background.

## 3. Remove the top bar and rehouse its controls
The AppShell `<header>` holds: left = `PanelLeft` "Toggle sidebar" button; right = `DbStatus` + `ThemeToggle`. The Mayon icon already lives at the top of the left `Sidebar`. All controls relocate; the `<header>` is deleted.

### Decided placement (symmetric, outside each pane)
- **Left toggle:** floating button pinned to the **left edge of the main content column** (= just right of the left pane). Always visible whether the left pane is expanded (`w-60`) or collapsed (`w-16`); on mobile it opens/closes the drawer.
- **Right toggle:** floating button pinned to the **right edge of the chat content column** (= just left of the right rail). Always visible whether the rail is expanded (`w-72`) or collapsed (`w-12`); on mobile it opens the rail Sheet. Chat view only (the rail exists only on `/chat/[id]`).

### 3a. AppShell.svelte
- Delete the entire `<header>...</header>` block (lines ~98–122).
- Make the content column `relative`: `<div class="flex min-w-0 flex-1 flex-col">` → add `relative`.
- Add the floating **left** toggle as the first child of that column:
  - `absolute top-2 left-2 z-30`, ghost icon button.
  - Icon swaps by state: `PanelLeftClose` when expanded, `PanelLeft` when collapsed (mirror the ChatRail pattern).
  - `onclick`: if `lg` → toggle `collapsed`; else → toggle `drawerOpen` (existing behavior, just relocated).
- Move the `DbStatus` + `ThemeToggle` imports/usages out of AppShell and into `Sidebar.svelte` (and the mobile drawer clone, below).
- Keep `Toaster` where it is (sibling of `<main>`), unchanged.

### 3b. Sidebar.svelte (desktop pane) + AppShell mobile drawer clone
- Add a footer block after the `<nav class="flex flex-1 ...">` (so nav keeps `flex-1` and footer pins to the bottom):
  - **Expanded (`w-60`):** `DbStatus` badge + `ThemeToggle` side by side in a row, `p-2` / `gap-2`.
  - **Collapsed (`w-16`):** `ThemeToggle` only, centered (icon button fits the narrow pane). `DbStatus` text does not fit at `w-16` — render it icon-only (drop "DB ready · runtime" text) or hide it; keep the `title` tooltip so the status is still inspectable. Pick icon-only during implementation for parity.
- Mayon `M` icon + "Mayon" label stay at the top of the pane unchanged (now simply "part of the left pane", which it already structurally is).
- Apply the same footer to the mobile Sheet drawer markup in AppShell (the drawer already duplicates the nav) so the drawer also shows `DbStatus` + `ThemeToggle` at its bottom.

### 3c. ChatRail.svelte + chat/[id]/+page.svelte (right toggle)
- `ChatRail.svelte`: remove the internal collapse button (`absolute top-2 right-2 ...`, lines ~184–195). Keep `collapsed` as a `$bindable` prop (the trigger moves to the chat page).
- `chat/[id]/+page.svelte`:
  - Make the chat content column `relative`: `<div class="min-w-0 flex-1">` → add `relative`.
  - Add the floating **right** toggle pinned to that column's right edge:
    - `absolute top-2 right-2 z-30` (top-right of content = just left of the rail), ghost icon button.
    - Icon: `PanelRightClose` when rail expanded, `PanelRight` when collapsed.
    - `onclick`: on desktop (`lg`) → toggle `railCollapsed`; on mobile (`<lg`) → toggle `railOpen` (the right Sheet). Determine `lg` via the same `matchMedia('(min-width: 1024px)')` pattern already used in AppShell (add a small `lg` state + listener, or reuse a shared helper if one exists).
  - Remove the now-redundant inline `lg:hidden` `PanelRight` "Toggle rail" button from the chat top row (`+page.svelte:337–346`). Keep the **Tree** and **Diagnostics** buttons in that row.

## Implementation caveats (resolve during build)
- **Overlap risk:** top-aligned floating toggles may overlap centered `max-w-3xl mx-auto` content top corners (left: Breadcrumb; right: Tree/Diagnostics) on narrow widths. Verify at the `lg` breakpoint; adjust offset/spacing or switch the toggles to a vertically-centered "handle" position if collision can't be avoided. Default to top-aligned per "same place as now".
- **Collapsed footer:** confirm `DbStatus` icon-only rendering reads acceptably at `w-16`; otherwise hide it when collapsed (tooltip keeps it inspectable).
- **Mobile parity:** ensure the floating left toggle still opens the drawer when no inline sidebar is present, and the floating right toggle opens the rail Sheet on `<lg`.

## Out of scope
- Any change to markdown source/sanitize pipeline (issue 2 is CSS-only).
- New right pane on non-chat routes (the right toggle is chat-only).
- Theme persistence/DB wiring, store logic, schema, or Tauri/Rust.

## Validation
- `pnpm check` (svelte-check) and `pnpm lint` (ESLint + Prettier) pass.
- Manual (browser, `pnpm dev`):
  1. Pulse ring scrolls with the "Thinking…" dot when scrolling the chat (issue 1).
  2. Admonition boxes (Tip/Concept/Warning) show visibly more top & bottom spacing (issue 2).
  3. No top bar. Mayon icon at top of left pane; `DbStatus` + `ThemeToggle` at bottom of the left pane (and in the mobile drawer).
  4. Floating left toggle collapses/expands the left pane (desktop) and opens the drawer (mobile); stays visible in both pane states.
  5. On `/chat/[id]`, floating right toggle collapses/expands the rail (desktop) and opens the rail Sheet (mobile); rail's old internal button is gone.
  6. Theme toggle still persists across reload (settings KV unaffected).
