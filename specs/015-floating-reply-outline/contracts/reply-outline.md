# Contracts: Floating Reply Outline

**Feature**: specs/015-floating-reply-outline | **Date**: 2026-08-29

This is a UI feature of a closed SPA — no external/network interfaces are added. The
contracts here are the in-repo module + component + interaction agreements that tasks and
review check against. Signatures are TypeScript-shaped descriptions, not literal source.

## 1. `src/lib/markdown/headings.ts` — extraction (pure)

```ts
interface HeadingEntry {
  msgId: string;
  index: number;            // 0-based, document order within the reply
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;             // trimmed display text; may be '' for a bare `##`
}

function extractHeadings(raw: string, msgId: string): HeadingEntry[];
function clearHeadingsCache(): void;   // test hook
```

- Parser: `remarkParse` + `remarkGfm` (same package versions the render pipeline uses);
  walks `heading` nodes only.
- MUST NOT treat as headings: text inside `code` (fenced/indented), blockquote/admonition
  bodies, tables, math nodes, or HTML nodes. Setext headings count (they are `heading`
  nodes). ATX depth is clamped to 1–6 by the parser.
- Memoized on the exact input string (Last-Value cache is sufficient: callers feed one
  growing string per streaming reply); deterministic output for equal inputs.
- No DOM access, no offsets, no dependence on `render.ts` output.

## 2. `src/lib/chat/outline/entries.ts` — outline state logic (pure)

```ts
function outlineKey(msgId: string, index: number): string;        // "${msgId}:${index}"
function replyIdOf(key: string): string;                          // key → msgId

// Which entries to (un)observe given the set of replies currently mounted.
// mountedKeys: heading keys whose elements exist right now.
function syncObservations(
  known: ReadonlyMap<string, HTMLElement>,
  mountedKeys: readonly string[]
): { observe: { key: string; el: HTMLElement }[]; unobserve: string[] };

// Active-entry resolution delegates to resolveActive() from src/lib/settings/scroll-spy.ts
// (band + at-bottom clamp are already unit-tested there); this module only maps
// HeadingEntry[] + measured tops into SpyEntry[] and extracts the owning reply:
function toSpyEntries(entries: HeadingEntry[], tops: Map<string, number>): SpyEntry[];
```

- No DOM reads/writes; callers pass measured values. This keeps the guard-test convention
  (no per-frame `scrollTop` reads in scroll-tied effects).

## 3. `src/lib/chat/outline/flash.ts` — emphasis helper

```ts
function flashHeading(el: HTMLElement, durationMs = 1600): void;
```

- Adds `.section-flash` (existing app.css keyframes), forces a reflow to restart the
  animation, removes after `durationMs`. Class-only mutation (attribute change) — Highlighter's
  MutationObserver (`childList, subtree, characterData`) deliberately does not observe
  attributes. Reduced-motion is handled by the existing CSS rule (duration zeroed), so the
  helper needs no matchMedia of its own.

## 4. Components (`src/lib/components/chat/outline/`)

All three are presentation-only: they MUST NOT call `scrollIntoView`, touch
`history`/`location`, or read the scroller. Orchestration lives in `src/routes/chat/[id]/+page.svelte` (owner of `viewport`, `stickToBottom`, hash scrolling) — the 014 split
(SettingsRail pure / page orchestrates), asserted by source-contract tests.

### ReplyOutlinePanel.svelte (desktop, ≥ xl)

```ts
props: {
  entries: HeadingEntry[];        // target reply's entries, document order
  activeKey: string | null;
  open: boolean;
  onJump: (key: string) => void;
  onToggle: () => void;
}
```

- `role="navigation"` + `aria-label="Reply outline"`; each entry is a `<button>`;
  active entry gets `aria-current="true"` and the accent treatment (SettingsRail pattern).
- Nesting: `level` drives indent (deep levels stay reachable; visual collapsing may be added
  in tasks but every entry remains rendered & focusable).
- Long text truncates with ellipsis; title attr carries full text; jump still uses the key.
- Floating: docked to the right of the chat middle pane, `pointer-events-none` wrapper with
  `pointer-events-auto` content, `z-40` (beneath transient menus/popovers at `z-50`),
  `bg-popover text-popover-foreground border-border shadow-md`, max-height capped with `dvh`
  units and internal `overflow-y-auto`. Overlay only — MUST NOT reflow conversation content
  (FR-002).
- Collapse affordance (chevron / edge pill) satisfies FR-009's one-interaction
  dismiss/re-open; dismissal changes nothing else.

### ReplyOutlineToggle.svelte (narrow viewports + collapsed entry point)

```ts
props: { visible: boolean; open: boolean; onToggle: () => void }
```

- Floating round button, `fixed right-4 bottom-[calc(1rem_+_env(safe-area-inset-bottom))] z-40 size-12 rounded-full shadow-lg`, `aria-label` set. Rendered only when `visible`
  (no reply with headings anywhere ⇒ hidden, FR-010). MatchMedia-based breakpoint awareness
  (1280px cutover) lives in the page, not the component.

### ReplyOutlineSheet.svelte (narrow viewports)

```ts
props: { entries: HeadingEntry[]; activeKey: string | null; open: boolean;
         onJump: (key: string) => void; onClose: () => void }
