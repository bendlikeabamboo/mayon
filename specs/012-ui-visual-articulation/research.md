# Phase 0 Research: UI Visual Articulation Pass

**Feature**: `012-ui-visual-articulation` | **Date**: 2026-08-27
**Method**: Codebase exploration (file-level evidence cited) — all findings verified against working tree on `feat/ui_overhaul`. No open NEEDS CLARIFICATION items remained from planning; this file resolves implementation-direction questions raised by the Technical Context and by gaps between spec vocabulary and the as-built UI.

## R-1 Accent color system — where it lives

**Decision**: Define the warm amber/terracotta accent **inside the existing shadcn token slots** (`--primary`, `--primary-foreground`, `--ring`) in both `:root` and `.dark` blocks of `src/app.css` rather than minting a parallel "brand" namespace. Derive light-theme primary near the existing terracotta `--highlight: #a54d27` family, tuned for a solid-button role; tune `.dark` variant for identical perceptual intent at dark-appropriate lightness.

**Rationale**: GP-5 demands exactly one accent governing actionable emphasis; shadcn already routes button/link/focus-ring emphasis through `--primary`/`--ring`, so folding the accent into those slots gives app-wide consistency with zero new plumbing and keeps every existing `bg-primary`, `ring-ring` call site instantly correct. The existing palette leans warm-neutral OKLCH hues around 90 with one saturated warm outlier (`--highlight`), so anchoring to it guarantees harmonization (spec A-1).

**Alternatives considered**:
- *New dedicated tokens (`--brand`, `--brand-foreground`)* → rejected: duplicate emphasis channels invite drift and many components would need re-pointing; two sources of truth violate single-accent discipline.
- *Keep `--primary` neutral and style each control individually* → rejected: scatters the decision across dozens of files; review can't audit a one-hue rule.

**Ripple effects to inventory during tasks**: `UserMessage.svelte` uses `dark:bg-primary` for user bubbles — after retint it shares the accent family (acceptable; verify contrast of bubble text under GP-1); tree page "current node" uses `bg-primary text-primary-foreground`; dropdown/badge accents follow automatically.

## R-2 Surface ladder — tokens & recipes

**Decision**: Codify three roles per theme:
1. **canvas** = `--background` (page; AppShell `<main>` backdrop),
2. **panel** = sidebar/header structural regions (`--sidebar*` family already exists),
3. **raised card** = `--card` + hairline `border-border` + soft shadow.
Add a small set of elevation utilities/recipes in `src/app.css` (e.g., an `@utility` or component-layer class `surface-card` encoding `rounded-lg border border-border bg-card shadow-[soft]`) instead of repeating long class strings. Ladder deltas stay ≤ 2–3% OKLCH lightness steps; separation is carried primarily by border + shadow (GP-1). Dark theme ordering: `--sidebar` lightness nudged **below** `--background`; light theme: sidebar ≤ background (quietest), cards emphasized via edges/shadows.

**Rationale**: All five audited surfaces (`AppShell.svelte:80`, `Sidebar.svelte:40`, chat list rows, home rows, BriefCard) already speak this dialect (`rounded-lg border bg-card`); today shadows are effectively absent outside overlays/tree page (`shadow-sm`). Centralizing the recipe makes the SC-2 ladder testable and future edits one-place.

**Alternatives considered**: Large luminance jumps between levels → forbidden by GP-1 (eye-comfort ruling); replacing borders with elevation-only (Material-style layers) → rejected, fails "edges instead of brightness" rationale and degrades on low-contrast displays.

## R-3 Focus/hover visibility mechanics

**Decision**: Reuse `focus-visible:ring-*` idiom present in Composer/Send controls (`Composer.svelte:280`); after R-1 it reads as accent ring everywhere automatically. Hover tints use the established `hover:bg-accent` / `group-hover` patterns already in Sidebar nav and list rows. Add hover-reveal rows via `opacity-0 group-hover/message:pointer-events-auto group-hover/message:opacity-100` plus a `@media (pointer: coarse)` steady-visible override (tap parity, spec A-5) and keep motion-reduce exempt where transitions apply.

