# Mobile & Tablet UI/UX Polish Plan

Goal: make Mayon feel native and fully usable on phones (320–640px) and tablets (640–1023px) **without changing any feature or capability**. Every fix either (a) makes an existing feature reachable on touch, (b) fixes layout/viewport defects, or (c) improves touch ergonomics.

## Context (from audit, 2026-10-01)

Pure SPA (`ssr = false`, `src/routes/+layout.ts:3`). Breakpoints today: JS `matchMedia` per component at 1024px (AppShell sidebar drawer `AppShell.svelte:47`, chat rail sheet `chat/[id]/+page.svelte:485`) and 1280px (settings `MobileSectionJump.svelte:14`); almost no structural Tailwind breakpoint classes. Existing good patterns to reuse: coarse-pointer action parity (`AssistantMessage.svelte:213–221`), touch-aware SectionStrip (`SectionStrip.svelte:86`), exemplary mobile FAB + bottom sheet with dvh/safe-area (`MobileSectionJump.svelte:37–68`).

Key defects found: `h-screen w-screen` viewport bug (`AppShell.svelte:77`), no `viewport-fit=cover`/safe-area strategy outside settings, hover-only affordances unreachable on touch (RowCard delete `RowCard.svelte:82`, code copy `Markdown.svelte:343–361`, `.tip` tooltips `app.css:557–578`), DiagnosticsPanel sheet fixed `w-[480px]` overflows phones (`DiagnosticsPanel.svelte:202`), markdown tables clipped (`Markdown.svelte:293–300`), tree-page invisible-but-tappable delete + 16px carets (`tree/+page.svelte:112–156`), non-wrapping MCP header/env rows (`McpServers.svelte:673, 714, 957, 1049`), sub-16px inputs → iOS focus zoom, breadcrumb unbounded wrap, SectionStrip 16px hit targets, triplicated matchMedia with desktop FOUC (`lg`/`xl` start `false`), duplicated drifted nav markup (AppShell drawer vs `Sidebar.svelte`).

## Decisions (resolved with user)

- **Mobile shell:** keep the floating hamburger/rail toggles (no top bar, breakpoints unchanged at 1024/1280). Fix them: raised-card backing, ≥40px targets, reserved top space on `<lg` pages.
- **Design grammar:** follow `docs/history/012-ui-visual-articulation.qmd` — articulate with hairlines + raised cards, never brighter text; existing tokens only; respect reduced-motion.
- **Touch detection convention:** CSS `(any-pointer: coarse)` (covers hybrid devices better than `pointer: coarse`); JS touches keep `(hover: none), (pointer: coarse)` where already present.
- **Out of scope:** visual redesign, new features, navigation redesign, breakpoint changes, `visualViewport`/keyboard-inset engineering, replacing native `confirm()` dialogs.

Worktree bootstrap before implementation: `pnpm install` && `pnpm --filter @mayon/shared build`.

## Workstream A — Shell & viewport foundation (do first; others depend on conventions it sets)