```

- bits-ui bottom Sheet (`side="bottom"`, `max-h-[70dvh]`, `rounded-t-2xl`,
  `pb-[calc(1rem_+_env(safe-area-inset-bottom))]`) listing the same entries/order; pick
  closes the sheet **then** invokes `onJump` exactly once (MobileSectionJump behavior);
  Escape/outside dismiss = `onClose` with zero side effects (FR-011 scenario 3).
- Focus trap, Escape handling, and portal behavior come from the Sheet primitive.

## 5. Interaction contract (page-level orchestration)

| Concern | Contract |
|---|---|
| Jump | Resolve `outlineKey` → nth `h1–h6` element under the target reply's `.markdown-body`; rAF retry ≤5 until it exists (LazyMount mounts on approach); `scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })`; headings carry `scroll-mt` for landing offset; `flashHeading` on arrival (FR-004). Duplicate texts resolve positionally (FR-007). |
| Stick-to-bottom | An outline jump sets the page's stick-suppression flag (role of `scrolledToHash`) so streaming flushes cannot yank the viewport (R3); flag resets on the next user turn. |
| Scroll-spy | `createScrollSpy(viewport, onActive)` over mounted heading elements; `jumping` suppresses `onActive` effects until `scrollend`/800 ms; spy `refresh()` after jumps and after mount-sync changes. Highlight changes create NO history entries (FR-008). |
| Retargeting | Active key's `msgId` ≠ `targetMsgId` ⇒ panel entries swap to that reply (FR-003). |
| Mount-awareness | An IntersectionObserver on `#msg-<itemId>` anchors (root = viewport, LazyMount-equivalent margin) feeds `syncObservations`; observe on approach, unobserve on departure. |
| Streaming | Entries recompute from the throttled live buffer (`streamBufferRender`) via the memoized extractor; keys of existing headings stay stable; jumps land at the heading's true current position (FR-006). |
| URL / history | No writes of any kind; chat's `#m=&b=` grammar untouched (R6). |
| Reduced motion | `prefers-reduced-motion` ⇒ behavior:'auto'; landing position, flash class, and all other behavior identical (FR-012). CSS already zeroes flash duration. |

## 6. Integration rules (non-negotiable)

1. **Expound safety by placement**: the panel/toggle/sheet are siblings of the chat
   scroller at page level. Nothing this feature renders may appear inside
   `Highlighter`/`.markdown-body`; therefore `EXCLUDED_CHROME_SELECTORS`
   (`src/lib/chat/selection.ts`) is **not modified** and `selection.test.ts` must stay
   green unchanged. (If a future task ever needs text-bearing chrome inside a message
   container, that is a spec change: register the selector and re-verify alignment.)
2. **Scroll listeners** go through `src/lib/chat/scroll-bus.ts` (`subscribeScroll`) or
   IntersectionObservers; no new raw `addEventListener('scroll')` on the viewport, no
   per-frame layout reads in scroll-tied effects (repo guard test).
3. **Layering**: outline modules import neither `db`/repositories nor driver types; reply
   text arrives via props from existing chat components/store (Constitution I).
4. **Dependencies**: zero new runtime dependencies (Constitution IV). Extraction reuses the
   installed remark parser; no rehype-slug/github-slugger.
5. **Persistence**: none. No schema change, no settings entry (FR-014). Panel `open` state
   intentionally does not survive reloads.
6. **Perf probes**: `mark('outline:extract', …)` around extraction;
   `incRender('ReplyOutline')` in the panel. Quickstart validates no regression with the
   probe before/after (Constitution IV).
7. **Design vocabulary**: Tailwind v4 utilities + existing shadcn primitives only; light and
   dark appearances must both be exercised (FR-015).
