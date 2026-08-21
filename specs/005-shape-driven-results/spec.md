# Feature Specification: Shape-Driven Tool Result Rendering

**Feature Branch**: `005-shape-driven-results`

**Created**: 2026-08-21

**Status**: Draft

**Input**: User description: "Expanded MCP tool results render as an unreadable wall of raw text — multiple concatenated JSON objects (`{\"url\":…}{\"url\":…}`) dumped in a bounded pre — followed by a redundant Sources link row. Make the expanded view actually READ: search results as a list of link cards, markdown rendered as markdown, JSON pretty-printed. Driven purely by result-shape detection (never tool-name/server lists); stored payloads are sacred (render-time presentation only — no storage change, no truncation of what is stored, no schema migration; legacy chats render nicely with zero data change); every misdetection degrades safely to the existing bounded raw view."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Search results read as link cards (Priority: P1)

As a learner whose assistant ran a web search, when I expand the tool-result row, I want the results as a scannable list of link cards — title linking to the page, a muted host line, a one-line description — with the separate sources list folded into that same list, so I can actually read and use what the search found instead of parsing a wall of JSON by eye.

**Why this priority**: This is the motivating defect and the most common unreadable payload (multi-part search results are stored as concatenated JSON). It delivers standalone value: cards plus the sources fold-in work even if every other shape keeps today's rendering.

**Independent Test**: Open a chat containing a stored web-search tool result (multi-part concatenated JSON payloads); expand the row. Link cards render — no raw concatenated-JSON wall, and no separate duplicate sources list below the cards.

**Acceptance Scenarios**:

