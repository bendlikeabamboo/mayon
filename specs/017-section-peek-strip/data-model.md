# Data Model: Section Peek Strip

**Feature**: specs/017-section-peek-strip | **Date**: 2026-09-02

This feature adds **no database schema changes and no migrations**. It introduces one
persisted scalar (a row in the existing generic `settings` KV table) and a set of
derived, transient entities that exist only in memory/DOM. Entity shapes here are
TypeScript-shaped descriptions, not literal source; binding contracts live in
[contracts/section-strip.md](./contracts/section-strip.md).

## 1. `Section` (derived, transient)

One heading-delimited region of an assistant reply. Derived by walking `heading`
nodes in the reply's mdast tree (`src/lib/markdown/sections.ts`); **never stored**.

| Field | Type | Meaning | Validation / invariants |
|---|---|---|---|
| `index` | `number` | 0-based position in document order | dense sequence `0..n-1`; drives nth-DOM-heading anchoring and bar order |
| `level` | `1\|2\|3\|4\|5\|6` | heading depth | clamped by parser; setext headings included |
| `title` | `string` | trimmed heading display text | may be `''` for a bare `##`; used for preview title + aria-label |
| `start` | `number` | raw-markdown offset of the heading's first character | `0 ≤ start < end ≤ raw.length` |
| `end` | `number` | raw-markdown offset where the section ends (next heading's start, or end of input) | sections tile the reply from the first heading onward; text before the first heading belongs to no section |
| `length` | `number` | `end - start` | drives proportional bar sizing; minimum visual size enforced at render time, never by mutating `length` |
| `excerpt` | `string` | plain text of the section's opening content (first paragraph(s)), whitespace-collapsed | capped (~240 chars, exact cap a tuning constant); no markdown syntax; empty for heading-only sections |

**Exclusions (validation rules)**: headings inside code (fenced/indented),
blockquote/admonition bodies, tables, math, and HTML nodes are never sections —
guaranteed by the mdast node types themselves; tests pin this.

**Derivation & lifecycle**:

- Input: the durable message's `content` string. Memoized on exact input (Last-Value
  cache + per-msgId content check).
- Recompute triggers: message completes streaming (durable entry appears); regenerate
  (new message row + new content). There is no message-edit mutation in the product,
  so "refresh on edit" is covered structurally: any content change is a new
  computation by identity.
- Consumers: eligibility check (count), `SectionStrip` (bars, preview), page jump
  (nth heading anchor).

## 2. `StripEligibility` (derived predicate, not stored)

A reply shows a strip iff **all** hold (spec FR-001, FR-010, R2, R3):

| Condition | Source of truth |
|---|---|
| entry is durable and `chatStore.streaming === false` | timeline assembly (`MessageList` props), store flag |
| `sections.length >= 3` | `extractSections(content)` |
| reply body `offsetHeight` > transcript viewport `clientHeight` | one-shot mount measurement + `ResizeObserver` on the message body (not scroll-tied) |
| strip preference enabled | `SectionStripPreference` below |

Evaluated at mount/completion and on container resize; a drop to ineligible unmounts
the strip with no other side effects.

## 3. `SectionStripPreference` (persisted scalar)

The user's on/off choice for the feature (spec FR-014).

| Aspect | Value |
|---|---|
| Storage | existing `settings` table (`key text PK, value text`, JSON-encoded values) — `src/lib/db/schema.ts:210-213` |
| Key | `sectionStripEnabled` |
| Value | JSON boolean |
| Default | `true` (defensive read: missing, corrupt, or wrong-typed value ⇒ `true`) |
| Access | sole-writer module `src/lib/chat/strip/pref.ts` (`isStripEnabled` / `setStripEnabled`) via `repos.settings` — components never touch the repository (Constitution I) |
| Reads/writes | read once per chat page mount (cached in a rune store for reactive toggling); written on toggle in `/settings` |

**State transitions**: `on ⇄ off` via the settings toggle. `off` unmounts every strip
immediately (no hover affordances, no previews); `on` restores strips on currently
qualifying replies. Survives reload (server-persisted KV).

## 4. `StripUiState` (transient component state)

Per-mounted-strip interaction state inside `SectionStrip.svelte` — never persisted,
never lifted.

| Field | Type | Meaning / transitions |
|---|---|---|
| `hoveredIndex` | `number \| null` | bar under the pointer; `null` at rest (hairline) → set on pointerenter (fattened) → cleared on strip pointerleave |
| `dwellTimer` | `timer id` | one per interaction; armed on bar pointerenter (desktop only), cancelled on bar leave / other-bar enter / strip leave |
| `previewIndex` | `number \| null` | section whose preview card is open; set when dwell timer fires (~400 ms), cleared immediately on pointer leave of strip+preview region (FR-006) |
| `isTouch` | `boolean` | matchMedia `(hover: none), (pointer: coarse)`; when true, dwell timers are never armed and tap jumps directly (FR-011) |

**Invariants**: at most one preview open per strip; no preview during streaming
(strip is unmounted then); all transitions are pointer-driven — no scroll-tied state.

## 5. Jump result (page-orchestrated side effect)

Not an entity; recorded here because it has observable state effects on existing
chat-page state:

1. stick-suppression flag set (role of `scrolledToHash`) → streaming flush effects
   skip while the jump animates → released on next user turn,
2. smooth (or instant under reduced-motion) scroll of `viewport` to the section's
   heading (`block: 'start'`, `scroll-mt` offset),
3. `.section-flash` emphasis on the landing heading for ~1600 ms (CSS-zeroed under
   reduced motion).

No history/URL writes; the chat `#m=&b=` grammar is untouched.

## 6. Entity relationships

```text
messages.content ──extractSections──▶ Section[] ──▶ StripEligibility ──▶ SectionStrip (DOM)
settings[sectionStripEnabled] ────────────────────────────────▶ (gates eligibility)
Section[index] ──nth h1–h6 under #msg-<id> .markdown-body──▶ page jump ──▶ viewport scroll + flash
Section.title/excerpt ──▶ preview card content (transient StripUiState)
```