**Rationale**: Matches repo conventions; zero JS needed; keyboard reachability preserved because actions also remain reachable via focus traversal (`focus-within` reveal included).

**Alternatives considered**: Always-visible action buttons (current state for Branch/Regenerate) → rejected as the spec asks for hover-revealed consolidation; context-menu-only (status quo for copy) → rejected, undiscoverable (SC-5 targets a first-time viewer finding copy unaided).

## R-4 Composer instrument card

**Decision**: Restyle inside `Composer.svelte`: wrap the input row into a rounded-xl bordered card that owns background/border/focus ring and shadow; textarea loses its own visible box (`border-0 bg-transparent resize-none outline-none`) and card carries state; MCP/resources/prompt/thinking/send controls dock along the card's bottom edge inside its footprint; column width cap stays the parent's `max-w-3xl` (`chat/[id]/+page.svelte:519`) so the card aligns with the reading measure (spec FR-9 "near comfortable reading-column width"). Launcher chips render as a compact horizontal affordance row above/beside the docked controls. ⌘/Ctrl+Enter send path, draft persistence key `'draft:<chatId>'`, and stop behavior unchanged.

**Rationale**: Only one composer exists; layout width is already capped correctly at the parent, avoiding double-capping drift; preserving store contracts keeps regression risk at presentation layer only.

**Alternatives considered**: Full-bleed modern glassy floating bar (ChatGPT-like detached capsule overlapping content) → rejected: violates artifact-persistence/main-screen principle spirit (reads transient) and complicates the status/error cards directly above (`bottomPane`, :711–792).

## R-5 Artifact launchers wiring

**Decision**: Map launchers onto pre-existing persisted paths exactly:
| Launcher | Calls | Persisted result |
|---|---|---|
| branch here | if no active chat: `chatStore.createAndNavigate()` then `chatStore.branchFromMessage(null→root creation semantics)` using `chatsRepo.createRoot/createChild` + `branchSourcesRepo.create` | child conversation node |
| quiz me | ensure chat → `quizzesStore.generate(chatId)` (`quizzesRepo.create` → `quizQuestionsRepo.add` upstream) | quiz artifact bound to chat |
| open lab | ensure chat → `labsStore.generate(chatId)` / fallback `labsStore.saveRaw(...)` (`labsRepo.create`) | lab artifact |

Each activation shows immediate visible feedback (artifact appears in the main interface; chat navigates/open panel equivalent as existing flows do). Disable launchers with explanatory tooltip while generating/offline rather than hiding facts (GP-4 posture). Details and failure contract: `contracts/composer-launchers.md`.

**Rationale**: GP-3 requires persistence; these chains already guarantee rows written through repos; reusing them means no new storage logic and free test coverage inheritance.

**Alternatives considered**: "Draft-launcher staging area" before commit → rejected as modal-ish/transient risk; inline naming modal at creation → rejected by A-7 (inherit conversational topic for titles).

## R-6 Home rebuild

**Decision**: Recompose `src/routes/+page.svelte`: centered greeting heading → hero slot containing either the redesigned composer-lite (new-chat mode) or, when the most recent root chat is unfinished (heuristic: latest activity + not exhausted per existing completion signals available on chat objects), a prominent "continue learning" resume card linking into `/chat/[id]`; below: starter chips from `lib/chat/starters.ts` (derive seeds from current brief/curriculum context when available, else generic study seeds — A-3); Recent chats / In-progress labs / Recent quizzes demoted beneath in demure styling adopting RowCard mini-rows. Preserve loading/no-provider/no-content states, restyled.

**Rationale**: Directly implements FR-12…14 with data already fetched by the page (top-5 roots, labs checklist state, quizzes); ~70% dead whitespace converts into invitation without new data needs.

**Alternatives considered**: Separate landing route for logged-in users → rejected (architecture/density preservation); auto-forwarding into last chat → rejected (removes agency; breaks resume-card test expectation).

## R-7 Tree connectors + caret rotation

