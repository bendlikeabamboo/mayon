# Contracts: Settings Page Navigation

**Feature**: 014-settings-navigation | **Date**: 2026-08-28

This is a UI feature in a single-user SPA; there are no network or storage interface changes. The contracts below are the module APIs, the URL/keyboard behavior surface, and the component boundaries that `tasks.md` must implement and the tests must verify. Signatures are indicative (names/types may be refined in tasks) but the **behavioral clauses are normative**.

## 1. URL & history contract

Surface: `/settings#<section-id>` (with SvelteKit `paths.base` honored via `page.url.pathname`).

| Rule | Contract |
|------|----------|
| Anchor grammar | Plain slug: `#data`, `#sandbox-db`. The chat page's `#m=…&b=…` URLSearchParams grammar is not used here. |
| Valid ids | Exactly the ids in `SETTINGS_SECTIONS` whose section is currently rendered. Unknown ids are ignored gracefully (no error, no scroll). |
| Explicit jump | Exactly one history entry via `pushState`; no entry when already settled at the target (duplicate suppression). |
| Scroll-spy change | `replaceState` only; never a history entry. While a jump scroll is in flight, the hash stays on the jump target until settle (no mid-flight flicker). |
| Back/Forward | Lands deterministically with the target section top at the viewport top, overriding any browser-remembered offset. |
| Initial load with valid hash | Instant (non-animated) land after sections mount; rAF retry until the element resolves (≤ 5 tries, chat-page precedent). |
| Reduced motion | Identical URL/history behavior; only the scroll animation is omitted (`behavior: 'auto'`). |

## 2. Keyboard contract

| Keys | Scope | Behavior |
|------|-------|----------|
| `Cmd-K` / `Ctrl-K` | `/settings` only | Focuses the settings search field. Implemented as a **capture-phase** window keydown in the settings route that `preventDefault()`s and stops propagation, so `AppShell`'s global handler (`goto('/search')`) never fires on this page. |
| `Cmd-K` / `Ctrl-K`, `/` | every other route | Unchanged: global `/search` binding in `AppShell` (regression guard: a source-assertion test must show the settings handler is capture-phase and self-contained; AppShell is not edited). |
| Arrow keys / Enter / Escape | inside search field | Provided by cmdk (`Command` primitives): navigate matches, select (jump), dismiss list. |
| `Tab` | whole page | Rail is a `<nav>` with focusable entries; sheet traps focus while open (bits-ui). |

## 3. Module contracts (`src/lib/settings/`)

### sections.ts — static registry (single maintenance point)

```ts
import type { ServerCap } from '@mayon/shared';

export interface SectionEntry {
  id: string;              // stable anchor slug, = DOM id of section wrapper
  label: string;           // mirrors the real h2 heading text verbatim
  aliases: string[];       // lowercase synonyms for search; may be empty
  cap: ServerCap | null;   // capability gate; null = always rendered
}

export const SETTINGS_SECTIONS: readonly SectionEntry[];
// ids in order: providers, mcp, learner-profile, expound-instructions,
//               lab-prompt, quiz-prompt, data, sandbox-db

export function visibleSections(
  sections: readonly SectionEntry[],
  caps: readonly ServerCap[],
): SectionEntry[];        // order-preserving filter on cap

export function matchSections(
  query: string,
  sections: readonly SectionEntry[],
): SectionEntry[];        // known-names/aliases only (FR-013): token-wise
                          // lowercase substring match over label + aliases;
                          // empty/blank query → all sections
```

### hash-sync.ts — hash discipline (rules from §1)

```ts
export function sectionIdFromHash(hash: string): string | null;
// '#data' → 'data'; '' | '#' → null; unknown ids are returned as-is and
// validated by the caller against the visible registry.

export function sectionHash(pathname: string, id: string): string;

export interface HashSync {
  /** Explicit jump: pushState + returns the id to scroll to (or null if
   *  duplicate-suppressed because already settled there). */
  pushJump(id: string): string | null;
  /** Scroll-spy at-rest change: replaceState, never history. */
  replaceActive(id: string): void;
  /** Subscribe to back/forward + manual hash edits (hashchange). The
   *  listener ignores events this module itself caused (settle guard). */
  onExternalHash(cb: (id: string | null) => void): () => void;
  /** Initial-load resolution: current hash id or null. */
  initial(): string | null;
}
```

### scroll-spy.ts — active-section tracking

```ts
export interface ScrollSpy {
  /** Begin tracking a section wrapper element inside the scroll root. */
  observe(id: string, el: HTMLElement): void;
  unobserve(id: string): void;
  /** Current active id (or null); also pushed via onActive. */
  active(): string | null;
  destroy(): void;
}

export function createScrollSpy(
  root: HTMLElement,                       // the app shell <main>
  onActive: (id: string | null) => void,
): ScrollSpy;
```

Implementation clauses: one `IntersectionObserver` with `root`, a top detection band via `rootMargin`; callbacks feed a **pure reducer** `resolveActive(records) → id | null` (exported for unit tests). No scroll-event listeners, no layout reads per scroll tick (perf contract: probe-verified).

