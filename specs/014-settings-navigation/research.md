# Phase 0 Research: Settings Page Navigation

**Feature**: 014-settings-navigation | **Date**: 2026-08-28
**Input**: spec.md; codebase investigation (settings shell, AppShell, capability store, ui primitives, routing, responsive conventions, test setup, design tokens).

## R1. Section inventory (spec assumption corrected)

**Decision**: The navigation index mirrors the page's real sections, in DOM order: `providers`, `mcp`, `learner-profile`, `expound-instructions`, `lab-prompt`, `quiz-prompt`, `data`, `sandbox-db` (conditional on `sandbox-db` capability). All are `h2` with the shared recipe `text-sm font-semibold uppercase tracking-wide text-muted-foreground`; "Providers" is owned by the settings shell itself, the rest are child components rendered via the shell's `{@render children}` slot.

**Rationale**: Verified by reading `src/routes/settings/+page.svelte`, `src/lib/components/ai/ProviderConfig.svelte` (h2 "Providers" at :393, `{@render children?.()}` at :698), and each section component (McpServers.svelte:537, LearnerProfileConfig.svelte:91, ExpoundInstructionsConfig.svelte:114, LabPromptConfig.svelte:51, QuizPromptConfig.svelte:51, DataSection.svelte:186, SandboxDbSection.svelte:69). The spec's original assumption listed only 3 sections; it has been corrected in spec.md (Assumptions). "Backup second-from-bottom" holds: Data is second-from-bottom when Sandbox DB is present.

**Alternatives considered**: Regrouping sections for navigation (rejected — playthrough verdict freezes order and content); deriving the index from heading DOM queries at runtime (rejected — spec mandates a static, maintained index; DOM-derived labels would silently track renames while aliases rot, and conditional logic would still live in code).

## R2. Scroll container and spy target

**Decision**: All scrolling, observation, and programmatic scrolling target the app shell's `<main>` element (`src/lib/components/AppShell.svelte:142` — `min-h-0 flex-1 overflow-y-auto` inside a `h-screen overflow-hidden` root at :77), not `window`. Components obtain it by walking up from their own element (`el.closest('main')`) or accepting a container element prop.

**Rationale**: `/settings` scrolls inside `<main>`; `window` never scrolls (its `scrollY` stays 0), so window-based spy/scroll code would silently no-op. Precedent for container-targeted scroll code exists (`src/lib/chat/scroll-bus.ts` re-points its listener at an HTMLElement; chat viewport scrolling at `src/routes/chat/[id]/+page.svelte:770`).

**Alternatives considered**: Adding an inner scroll container to the settings column (rejected — changes global scroll semantics for no benefit); `scrollIntoView()` on section elements only (works for jumps, but insufficient for the spy which needs viewport-relative positions inside a specific root).

## R3. Section anchors (DOM ids)

**Decision**: Give each section a stable anchor id with Tailwind `scroll-mt-*` (scroll margin) so landed headings have breathing room:
- `providers`: add `id="providers"` to the shell-owned section in `ProviderConfig.svelte` (the one small shell edit).
- The seven child sections: wrap each child component in the route file with `<div id="…" class="scroll-mt-4">` in `src/routes/settings/+page.svelte`, avoiding edits to six unrelated components. Wrappers are also the observation targets.
- `sandbox-db` wrapper is inside the existing `{#if serverStatus.has('sandbox-db')}` block, so the anchor disappears with the section automatically.

**Rationale**: No `id=` attributes exist anywhere on the page today (verified). Wrapping at the composition point is the minimal-diff way to get stable, spy-able, hash-targetable elements; native hash navigation then works (`#data` resolves to an element) and FR-012's conditional behavior falls out of the existing capability gate.

**Alternatives considered**: Adding ids inside every section component root (rejected — six file edits for the same result, higher blast radius); observing headings instead of wrappers (rejected — `scroll-mt` and stable observation boxes are cleaner on wrappers; headings are inline-ish and move with sibling margins).

## R4. Scroll-spy mechanism

**Decision**: One `IntersectionObserver` with `root = <main>`, `rootMargin` tuned as a horizontal detection band around the top of the viewport (e.g. `-20% 0px -70% 0px`), tracking section wrappers. Active section = the last section whose band intersection changed, resolved to "the section whose top is at/above the band and nearest the top"; observer callbacks feed a tiny pure reducer (unit-tested) that outputs the active id. On change: update highlight + `replaceState` the hash (never push).

**Rationale**: IntersectionObserver is already the established pattern (`chat/[id]/+page.svelte:170-187` sentinels; `LazyMount.svelte:27`). It survives the drift snag from the spec: because observation targets are the live elements, provider-list growth or the Sandbox DB section appearing/disappearing just moves the observed boxes — no recalibration. No scroll-event listeners, so no per-frame layout work (perf goal).

