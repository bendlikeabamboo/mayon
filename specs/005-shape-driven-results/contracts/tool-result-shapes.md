# Contract: Tool Result Body Shapes (`ToolActivity` / `ToolResultBody` / `result-shape.ts`)

**Seam**: expanded body of tool-result rows in the chat timeline. Extends the 004 contract [tool-activity-status.md](../../004-internal-area-unification/contracts/tool-activity-status.md) — its status table, collapsed rendering, and verbose rule are unchanged; this contract replaces its "Result body (FR-004/FR-005)" expander section. Classification source: **result shape only** — never tool name, server identity, or registry state (constitution III / FR-002). The classifier is the single shape authority.

## Classifier contract

```text
classifyResult(summary: string, detail: unknown): ResultShape
// detail = the whole parsed tool-result metadata (MCP: { serverId, toolName, content };
// deterministic: spread detail fields, e.g. { markdown }, { artifact }). Pure; never throws.
```

Precedence — **first match wins**:

| #   | Rule                                                                                                                  | Shape                          |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | `detail.markdown` is a string, or `detail.mimeType === 'text/markdown'`                                               | `markdown` (text = summary)    |
| 2   | `detail.mimeType === 'application/json'`                                                                              | `json`                         |
| 3   | tolerant JSON scan of summary yields ≥1 values **and** ≥60% contain an http(s) URL (direct or one nesting level)      | `records` (values)             |
| 4   | tolerant JSON scan of summary yields ≥1 values                                                                        | `json` (single value or array) |
| 5   | summary has a fenced code block, a `^#{1,6}\s` heading line, or high link density (≥2 md links ≤400 chars, ≥3 beyond) | `markdown` (text = summary)    |
| 6   | `summary.length > 160` (`TOOL_SUMMARY_THRESHOLD`)                                                                     | `text`                         |
| 7   | otherwise (≤160 chars, not payload-like)                                                                              | `null` (short-prose)           |

Tolerant JSON scan (`scanJsonValues`, shared with sources extraction): whole-string parse, else a bracket-depth split that is string-literal- and escape-aware; each segment parsed independently; a partial tail segment is dropped. `http(s)` matching reuses the sources URL predicate — `ftp:`/`mailto:` never count toward the 60% bar and never become cards.

## Rendering contract

```text
collapsed (default):  004 contract unchanged — header row + inline truncated one-liner for non-verbose rows;
                      verbose rows (payloadLike || >160 || hasDetail — unchanged) show no inline body.

toggle:               the HEADER ROW (status icon + tool name + chevron) is the toggle for verbose rows
                      (button semantics, aria-expanded); no separate Show/Hide control exists.

expanded body (ToolResultBody, flows directly below the header):
  records  → vertical card list — title as external link (target=_blank rel="noopener noreferrer"),
             muted host line, one-line tag-stripped description, optional one-line snippet;
             deduped by URL; capped at 10 cards + muted "+N more"; ToolSources row SUPPRESSED for this row
  markdown → timeline Markdown renderer inside the same bounded container classes
  json     → JSON.stringify(value, null, 2) in the bounded <pre>
  text     → raw summary in the bounded <pre>
  null     → no expander at all (inline one-liner only)

ordering:             body flows below the header; ToolSources (when still rendered) is LAST.
bounding:             every branch bounded (max-h-60 overflow-y-auto …); cards by cap; no unbounded output,
                      no render-time throw on any payload (degradation to the bounded raw view is structural).
markup:               payload-sourced markup is NEVER rendered as HTML — descriptions/snippets are tag-stripped
                      plain text (the Markdown branch renders the summary, which passes the sanitized pipeline).
immutability:         stored content/metadata are read-only inputs; provider context and golden tests untouched.
```

## Regression bars

1. Concatenated web-search fixture (`{"url":…}{"url":…}`, ≥60% URL-bearing) → records; cards render with external links; the separate ToolSources row does **not** render — fails on current code (raw wall + duplicate sources).
2. JSON fixture without URLs → pretty-printed bounded `<pre>` (2-space) — fails on current code (single-line wall).
3. `detail.markdown` fixture and heading/fenced fixtures → Markdown renderer used inside the bounded container — fails on current code (always `<pre>`).
4. Long plain-text fixture → bounded `<pre>` unchanged; short prose → inline one-liner, no expander — guards existing behavior.
5. Header-row toggle present on every verbose row; no floating toggle control — fails on current code.
6. Precedence: JSON-with-heading-char fixture → `json` (not markdown); `text/markdown` mimeType fixture → `markdown` even when payload-like; 59% vs 60% URL boundary → `json` vs `records`; truncated-JSON tail → safe shape, never a throw.