1. **Given** an expanded tool result whose stored summary is one or more concatenated JSON values and at least ~60% of the parsed values contain an http(s) URL (directly or one nesting level deep), **When** the body renders, **Then** it is a vertical list of link cards: title (from a `title` field, else the URL's host) as an external link, a muted host line, and a one-line description with any HTML markup stripped — never rendered as markup.
2. **Given** a records-shaped result with more entries than the card cap (~10), **When** the list renders, **Then** only the first ~10 cards show plus a muted "+N more" overflow line — the list is never unbounded.
3. **Given** a records-shaped result, **When** the expanded body renders, **Then** the separate sources link list does not render for that row — exactly one list (the cards), not two.
4. **Given** duplicate URLs across parsed values, **When** cards render, **Then** each unique URL appears at most once.

---

### User Story 2 - Markdown and JSON read as what they are (Priority: P2)

As a learner whose tools return markdown reports or structured data, when I expand the result, I want markdown rendered as formatted markdown (headings, links, code blocks) and JSON pretty-printed with indentation, so tool output reads like content instead of escaped source.

**Why this priority**: The second readability gap after search walls; it rides on Story 1's classifier but delivers independent value for every deterministic tool that returns prose or data.

**Independent Test**: Expand a tool result carrying an explicitly-marked markdown payload — formatted markdown renders in the same bounded container. Expand a JSON payload without URLs — an indented, pretty-printed view renders.

**Acceptance Scenarios**:

1. **Given** a result whose metadata explicitly carries markdown content (a markdown payload field or an explicit markdown type marker), **When** expanded, **Then** the body renders it through the timeline's existing markdown rendering, inside the same bounded container styling used for raw results today.
2. **Given** a result whose stored summary parses as JSON but fails the records rule (not enough URL-bearing values), **When** expanded, **Then** the body renders pretty-printed with 2-space indentation in the existing bounded raw-text container.
3. **Given** explicit type markers that conflict with string-shape heuristics (JSON that resembles markdown prose, or markdown that begins like a JSON record), **When** classified, **Then** the explicit marker wins.

---

### User Story 3 - One obvious toggle, content that flows (Priority: P3)

As a learner expanding any tool result, I want the row's header — status icon, tool name, chevron — itself to toggle the body, with the expanded body flowing directly below the header and any remaining link list last, so there is one predictable control instead of a floating hide button above the content.

**Why this priority**: Pure interaction polish that lands naturally with the rendering rewrite; it has no standalone value before Stories 1–2 and zero risk in being deferred with them.

**Independent Test**: Every expandable row toggles by activating its header row; no separate show/hide control floats above the content; when a separate sources list still renders (non-records shapes), it is the last element of the expanded body.

**Acceptance Scenarios**:

1. **Given** a verbose (expandable) tool row, **When** the header row is activated, **Then** the expanded body toggles open/closed — and no separate hide-result control exists anywhere in the row.
2. **Given** an expanded row whose shape is not records and therefore still renders a separate sources list, **When** the body renders, **Then** the sources list appears last.
3. **Given** a non-verbose row (short prose summary, no structured detail), **When** rendered, **Then** behavior is exactly today's: an inline one-line summary and no expander at all.

---

### User Story 4 - Safe for everything else, honest for history (Priority: P4)

As a learner with months of stored chats, I want every unrecognized, malformed, or exotic payload to fall back to today's bounded raw view — and my stored history to remain byte-identical — so the new presentation can never break an old chat or rewrite what was recorded.

**Why this priority**: The guardrail slice. It is cross-cutting (inherited by construction from Stories 1–2) but must be proven independently: safe degradation and payload immutability are the contract that makes shape-driven rendering shippable.

**Independent Test**: Feed malformed/truncated JSON, oversized payloads, empty summaries, and pre-feature stored chats through the renderer. Every case renders (bounded raw view at worst), nothing crashes, nothing renders unbounded, and stored content is unchanged.

**Acceptance Scenarios**:

1. **Given** any payload the classifier cannot confidently shape (malformed JSON, ambiguous long text), **When** the row renders, **Then** it degrades to the existing bounded raw-text view — never a render error, never unbounded output.
2. **Given** any chat recorded before this feature, **When** opened after it ships, **Then** rows render through shape detection with zero data change — no migration, no rewrite, no truncation of what is stored.
3. **Given** a result containing non-text parts (images, audio, other blobs) alongside text, **When** rendered, **Then** the text renders and the non-text parts are ignored (a muted count badge is optional polish, not required).

---

### Edge Cases

- **Concatenated JSON values with no separator** (`}{"` — the normal multi-part storage case): classification must split them via a tolerant bracket-depth scan, not only a whole-string parse; a whole-string parse failure must not force fallback when the scan succeeds.
- **Records just under the URL threshold** (e.g. only half the values carry URLs): renders as pretty-printed JSON, not a card list.
- **HTML inside descriptions/snippets** (`<strong>` etc. from provider summaries): tags are stripped to plain text; payload markup is never rendered as HTML.
- **Oversized payloads**: every shape's rendering stays bounded (scrollable container) exactly as the raw view is today.
- **Empty or missing summary with structured detail**: the row remains expandable via its detail, exactly as today's expandability rule dictates.
- **URL-like strings that are not http(s)** (`ftp://`, `mailto:`): do not count toward the records rule and do not become link cards.
- **Explicit type markers vs. string heuristics**: markers win (Story 2, scenario 3) — including a JSON type marker prioritizing the JSON view over markdown-looking text.
- **Multi-line descriptions and snippets**: ellipsized to one line in cards.
- **Rendering of legacy rows with no metadata at all** (detail absent): classification falls back to summary-only heuristics and must still render safely.

## Requirements _(mandatory)_

### Functional Requirements

**Classification — single shape authority**

- **FR-001**: The system MUST classify every tool-result body through a single pure shape classifier that takes the stored summary string and the parsed result metadata, and returns exactly one of: `records` (a list of parsed values), `json` (one parsed value), `markdown` (text), `text` (text), or short-prose (no expanded body).
- **FR-002**: Classification MUST depend only on the shape of (summary, detail) — never on tool name, server identity, or any per-tool/per-server list. The rendering path MUST contain no tool-name-based branching.
- **FR-003**: Records detection MUST accept both a whole-string JSON parse and a tolerant scan that splits concatenated top-level JSON values into one or more parsed values, and MUST require at least ~60% of the parsed values to contain an http(s) URL (directly or one nesting level deep).
- **FR-004**: Precedence MUST be, first match wins: explicit metadata type markers (markdown marker → `markdown`; JSON type marker → `json`) → records detection → JSON detection (`json`) → markdown heuristics (fenced code block, or a heading line, or high link density → `markdown`) → length rule (over the 160-character summary threshold → `text`; at or under it and not payload-like → short-prose).
- **FR-005**: Short-prose results (≤160 characters, not payload-like) MUST keep exactly today's behavior: inline truncated one-liner, no expander.

**Rendering per shape**

- **FR-006**: Records MUST render as a vertical list of link cards: title (from a `title` field, else the URL's host) as an external link, a muted host line, a one-line description with HTML tags stripped, and an optional snippet ellipsized to one line — capped at ~10 cards with a muted "+N more" overflow line.
- **FR-007**: When records render, the separate sources link list MUST NOT also render for that row (the cards are the one list). For every other shape that still renders a sources list, that list MUST be the last element of the expanded body.
- **FR-008**: Markdown results MUST render through the timeline's existing markdown rendering, inside the same bounded container styling raw results use today.
- **FR-009**: JSON results MUST render pretty-printed (2-space indent) and long-text results as-is, both in the existing bounded raw-text container.
- **FR-010**: For verbose rows, the header row (status icon + tool name + chevron) MUST itself be the toggle; the expanded body MUST flow directly below it; no separate hide-result control may exist. The verbose rule itself (payload-like summary, over-length summary, or structured detail present) MUST remain unchanged.

**Integrity & safety**

- **FR-011**: The stored tool-result payload MUST be treated as a read-only presentation input: no storage change, no truncation of what is stored, no schema migration; legacy chats MUST render through the new presentation with zero data change.
- **FR-012**: Any classification or rendering failure MUST degrade to the existing bounded raw-text view; the rendering path MUST never throw on malformed input and MUST never produce unbounded output.
- **FR-013**: Payload-sourced markup MUST NEVER render as HTML — descriptions and snippets are tag-stripped plain text.
- **FR-014**: URL extraction and tolerant JSON parsing MUST be shared between link-card rendering and sources extraction — one implementation serving both, not duplicated logic.

**Quality & documentation**

- **FR-015**: Classifier behavior (each shape, precedence order, tolerant concatenated scan, threshold boundaries) and rendering behavior (cards, no duplicate sources row, markdown rendering, bounded raw view, header-row toggle) MUST be covered by failing-first tests in the established source-inspection + pure-logic style.
- **FR-016**: The seams documentation's tool-result feature section MUST gain a bullet stating that the classifier is the single shape authority and that no tool-name lists exist in the rendering path.

### Key Entities _(include if feature involves data)_

- **Result Shape**: the discriminated classification (`records` / `json` / `markdown` / `text` / short-prose) derived purely from (summary, detail); the single authority deciding how an expanded tool-result body renders.
- **Link Card**: a derived presentation record (title, host, one-line stripped description, ellipsized snippet, external URL) rendered as a capped list with a "+N more" overflow count; never persisted.
- **Tool Result Body**: the expanded-body presentation of a tool result, rendered per its Result Shape below the header toggle, with the sources list (when still rendered) last.
- **Summary & Detail** (existing, unchanged): the stored content string and the parsed structured metadata of a tool result; read-only inputs to classification.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of fixture web-search results (multi-part concatenated JSON payloads) render as link cards on expansion — zero raw concatenated-JSON walls remain in the fixture corpus.
- **SC-002**: Records-shaped rows render exactly one link list (no duplicate sources list) in 100% of cases.
- **SC-003**: Markdown payloads render formatted and JSON payloads render pretty-printed for 100% of fixtures; explicit type markers override string heuristics in 100% of precedence fixtures.
- **SC-004**: 100% of malformed and exotic fixture payloads (truncated JSON, oversized text, empty summary, non-text parts) degrade safely — zero render errors, zero unbounded output.
- **SC-005**: Stored tool-result content is byte-identical before and after viewing for 100% of fixtures — no writes, no truncation, no migration.
- **SC-006**: Every verbose row is expandable and collapsible in exactly one user interaction on its header row; short-prose rows have no expander — verifiable for 100% of fixture rows.
- **SC-007**: All mandated quality gates (type-check, lint, targeted timeline/chat test run, then the full suite) pass with zero regressions.

## Assumptions

- **Thresholds**: the ~60% URL rule, ~10 card cap, and the 160-character short-prose boundary (reused from the existing summary threshold) are as specified; they are classification constants and may be tuned within the spec's intent if fixtures demand, with tests updated in lockstep.
- **Non-text result parts** (image/audio/blob) are out of scope beyond not breaking rendering; the muted count badge is optional polish, explicitly not a deliverable.
- **Expand/collapse state** remains component state only, not persisted (inherited from spec 002).
- **Reuse over duplication**: the timeline's existing markdown renderer and sources-extraction logic are reused as-is; the classifier shares (not copies) URL extraction with sources extraction.
- **Sources list survival**: the separate sources list continues to render (last) for rows whose shape is not records — only records-shaped rows fold it away.
- **Untouched territory**: provider-visible context, the tool registry, golden tests, and stored payloads are out of bounds; any change to them is a defect, not a deviation.
- **Dependencies**: the entry-kind/presentation model from spec 002 is in place; no new external dependencies and no new runtime server requirements are introduced.