**Alternatives considered**: Scroll-event + `getBoundingClientRect()` loop (rejected — main-thread layout reads on every scroll event; constitution IV expects measured, minimal scroll-path work); manual offset math recomputed on mount (rejected — exactly the drift failure mode the spec calls out).

## R5. Hash discipline (URL, history, back/forward)

**Decision**: Use SvelteKit shallow-routing helpers from `$app/navigation` — `pushState(`${page.url.pathname}#${id}`, {})` on explicit jumps, `replaceState(...)` on scroll-spy changes — plus a `hashchange` window listener for back/forward/manual hash edits. `page.url.pathname` (from `$app/state`, already used in AppShell) keeps `paths.base` correct. The app's hash contract is `#<section-id>` (plain slug, NOT the chat page's `#m=…&b=…` URLSearchParams style — that grammar stays chat-specific).

History/event rules (the "deterministic scroll-restoration rule" from the spec):
1. Explicit jump (rail click / search hit / sheet pick): smooth-scroll → `pushState` (one entry). If already at that section: no push (duplicate suppression).
2. Scroll-spy highlight change: `replaceState` only — never a history entry.
3. `hashchange` (popstate/back-forward/manual edit): decode id → smooth-scroll to target top, overriding any browser-remembered offset; if the id matches no present section, do nothing beyond syncing the highlight (absent-anchor grace, FR-007).
4. On `pushState`/`replaceState` we mark the transition programmatic with a settle guard so our own hash writes are never re-handled (raw `history.pushState` doesn't fire `hashchange`, but the guard also covers anchor-click edge cases and double-dispatch).
5. Initial load with hash: after sections mount, resolve `location.hash` and land there instantly (no animation) with the chat page's rAF-retry pattern (`chat/[id]/+page.svelte:311-346` precedent), then let the spy take over.

**Rationale**: `$app/navigation` pushState/replaceState are the sanctioned SvelteKit 2 shallow-routing API (the app already uses the runes-era `$app/state`), keep `page.url` authoritative, and never trigger route reloads for same-path hash changes. No existing code writes hash or listens to `hashchange` (verified — all hash use is chat's read-only deep link), so there is no legacy behavior to reconcile.

**Alternatives considered**: Raw `history.pushState/replaceState` (equally viable; rejected because the SvelteKit helpers keep `page.url` in sync for free and centralize the base-path concern); `goto('/settings#data')` (rejected — routes through SvelteKit navigation machinery for a same-page hash change, risking re-render and history semantics we don't control); relying on native anchor-link clicks (`<a href="#data">`) for jumps (rejected — native jumps are instant, bypass reduced-motion policy, and their history/hash interplay is exactly the undisciplined behavior the spec rules out).

## R6. cmd-K conflict with the global search binding

**Decision**: Scope cmd-K to settings with a capture-phase keydown handler local to the settings route (`<svelte:window onkeydowncapture={…}>`): on settings, `(metaKey||ctrlKey)+k` → `preventDefault()` + `stopPropagation()` + focus the settings search field. AppShell's global bubble-phase listener (`AppShell.svelte:54-63`) never sees the event, so `/` and cmd-K keep their existing `/search` behavior on every other page. `/` remains untouched on settings too (it types in the search field when focused, per AppShell's own INPUT-target guard).

**Rationale**: Capture-phase listeners on `window` run before bubble-phase listeners on `window`, giving the settings page deterministic priority without editing shared shell code — AppShell's global handler stays intact for all other routes (FR-009's "scoped to the Settings page only").

**Alternatives considered**: Editing AppShell to special-case `page.url.pathname === '/settings'` (rejected — couples the shell to one feature; the shell handler is intentionally generic); dispatching a custom event the shell listens for (same coupling, more moving parts).

## R7. Search field implementation (visible field + alias matching)

**Decision**: Implement the visible field with the already-present shadcn `command` primitives (cmdk via bits-ui, `src/lib/components/ui/command/`) rendered inline — not inside `Command.Dialog`: `Command.Root` styled as a bordered control using the existing shared `inputClass` recipe (`ProviderConfig.svelte:60-61`), `Command.Input` inside it, `Command.List` + `Command.Item` + `Command.Empty` as the dropdown beneath. Alias support via cmdk's custom `filter` function: each item's value is `label + aliases` joined, lowercased match against the query; `Command.Empty` renders the "no matching section" state. Selecting an item → jump + flash. The field sits at the top of the page (rendered by the shell area under the `h1`), always visible; cmd-K only focuses it.

**Rationale**: cmdk already ships in the bundle (used by model-select dialogs), brings combobox semantics, listbox keyboard navigation (arrows/enter/escape), and an a11y-correct structure for free — no new dependency, and FR-013's known-names-only scope is natural (we index only the section registry). The spec's "visible field, not palette" ruling is honored by using the primitives without the dialog wrapper; `Command.Dialog` remains unused here.

**Alternatives considered**: Plain `<input>` + hand-rolled dropdown (rejected — reimplements keyboard nav and combobox a11y already provided); `Command.Dialog` opened by the visible field (rejected — double affordance, gesture-ish, contradicts the "field is the affordance" direction); content full-text search (rejected — FR-013 limits search to section names/aliases).

## R8. Mobile floating jump affordance

**Decision**: Below the de-facto 1024px breakpoint, hide the rail (`hidden`/`{#if !lg}` per AppShell's `matchMedia('(min-width: 1024px)')` precedent at `AppShell.svelte:47`) and show a floating button (fixed, bottom-right, `safe-area-inset` aware) opening the existing `sheet` primitive with `side="bottom"`, listing the visible sections in page order. Picking one closes the sheet and performs the identical jump (scroll + pushState + flash). Dismissing has no side effects (FR-014).

**Rationale**: 1024px is the codebase's actual mobile/desktop switch (sidebar/Sheet swap in AppShell; chat rail), so the rail breakpoint follows convention instead of inventing a new one. `Sheet` is the established mobile overlay pattern (AppShell mobile nav drawer) and brings focus trap/escape handling from bits-ui.

**Alternatives considered**: Bottom action bar (rejected — heavier, obscures content on the one long-scroll page); reusing `Command.Dialog` as the mobile jump surface (considered; deferred — a static list matches the spec's "compact section list" wording, avoids nested scrollables; can be revisited in tasks if the list feels sparse); popover-anchored list (rejected — popovers clip and scroll-poorly on small screens).

## R9. Arrival flash + reduced motion

**Decision**: Add a `section-flash` CSS utility in `app.css` (keyframes-driven background/outline emphasis that fades, mirroring the existing `msg-flash` pattern used by chat deep links at `chat/[id]/+page.svelte:348-366`); the jump applies it to the target heading for ~1.5 s (timer cleared/reset on re-jump). All programmatic scrolling chooses `behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'` — the established gate (`src/lib/motion/stagger.ts:58-59`); the app's global `@media (prefers-reduced-motion: reduce)` CSS block (`app.css:405-439`) covers any CSS-animation side of the flash.

**Rationale**: Reuses two proven in-app patterns (chat arrival flash, stagger reduced-motion gate) rather than inventing new ones; satisfies FR-015 with one line of behavior selection.

**Alternatives considered**: JS-driven scroll animation library (rejected — dependency + bundle growth for a native capability); persistent highlight instead of flash (rejected — spec says brief flash).

## R10. Testing strategy

**Decision**: Unit-test the pure logic in the default node environment: `sections.test.ts` (registry integrity: unique stable ids, labels mirror heading text, aliases lowercase/unique, capability gating via `visibleSections`), `hash-sync.test.ts` (parse/build/decide rules: push vs. replace vs. ignore, duplicate suppression, absent-id grace), `scroll-spy.test.ts` (the active-section reducer over synthetic intersection records). Verify `.svelte` wiring with source-assertion tests (fs.readFileSync + regex, per `MessageRow.mount.test.ts`, `model-select.select.test.ts` conventions): ids present on wrappers, capture-phase cmd-K handler present, rail `aria-current` binding, sheet usage. Manual smoke via `pnpm dev` per the constitution's UI-change rule (quickstart.md drives it).

**Rationale**: The repo has no component-mount harness (no `@testing-library/svelte`; only one jsdom-pragma test exists), and the constitution requires tests for new `src/lib/` behavior — extracting logic into plain modules is both the testable design and the house style.

**Alternatives considered**: Introducing `@testing-library/svelte` + jsdom component mounts (rejected for this feature — new dev dependency and harness setup is its own scope; the logic modules make the behavior testable without mounting); E2E (none exists in repo to extend).

## R11. Performance measurement plan

**Decision**: Measure with the perf probe (`window.__MAYON_PERF__ = 1`, `localStorage.mayon_perf_scenario = 'settings-nav'`) before and after the change on the dev stack: baseline `/settings` idle-scroll vs. instrumented build — compare long tasks, frame timing, input latency in the emitted `[mayon-perf]` summaries. Acceptance: no regression in frame timing/longtasks during scroll; jump handlers contribute no measurable long task.

**Rationale**: Constitution IV requires measured performance claims for scroll-path changes; the probe is the sanctioned instrument. IntersectionObserver + history-write design keeps scroll-path work off the main loop.

**Alternatives considered**: None — probe use is mandated by the constitution for this class of change.

## R12. Resolved spec-level unknowns

- **Section set/order**: resolved to the real 8 (R1); spec assumption corrected.
- **Mobile affordance**: decided (R8) — floating button + bottom sheet, per the spec's instruction to decide it in spec/plan.
- **Scroll-restoration conflict**: decided (R5 rules 3–5) — explicit navigation wins, landing at true section top; plain reload restores approximate position and the spy self-corrects.
- **Alias maintenance**: the static registry (`sections.ts`) is the single maintenance point; FR-011 maps to "update the registry when sections change" — one file, co-located with the ids it names.
- **cmd-K scope**: resolved (R6) without touching global behavior.
