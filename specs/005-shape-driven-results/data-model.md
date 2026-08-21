# Data Model: Shape-Driven Tool Result Rendering

Phase 1 output. **No database schema change and no stored-data change.** Every entity below is presentation-time and derived; the stored `messages.content` (summary) and `messages.metadata` (detail) are read-only inputs. Historical rows are never rewritten — legacy chats classify at render time.

## 1. Result Shape (derived union — the single shape authority)

Produced by `classifyResult(summary, detail)` (pure, total). One shape per tool-result body; nothing downstream may re-inspect the payload.

```text
ResultShape =
  | { kind: 'records';  values: unknown[] }   // S2: parsed top-level JSON values, ≥60% carry http(s) URLs
  | { kind: 'json';     value: unknown }      // S3: parses as JSON, fails the records rule
  | { kind: 'markdown'; text: string }        // S4: detail override or markdown heuristics
  | { kind: 'text';     text: string }        // S5: anything else > 160 chars
  | null                                      // S1 short-prose: ≤160 chars, not payload-like — no body
```

**Derivation (precedence, first match wins)** — full normative table in [contracts/tool-result-shapes.md](./contracts/tool-result-shapes.md):

```text
detail override:  detail.markdown is string | detail.mimeType = text/markdown   → markdown
                  detail.mimeType = application/json                             → json (beats heuristics)
records rule:     tolerant JSON scan of summary → ≥1 values, ≥60% URL-bearing   → records
json rule:        tolerant JSON scan of summary → ≥1 values                     → json
markdown heur.:   fenced block | heading line | link density                    → markdown
length rule:      summary.length > 160                                          → text
                  else                                                                          → null (short-prose)
```

**Invariants** (FR-001/FR-002/FR-004): classification depends only on (summary, detail) shape — never tool name, server identity, or registry state; the function never throws; unparseable input falls down the ladder, never sideways.

**Validation**: `result-shape.test.ts` asserts every row of the precedence table plus the threshold boundaries (59% vs 60% URLs; 160 vs 161 chars).

## 2. Link Card (derived projection of records values)

Never persisted; computed from each `records` value.

```text
LinkCard {
  url: string          // first http(s) URL found in the value (direct or one nesting level)
  title: string        // `title` string field, else hostOf(url); trimmed, length-clamped
  host: string         // hostOf(url) — rendered as the muted host line
  description?: string // first string of description/text/snippet fields; HTML tags stripped; one line
  snippet?: string     // optional secondary text field; HTML tags stripped; one line
}
```

**Rules** (FR-006/FR-013): dedupe by URL (first occurrence wins); render at most 10 cards, then a muted `+N more` line; titles/descriptions/snippets are plain text — payload markup is never rendered as HTML.

**Validation**: classifier/component tests assert dedupe, cap + overflow line, tag-stripping, and external-link attributes.

## 3. Tool Result Body (expanded-body presentation state)

Component: `rows/ToolResultBody.svelte`, input `(shape: ResultShape, detail: unknown)`.

```text
collapsed (default)  ── header row toggle (icon + tool name + chevron, aria-expanded) ──>  expanded
expanded             ── same toggle ──> collapsed
expanded renders:      records  → card list (sources row suppressed for this row)
                       markdown → timeline markdown renderer, bounded container
                       json     → pretty-printed (2-space), bounded <pre>
                       text     → raw summary, bounded <pre>
                       (null    → no body; not expandable at all)
sources row (when still rendered) is the LAST element of the expanded body
```

**Invariants** (FR-007/FR-009/FR-010/FR-012): the verbose rule (`payloadLike || length > 160 || hasDetail`) is unchanged from 004 — collapsed behavior identical; every branch is bounded (`max-h-60 overflow-y-auto`); no floating hide control exists; short-prose rows render the inline truncated one-liner with no expander.

**Validation**: `ToolResultBody.test.ts` + extended `ToolActivity.collapse.test.ts` (source-inspection).

## 4. Summary & Detail (existing stored inputs — unchanged, read-only)

| Input   | Source                                                                                                                                                                        | Consumed by                                | Mutation |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------- |
| summary | `messages.content`                                                                                                                                                            | classifier, `text`/`markdown` renderers    | none     |
| detail  | `parseMetadata(messages.metadata)` — whole parsed metadata (MCP: `{ serverId, toolName, content }`; deterministic: spread detail fields, e.g. `{ artifact }`, `{ markdown }`) | classifier (overrides), sources extraction | none     |

Note (research D5/RC4): stored metadata is detail **spread at the top level** by `appendToolResult`; there is no nested `detail` key in real rows. The nested read used by the legacy verbose computation is retained verbatim for behavior preservation but is not the classifier input.

**Validation**: SC-005 — stored content byte-identical before/after viewing; golden provider-context tests pass unmodified.

## 5. Shared parse primitives (refactor of `src/lib/mcp/sources.ts`)

```text
scanJsonValues(text: string): unknown[]        // whole-parse, else bracket-depth split (string/escape-aware);
                                              // partial tail dropped; never throws
collectCards(values: unknown[]): LinkCard[]    // URL/title/description/snippet extraction, one nesting level
extractSources(detail): ToolSource[]           // UNCHANGED public contract — now a projection of the same parse
```

**Invariant** (FR-014): cards and sources extraction share one parse — they can never disagree about the payload's contents.

**Validation**: `extractSources` behavior on existing fixtures is unchanged (existing tests stay green); `result-shape.test.ts` covers `scanJsonValues` on concatenated/partial payloads.

## Entity relationships summary

```text
Message row (kind: tool_result — stored, immutable)
  ├─ content ──────── summary ─┐
  └─ metadata ── parsed detail ┤
                               ▼
                    classifyResult(summary, detail) → ResultShape (single authority)
                               ▼
                    ToolResultBody renders per kind
                       ├─ records → LinkCard[] (cap 10 + "+N more") — sources row suppressed
                       ├─ markdown → Markdown renderer (bounded)
                       ├─ json / text → bounded <pre>
                       └─ null → inline one-liner only (ToolActivity collapsed path, unchanged)

src/lib/mcp/sources.ts
  └─ scanJsonValues / URL primitives ── shared by classifier (cards) and extractSources
```