1. **Viewport fix:** `AppShell.svelte:77` → `h-dvh w-full` (drop `h-screen w-screen`). `src/app.html:6` → `content="width=device-width, initial-scale=1, viewport-fit=cover"`.
2. **Shared media-query rune:** new `src/lib/utils/media.svelte.ts` — `mediaQuery(query: string)` returning a reactive `{ matches }` initialized synchronously from `window.matchMedia` (safe: no SSR) with a listener updated inside `$effect` (auto cleanup). Replaces the three hand-rolled subscriptions: `AppShell.svelte:39,46–52`, `chat/[id]/+page.svelte:89–91,484–490`, `MobileSectionJump.svelte:14` — kills the desktop FOUC flash and the drift risk.
3. **Floating toggles:** give the AppShell hamburger (`AppShell.svelte:121–140`) and chat rail toggle (`chat/[id]/+page.svelte:722–741`) a raised-card pill backing (`bg-card border shadow-[--shadow-card] rounded-lg`), ≥40px hit area (p-2 + size-4 icon or `size-10`), keep `.tip` + aria-label.
4. **Reserved top space on <lg:** add `max-lg:pt-14` (Tailwind v4 supports `max-lg:`) to the scroll containers' content top on pages whose content starts flush: chat main column (`chat/[id]/+page.svelte:742`), and verify home/chat-list/lab/quiz/search/tree/settings headers clear the 44px toggle zone; adjust per page as needed.
5. **Drawer nav parity + ergonomics:** extract the nav item list into one shared module (e.g. `src/lib/components/nav-items.ts` or a `NavLinks.svelte` used by both) so the drawer (`AppShell.svelte:86–115`) regains the active-pill treatment from `Sidebar.svelte:80–85`; raise drawer + sidebar link targets to ≥40px (`py-2.5`), and ThemeToggle/StatusIndicator triggers in the drawer footer to ≥36–40px.
6. **Safe areas + toaster:** `Toaster.svelte:9` → `bottom-[calc(1rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))]`; add `env(safe-area-inset-bottom)` padding to the chat bottomPane and AppShell main on coarse/standalone. Tests: unit test for the media rune; render test asserting drawer nav has the active-pill class (mirror `MobileSectionJump.render.test.ts` style).

## Workstream B — Touch reachability of gated affordances

1. **RowCard actions** (`RowCard.svelte:82`): under `@media (any-pointer: coarse)` always show the action slot and drop `pointer-events-none` so Delete is visible AND tappable on mobile (fixes /lab + /quiz index pages). Keep hover-gating on fine pointers.
2. **Code copy button** (`Markdown.svelte:343–361`): add coarse-pointer override making `.md-copy-btn` opacity-1 (mirror the AssistantMessage pattern).
3. **`.tip` tooltips on touch** (`app.css:557–578`): also display on `:focus-visible` and `:active`. For disabled buttons whose tip carries a functional reason (composer launchers `Composer.svelte:454,467,484`, rail toggle, toolbar buttons `chat/[id]/+page.svelte:726–853`), switch to the `aria-disabled="true"` + styled-disabled pattern (button stays clickable, click handler no-ops) so `:active` fires on touch and the reason is visible. Scope strictly to the chat-listed buttons.
4. **SectionStrip hit targets** (`SectionStrip.svelte:105,113`): widen the tap area via padding to ≥24px wide × taller, keeping the visual bar size; no JS wheel/touch handlers (respect `SectionStrip.contract.test.ts`).
5. **AssistantMessage actions** (`AssistantMessage.svelte:213–221`): switch the coarse override to `(any-pointer: coarse)` for hybrid-laptop touchscreens; keep the existing test passing (update its selector if it greps the exact media text — `AssistantMessage.actions.test.ts:39–41`).
6. **FocusModal trigger** (`Markdown.svelte` `.md-focusable-btn`): raise opacity/size on coarse pointers so the table-focus escape is discoverable on touch. Tests: RowCard coarse render test (mock matchMedia like existing suites), Markdown copy coarse test.

## Workstream C — Chat screen polish (primary surface)

1. **Breadcrumb truncation** (`Breadcrumb.svelte:13–33`): single-line with `min-w-0` + ellipsis; on narrow widths collapse middle ancestors to `…` (keep root + current, both clickable). No unbounded `flex-wrap`.
2. **Toolbar row** (`chat/[id]/+page.svelte:748–859`): ensure it never overflows at 320px — breadcrumb gets `min-w-0 flex-1`, buttons stay `shrink-0`; reduce gaps `gap-1` under `sm:`.
3. **Composer footer** (`Composer.svelte:428–669`): under `sm:`, the three text launchers (branch here / quiz me / open lab) become icon-only with aria-label + `.tip` (feature parity preserved, just compact); allow right-side dropdown triggers to wrap; send/stop ≥40px; keep `flex-wrap` fallback.
4. **Markdown tables** (`Markdown.svelte:293–300`): replace the clipped `width: max-content` + parent `overflow-x: hidden` combination with a scrollable block (`overflow-x: auto` wrapper, `-webkit-overflow-scrolling: touch`); tables scroll instead of clipping.
5. **Expound overlays**: `ExpoundPromptConstructor.svelte:48–54` → `w-[min(20rem,calc(100vw-1rem))]`; verify ContextMenu/ExpoundMarkPopover clamps hold at 320px.
6. **Rail sheet** (`chat/[id]/+page.svelte:1145–1167`): keep the Sheet pattern; only bump touch targets of rail chips/links to ≥40px if they measure below. Tests: extend chat page render tests for breadcrumb collapse; visual smoke via Playwright at 375×812.