## 4. Component contracts (`src/lib/components/settings/`)

Presentation only; all behavior arrives via props/callbacks and the modules above.

### SettingsRail.svelte (desktop)

- Props: `sections: SectionEntry[]` (already visibility-filtered), `activeId: string | null`, `onJump: (id: string) => void`.
- Renders `<nav aria-label="Settings sections">`, docked beside the content column (vertically centered in the viewport via a sticky in-flow wrapper), mounted as the first element of the settings page markup so tab order reaches it before page content; one entry per section in array order; entry label = `label`.
- Highlight: `aria-current="true"` + active styling on the current entry (scroll-spy driven).
- Visible at the `xl` breakpoint (≥1280px) — not 1024px: at 1024–1280px the centered `max-w-3xl` column leaves no room for a rail, so that band is served by the floating jump; the page wrapper reserves the rail zone with `xl:pr-52` so the column's `mx-auto` centering splits the remaining space evenly (content stays visually centered, never pushed against the rail).
- Clicking an entry calls `onJump(id)` exactly once; no scrolling logic inside the component.

### SettingsSearch.svelte (visible field, desktop + mobile)

- Props: `sections: SectionEntry[]`, `onJump: (id: string) => void`; exposes a `focus()` binding for the cmd-K handler.
- Renders an always-visible inline `Command.Root` (cmdk) styled with the shared `inputClass` recipe; list shows `label` (+ matched alias hint); `Command.Empty` = "No matching section".
- Selecting a hit calls `onJump(id)`; the field keeps its value (user may refine); Escape collapses the list.

### MobileSectionJump.svelte (< 1024px)

- Props: `sections: SectionEntry[]`, `onJump: (id: string) => void`.
- Floating button, fixed bottom-right (safe-area aware), opens a bottom `Sheet` listing sections in order; shown below the `xl` breakpoint (1280px, matching the rail's threshold so every width is covered).
- Pick → close sheet → `onJump(id)`; dismiss → no scroll/history/hash side effects.

### Orchestration (`src/routes/settings/+page.svelte`)

- Wraps child sections in anchor `<div id>`s (and `ProviderConfig` shell owns `#providers`).
- Wires: `visibleSections(serverStatus.caps)` → the three components; `onJump` = hash-sync `pushJump` + animated scroll into `<main>` + `section-flash` on the target heading; spy `onActive` = highlight + `replaceActive`; `onExternalHash` = deterministic land; capture-phase cmd-K focuses the search; initial hash land on mount.

## 5. Visual contract

- Section headings, rail entries, and search field reuse the existing vocabulary: heading recipe `text-sm font-semibold uppercase tracking-wide text-muted-foreground`, `border-border` hairlines, `--ring` focus, popover surface for the dropdown, sans-serif type, low text-contrast conventions (per corrections memory: contrast is intentionally low; flatness articulated with hairlines, not darker text).
- `section-flash` utility in `app.css`: brief (~1.5 s) fading emphasis on the target heading; purely decorative (`aria-hidden` timing element / no announced state change); respects `@media (prefers-reduced-motion: reduce)`.
- Both light and dark appearances via existing tokens; no new theme variables.

## 6. Capability contract

- Sandbox DB section presence follows `serverStatus.has('sandbox-db')` exactly as today; its rail entry, search item, and sheet entry appear/disappear with it (derived from `visibleSections`), including the DOM anchor (wrapper sits inside the existing `{#if}`).
- No other sections gain capability gates in this feature.

## 7. As-built refinements (validated in browser, 2026-08-28)

Refinements made during implementation while preserving every behavioral clause above:

1. **Bottom-clamp spy rule**: when the scroll container is at maximum scroll, the active section is the last rendered section (the band can never be reached there — sections cannot physically reach the viewport top, landing clamps natively). Implemented as an `atBottom` argument to the pure `resolveActive` reducer.
2. **Live-geometry re-evaluation at rest**: IO band-crossing snapshots go stale between crossings, so the spy re-evaluates from live element rects on `scrollend` (and via `refresh()` after jump settle) — mid-scroll the IO fast path still drives the highlight; at-rest correctness (SC-003) is computed from live geometry.
3. **Post-jump hash grace (600 ms)**: after an explicit jump settles, scroll-driven `replaceActive` is suppressed briefly so the at-bottom rule cannot overwrite the just-pushed explicit hash (`#data` survives a clamped Data jump) within the same history entry; the next user scroll updates it normally.
4. **Rail at `xl`, floating jump below `xl`**: see §4 edits above — keeps every viewport width covered with no column overlap.
5. **Tracked rail + centered unit**: the rail no longer pins to the viewport's right edge — the page column is capped (`max-w-[64rem]`) and centered as a unit, with the rail zone reserved inside it via `xl:pr-52`; the rail docks in that zone (`absolute right-6` + sticky vertical centering, `pointer-events-none` outer / `pointer-events-auto` nav). The rail therefore keeps a constant ~32px gap to the content at any viewport width and survives sidebar collapse, and the column remains visually centered. The nav carries `max-h-[calc(100dvh-3rem)] overflow-y-auto overscroll-contain` so short viewports scroll the rail instead of clipping it.