**Decision**: Within the recursive `row(node, depth)` snippet: replace ChevronRight/ChevronDown swap with a single chevron rotated via transform transition (motion-reduce snaps); add connector hints — a left guide rail segment (border-left on children container with elbow ticks via pseudo-element) so ancestry reads spatially even when indentation alone wouldn't convey it (FR-17). Keep `SvelteSet<string> collapsed` session memory (A-4; no persistence extension).

**Rationale**: Purely presentational upgrade to one file; recursion structure (`tree/+page.svelte:94–142`) stays; `buildSubtreeModel` untouched.

**Alternatives considered**: SVG edge-drawing layered tree (d3-style hierarchy diagram) → rejected: rebuild-grade change against the "pass, not rebuild" charter and density-preserving goal; collapsed-state DB persistence → rejected adds schema/KV surface without user pull (A-4 records default).

## R-8 Status chrome compression

**Decision**: New `StatusIndicator.svelte` renders one compact row: single icon-dot whose color aggregates state (green ready / amber self-check / red error / gray server-off) + text label like `server v0.x · db ready`; clicking (or focusing + Enter) opens a bits-ui popover listing full details currently spread across `DbStatus` + `ServerStatus` native titles: Postgres readiness/runtime label, server version, capability list, restoring flag — every existing fact retained (GP-4). Both legacy components become readout content modules consumed by the popover body (and mobile drawer in AppShell). Keyboard-operable via popover primitive's focus semantics.

**Rationale**: Two sibling pill components share idiom/state sources (`services/status.svelte.ts`, `stores/db.svelte.ts`), making merge mechanical; popover dependency exists (bits-ui v2) with no new package needed.

**Alternatives considered**: Keep two pills, shrink size → rejected: doesn't meet "single compact indicator" FR-18; move details to header-only → rejected: dev chrome belongs at sidebar's quiet corner per current IA; drawer-only → violates ≤2-actions metric on desktop.

## R-9 Header chip consolidation + per-chat persistence

**Decision**: As-built reality differs slightly from spec wording: header shows a brief-summary pill (`summarizeBrief(rootBrief)`) + persona-name pill, both opening BriefCard edit mode; raw practitioner/explainer live in BriefCard calibration selects. Consolidate both pills into **one summary chip** combining `summarizeBrief` output · persona name (which subsumes the level/mode summary intent of FR-19), with a chevron toggling the expanded BriefCard details panel. Expansion state persists **per chat** through settings KV convention documented in `contracts/settings-keys.md` (`ui-state:<chatId>:briefExpanded`), implemented by new `lib/chat/uiState.ts` over `repos.settings.get/set`. Once a title exists for the chat the chip renders collapsed-by-default; untitled/new chats keep expanded.

**Rationale**: Matches observable feature ("collapse into single chip w/ chevron once a chat title generated"); KV mechanism has precedent (`'draft:<chatId>'` string-convention keys, per-chat MCP config), so no schema/migration work and constitution-clean persistence.

**Alternatives considered**: localStorage only → rejected: device-bound, inconsistent with theme-pref precedent which mirrors to settings; new table → rejected: disproportionate schema growth for a display toggle.

## R-10 Unified RowCard grammar

**Decision**: Introduce `RowCard.svelte` with slots: leading meta/emphasis, `title`, trailing timestamp (`timeAgo`), optional progress line (badge-sized). Adopt in chat list, quiz list (progress slot = question count today; last-attempt score surfacing left to tasks if cheaply queryable from existing attempts data), lab list, and home mini-row variant. Standardize: raised-card treatment from R-2 + hover tint from R-3 + hover-revealed destructive action preserved.

**Rationale**: Five near-identical hand-rolled instances found (research §10); consolidating delivers FR-21 and shrinks future divergence.

**Alternatives considered**: Extending shadcn Card primitive instead → rejected: Card is container-chrome, not row anatomy; listbox/menu semantics don't fit navigation-anchor rows.

## R-11 Motion & loading honesty