## Workstream D — Secondary pages & shared components

1. **DiagnosticsPanel sheet** (`DiagnosticsPanel.svelte:202`): `w-[480px] sm:w-[540px]` → `w-full max-w-[540px] sm:w-[540px]`; make the header filter/clear row wrap.
2. **Tree page** (`tree/+page.svelte`): `p-8` → `p-4 sm:p-8`; caret buttons get ≥40px hit area (padded button around `size-4` icon); delete button visible on coarse pointers AND `pointer-events-none` while invisible on fine pointers (fix the invisible-but-tappable trap at `:145`); header row `flex-wrap`.
3. **McpServers rows** (`McpServers.svelte:673,714,957,1049`): header/env-var editor rows get `flex-wrap` with responsive input widths (`w-full sm:w-auto sm:min-w-[8rem]`); server-row header (`:816–901`) wraps badges/actions on narrow widths.
4. **iOS input zoom:** in `src/app.css`, under `@media (max-width: 640px)` set `input, textarea, select { font-size: 16px; }` (scoped rule; accept the minor density change). Fix the unstyled native select in `ChatDisplayConfig.svelte:72` with standard input classes.
5. **Small touch targets:** Pagination buttons → `size-9` under coarse; QuizRunner jump chips (`QuizRunner.svelte:77–94`) ≥40px hit area on coarse; Invites/Sessions/Activity date rows keep `flex-wrap` (verify only).
6. **Lab/quiz runner headers** (`LabRunner.svelte:29`, `QuizRunner.svelte:27`): `flex-wrap` + `gap-2` so titles + actions stack on narrow. Tests: DiagnosticsPanel width render assertion update; tree delete coarse test.

## Workstream E — Validation

1. `pnpm check`, `pnpm lint`, `pnpm test` (all green; worktree bootstrapped first).
2. New/updated component tests listed per workstream (contract + render style, matching `AssistantMessage.actions.test.ts`, `SectionStrip.contract.test.ts`, `MobileSectionJump.render.test.ts`).
3. Playwright spot-check at 375×812 and 820×1024, light + dark: drawer opens, RowCard delete tappable, code copy visible, tables scroll, diagnostics sheet fits, composer footer usable, no horizontal page overflow.
4. Manual desktop regression at 1440px: no FOUC flash on load, sidebar/rail collapse behavior unchanged, hover tooltips still work.

## Risks & mitigations

- `viewport-fit=cover` exposes content under notches → paired safe-area padding lands in the same task (A6); audit fixed elements (Toaster, FABs, sheets) before merge.
- `any-pointer: coarse` shows actions permanently on hybrid laptops → accepted tradeoff, consistent with touch parity; density impact reviewed in Playwright spot-check.
- `max-lg:pt-14` shifts scroll origin → verify stick-to-bottom sentinels in chat still fire (`chat/[id]/+page.svelte:946–996`).
- aria-disabled conversion changes click-flow for gated buttons → each converted button's no-op path gets a render test.
- SectionStrip padding must not reintroduce pointer handlers → contract test already guards this.

## Execution notes

Group into ≤6-task subagents: A first (sets the media rune + shell conventions), then B, C, D in parallel; E last. No file in two parallel groups except `app.css` (B3, D4) and `chat/[id]/+page.svelte` (A4, C2, C6) — sequence those two pairs or assign whole-file ownership to one group each.
