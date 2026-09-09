# Fix mermaid diagrams unreadable in dark mode

## Problem

Mermaid diagrams render with black text/lines on the app's dark background. Root
cause: `src/lib/markdown/mermaid.ts:38-42` initializes mermaid once with a
hardcoded `theme: 'default'` (a light-background theme). SVG colors are baked in
as inline attributes at render time, so CSS cannot restyle them per theme.

## Decisions (user-confirmed)

1. **Palette:** use mermaid's builtin `theme: 'dark'` when resolved theme is
   dark, `'default'` when light. No custom themeVariables.
2. **Live re-render:** already-rendered diagrams re-render when the resolved
   theme flips (including OS-level flips while preference is `system`).

## Background mechanics

- `Markdown.svelte` (src/lib/components/chat/Markdown.svelte:31-71) swaps
  `code.language-mermaid` blocks → `.mermaid-pending` placeholder →
  `.mermaid-svg` wrapper (`{@html svg}`) after async render. Skipped while
  `live` (streaming).
- `MermaidPreview.svelte` reads the wrapper's `innerHTML` at click time →
  inherits re-renders automatically; no changes needed.
- `themeState.resolved` (src/lib/stores/theme.svelte.ts:30) is **not reactive**
  to OS flips while `preference === 'system'`: the matchMedia listener
  (theme.svelte.ts:25) only toggles the `.dark` class, touching no `$state`.
- All markdown surfaces (chat, labs via `LabRunner.svelte`, quizzes) go through
  `<Markdown>`, so one fix covers all.
- Invariant safety: `.mermaid-svg` is already in `EXCLUDED_CHROME_SELECTORS`
  (src/lib/chat/selection.ts:34) and mermaid segments have `rendered: ''` in
  the source map — in-place innerHTML swaps do not affect expound alignment.

## Tasks

### 1. Make resolved theme reactive (`src/lib/stores/theme.svelte.ts`)

- Add a private `systemDarkNow = $state(systemDark())` field, initialized in
  the constructor; update it inside the existing matchMedia `change` listener
  (alongside `applyTheme`).
- `resolved` getter returns based on `systemDarkNow` for `preference ===
  'system'`. No behavioral change otherwise; it just makes `resolved` trackable
  inside `$effect`.

### 2. Theme-aware mermaid initialization (`src/lib/markdown/mermaid.ts`)

- `getMermaid(theme: 'light' | 'dark')`: keep the lazy-import singleton, but
  track the last-initialized theme; when it differs, call `api.initialize()`
  again with the same options and `theme: dark ? 'dark' : 'default'`.
  (Re-calling `initialize` is the documented way to change mermaid config; it
  must happen before subsequent `render` calls.)
- `renderMermaidBlock(source)` reads `themeState.resolved` (import from
  `$lib/stores/theme.svelte.js`) and passes it to `getMermaid`.

### 3. Re-render diagrams on theme flip (`src/lib/components/chat/Markdown.svelte`)

- In the initial render `.then`, stamp on the wrapper:
  `wrapper.dataset.mermaidSource = source` and
  `wrapper.dataset.renderedTheme = themeState.resolved`.
- Add a `$effect` tracking `themeState.resolved` (guard: skip when `live` or no
  container). When the resolved theme changes, re-render every
  `.mermaid-svg[data-mermaid-source]` whose `renderedTheme` differs:
  call `renderMermaidBlock(dataset.mermaidSource)`, replace the wrapper's
  `innerHTML` **in place** (do not `replaceWith` — the click listener and
  dataset must survive), then update `renderedTheme`. On failure, swap in the
  same red error note used by the initial path.
- Close the race with in-flight initial renders: extract a `syncMermaidTheme()`
  helper (re-render all stale wrappers); call it from both the `$effect` and
  the end of each initial `.then`, so a render that started under the old theme
  and lands after a flip gets immediately corrected.
- Optional consistency guard: keep renders within one Markdown instance
  sequential (simple `for` + `await`) to avoid interleaved mermaid renders.

### 4. Tests

- E2E (`tests/e2e/render.spec.ts` + `tests/e2e/fixtures/render.ts`): extend the
  kitchen-sink mermaid test —
  - assert the wrapper gains `data-rendered-theme` matching the active mode;
  - add a case that flips the theme (e.g. onboard with `colorScheme: 'dark'`
    in the Playwright context, or click the ThemeToggle) and asserts the
    re-render: `data-rendered-theme="dark"` and the SVG is still visible.
  - Keep assertions on dataset/visibility (stable), not on exact mermaid color
    values.
- Unit: `pnpm test` must stay green (mermaid.ts is DOM-only and not node-unit-
  tested; theme.svelte.ts change is exercised by existing suites).
- `pnpm check` and `pnpm lint` pass.

### 5. Changelog

- Add a line under `## [Unreleased]` in `CHANGELOG.md` describing the fix.
  (No release/tag work — separate flow.)

## Risks / notes

- Mermaid's builtin `dark` theme may sit at a different contrast level than
  the app's deliberately low-contrast palette; if it clashes, the follow-up is
  `theme: 'base'` + `themeVariables` from computed CSS vars (explicitly out of
  scope for now).
- A preview modal open during a theme flip shows the old SVG until reopened —
  acceptable; the underlying wrapper is already corrected.
- Diagrams re-render with a fresh SVG id each time (`mmd-<ts>-<n>`), so no id
  collision on re-render.

## Validation

1. `pnpm dev`, open a chat with a mermaid diagram (mock-LLM kitchen sink works:
   tests/fixtures/mock-llm/kitchen-sink.md).
2. Toggle theme light ↔ dark → diagrams re-render with readable
   text/lines in both modes; fullscreen preview matches.
3. Set theme to `system`, flip OS appearance → same result without reload.
4. `pnpm test`, `pnpm check`, `pnpm lint`.