**Decision**: First app-introduction of `svelte/transition` directives: subtle `fade`(+~4–8px `fly`) `in:` on route content roots with per-child stagger (~40–60 ms increments, total < 500 ms). Gate behind the global reduce-motion blocks pattern already in `app.css:434–449` (extend media block to strip transforms/animations added here) plus Tailwind `motion-reduce:` escape hatches used at `chat/[id]:698,704`. Skeletons: **none added** — audited load states are plain-text paragraphs over pglite/local fetches; convert nothing unless measured > ~300 ms (FR-23/A-6).

**Rationale**: Honors polish-story scope while making the perf-probe check meaningful (before/after frame timing on route entries); avoids speculative skeletons explicitly banned by the brief.

**Alternatives considered**: View-transitions API across routes → rejected: SvelteKit integration maturity/consistency cost for marginal gain; longer theatrical staggers → rejected by ≤500 ms budget and restraint principles.

## R-12 Warm charcoal dark theme

**Decision**: Retune `.dark` block neutrals toward warm undertone (low-chroma OKLC hues in the ~50–70 range at very low C values), keeping current lightness levels per element so perceived text softness (GP-1) and overall AA-fail-by-design softness remain byte-for-byte equivalent in luminance terms. Accent token per R-1 gets its own dark variant. Noise overlay/scrollbar/highlight palettes reviewed for warmth coherence.

**Rationale**: Single-file change reuses class-based dark mechanism (`src/lib/stores/theme.svelte.ts` untouched); SC-7's side-by-side warmth + unchanged-comfort gate validates.

**Alternatives considered**: True brown-tinted scheme at higher chroma → rejected: risks mud and fights paper-brand neutrality; OS-adaptive forced-colors changes → out of scope.

## R-13 Fonts audit (GP-2)

**Decision**: Confirmed: `--font-sans` AND `--font-serif` both resolve to the same `'Bpmf Huninn', Fira Sans, sans-serif` stack (`app.css:387–392`) ⇒ no serif glyphs render anywhere today and none will be introduced. Leftover inert assets (`@font-face` Newsreader/Fraunces declarations and files, `@fontsource/newsreader` import in `+layout.svelte:2–4`) are flagged as **optional hygiene removal** for tasks.md (net bundle win, IV-aligned), not required for this feature's acceptance.

**Rationale**: Turns SC-8 from hope into inspection fact; documents why serif absence persists structurally.

**Alternatives considered**: Removing serif token slot entirely → deferred: touching `--font-serif` consumers may exceed pass scope; harmless as-is.

## R-14 Testing & verification approach

**Decision**: For src/lib logic: colocated Vitest units (pglite driver where settingsRepo involved — e.g., uiState read/write/defaulting tests). For components: follow repo's source-text assertion convention (as in `MessageRow.mount.test.ts`) to pin critical structural markers (launcher buttons presence, RowCard anatomy classes, status indicator composition). Manual smoke per quickstart stories on `pnpm dev`; perf probe runs bracketing motion work; gates `pnpm check` → `pnpm lint` → `pnpm test`.

**Rationale**: Constitution II mandates tests for new `src/lib` behavior; component convention discovered in research §12 removes mount-tooling speculation; no server suite impact.

**Alternatives considered**: Adding jsdom/playwright harness → rejected: new toolchain investment out of scope for a restyle pass; snapshotting whole components → rejected brittle vs. the established text-assertion idiom.

---

### Resolved unknowns ledger

| # | Was unknown | Resolution |
|---|---|---|
| U-1 | Which token slot hosts "the" accent | R-1 |
| U-2 | How surface roles materialize without new deps | R-2 |
| U-3 | Popover availability | bits-ui v2 present; wrap as `components/ui/popover` (R-8) |
| U-4 | Where per-chat UI pref persists | settings KV convention (R-9 + contract) |
| U-5 | Actual chip content vs. spec wording | R-9 reconciliation |
| U-6 | Existing message actions inventory | R-3/R-5 context (branch button, regenerate-on-interrupted, selection menu copy) |
| U-7 | "continue/go deeper" referent | ChoicesOffer suggested-choice pills are the analog; accent applies there (R-1 ripple list) |
| U-8 | Loading state candidates for skeletons | None qualify (<300 ms observed types); policy codified (R-11) |
| U-9 | Serif contamination risk | None structurally; hygiene flag (R-13) |
