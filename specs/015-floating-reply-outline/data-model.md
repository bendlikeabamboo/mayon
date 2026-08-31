# Data Model: Floating Reply Outline

**Feature**: specs/015-floating-reply-outline | **Date**: 2026-08-29

The feature introduces **no persisted entities** (spec FR-014: presentation-only state; no
schema change, no migration). Everything below is view-time state derived from existing data.

## Source data (existing, read-only)

| Source | Field | Used for |
|---|---|---|
| `messages` row (`kind === 'assistant_message'`) | `content` (raw markdown) | Heading extraction input, after `stripGateFence` |
| `messages` row | `id` | Reply identity (`msgId`) in outline keys |
| Timeline item (`assembleTimeline`) | item id → `#msg-<id>` anchor div | Stable DOM anchor for mount-awareness |
| `chatStore.streamBufferRender` | live text | Heading extraction input while streaming |

Access path stays inside existing layering: components read reply text via props/store; the
outline never imports `db`/repositories.

## Derived entities

### HeadingEntry

One navigable section of one assistant reply.

```
HeadingEntry {
  msgId : string            // owning assistant message row id
  index : number            // 0-based position among that reply's headings (document order)
  level : 1 | 2 | 3 | 4 | 5 | 6   // mdast heading depth
  text  : string            // heading text, trimmed for display (may be empty for bare `##`)
}
```

- **Identity / key**: `outlineKey = "${msgId}:${index}"` — position-based, never text-based
  (duplicate headings resolve correctly, spec FR-007).
- **Derivation**: `extractHeadings(stripGateFence(content))` — only mdast `heading` nodes
  produce entries; heading-like text inside code fences, admonitions/callouts, tables, and
  math yields none (FR-005). Deterministic per input string; memoized.
- **Cardinality**: 0..N per reply. A reply with zero entries is invisible to the outline
  (FR-010).

### OutlineView (panel state — session-scoped, not persisted)

```
OutlineView {
  targetMsgId : string | null   // reply the panel currently mirrors (the "currently reading" reply)
  entries     : HeadingEntry[]  // target reply's entries (live during streaming)
  activeKey   : string | null   // currently in-view heading (scroll-spy output)
  open        : boolean         // panel/sheet visibility (user-toggled; FR-009)
  jumping     : boolean         // suppresses scroll-spy updates while a jump settles
  stickSuppressed : boolean     // sticky-to-bottom stood down after an explicit jump (streaming guard)
}
```

## State transitions

```
             conversation has ≥1 reply with headings?
   ┌────────────────── no ──────────────────► HIDDEN  (toggle/button not rendered, FR-010)
   │ yes
   ▼
TRACKING ── spy activeKey changes ──► TRACKING (retarget entries if msgId changed)
   │ │
   │ └─ user clicks entry ──► JUMPING (jumping = true; stickSuppressed = true)
   │                             │  rAF-retry resolve element → scrollIntoView(block:'start')
   │                             │  flash heading
   │                             ▼
   │                          SETTLING ── scrollend / 800ms fallback ──► TRACKING
   │                                                                     (jumping = false;
   │                                                                      stickSuppressed stays
   │                                                                      until next user turn)
   └─ user dismisses panel ──► TRACKING with open = false (scroll/history unchanged, FR-009)
```

Rules:

- **HIDDEN → TRACKING**: a reply with headings enters the conversation (new reply, or
  `chatStore.load` of an existing conversation). Re-evaluated whenever the timeline changes.
- **TRACKING retarget**: whenever the spy's active key's `msgId` differs from
  `targetMsgId`, entries swap to that reply's list (FR-003). No history/URL writes (R6).
- **JUMPING**: scroll-spy updates are ignored until settle (014's jumping/settle pattern);
  during streaming, `stickSuppressed = true` keeps the ResizeObserver force-scroll from
  yanking the viewport back (R3). The flag lives on the chat page next to `stickToBottom`
  / `scrolledToHash` and resets on the next user message (new turn, new stream).
- **Streaming**: `entries` recompute from the live buffer on each throttled flush; keys of
  already-emitted headings are stable (`index` is append-mostly; a heading count change only
  appends/extends, so active-key stability holds in practice — extractor is deterministic).
- **Dismiss/reopen**: `open` toggling never touches scroll position or content; reopening
  shows `activeKey` already synced (FR-009).

## Validation rules (from requirements)

- Entry `level` is always 1–6 (mdast guarantee); `index` is dense per reply (0..N-1).
- Keys are unique within the outline; text is display-only and never used for lookup.
- The outline renders only when `entries.length ≥ 1` for the current target; the whole
  affordance hides when no reply in the conversation has entries (FR-010).
- No write path exists to any store/repository from this feature (FR-014).
