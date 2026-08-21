# Research: Shape-Driven Tool Result Rendering

Phase 0 output. Every root cause and shape was verified against source during `/speckit.specify`/`/speckit.plan` of this feature (2026-08-21). Format: Decision → Rationale → Alternatives.

## Verified root causes (from source, not speculation)

- **RC1 — the wall of concatenated JSON**: `src/lib/mcp/mount.ts:74` builds the stored summary as `result.content.map((c) => c.text ?? '').join('')` — multi-part MCP results land as `{...}{...}` concatenated JSON with no separator, byte-capped by `truncateResult`. `ToolActivity.svelte:119-126` renders that string verbatim inside the bounded `<pre>`. Nothing between storage and rendering parses it.
- **RC2 — redundant sources row**: `ToolActivity.svelte:152-154` renders `ToolSources` for every expanded verbose row, while `extractSources` (`src/lib/mcp/sources.ts:68-85`) already parses the same payload (per content-part `JSON.parse` with a `scanText` fallback) — so a web-search result shows its links twice: once as a JSON wall, once as the Sources row.
- **RC3 — floating expander control**: the toggle is a separate `Show result` / `Hide result` button below the summary (`ToolActivity.svelte:130-143`), distinct from the header row (icon + tool name, lines 88-118) — two affordances, and the hide button floats above the expanded content per the current DOM order.
- **RC4 — metadata shape (critical for the classifier input)**: `appendToolResult` (`src/lib/db/repositories/messages.ts:59-75`) stores metadata as `{ ...opts.detail, ok }` — detail is **spread at the top level**, never nested under a `detail` key. MCP rows therefore persist metadata `{ serverId, toolName, content: McpContent[] }` (from `mount.ts:79`); deterministic tools persist their detail fields the same way (`registry.ts:171` `{ ...lab, checklist }`, `generative-tools.ts:59` `{ artifact: … }`). Consequence 1: `ToolActivity.svelte:36` (`resultMeta?.detail`) reads a key that effectively never exists — `hasDetail` is false in practice; the expander fires via `payloadLike`/length. Consequence 2: `extractSources` consumes the **whole parsed metadata** (`ToolActivity.svelte:33`), and that is the shape the spec calls "detail". The classifier must do the same (D5).
- **RC5 — existing machinery to reuse**: `Markdown.svelte` (sanitized rendering, mermaid/focus handling) is reusable as-is for S4; the bounded-container vocabulary is `max-h-60 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 text-xs …` (`ToolActivity.svelte:122`); `sources.ts` already owns `URL_RE`, `hostOf`, `isHttpUrl`, and a URL-dedupe `Map` collector capped at `MAX_SOURCES = 10` — exactly the primitives cards need.
- **RC6 — test contracts that must evolve (not golden)**: `ToolActivity.collapse.test.ts` asserts `source.toContain('Show result')` and `{#if !verbose || expanded}\s*<ToolSources` — both strings change by design (header toggle, sources fold). These are behavior contracts, not golden fixtures; updating them is the failing-first mechanism, not a violation. `src/lib/chat/golden/*` is untouched (it freezes provider context, which this feature never reads or writes).

## D1 — One pure classifier, discriminated union, in `src/lib/chat/result-shape.ts`

**Decision**: `classifyResult(summary: string, detail: unknown): ResultShape` returning `{ kind: 'records', values: unknown[] } | { kind: 'json', value: unknown } | { kind: 'markdown', text: string } | { kind: 'text', text: string } | null` (null = short-prose, no expanded body). Pure, total (never throws), no imports beyond the shared `sources.ts` primitives. Precedence, first match wins: detail overrides → records (S2) → JSON (S3) → markdown heuristics (S4) → length rule (S5/short-prose). Detection reads only (summary, detail) — no tool name, no server id, no registry lookup.

**Rationale**: FR-001/FR-002/FR-004. A single authority makes precedence testable table-style and keeps ToolActivity/ToolResultBody free of branching logic. Placement beside `kinds.ts`/`entries.ts` matches the established pure-module seam.

**Alternatives**: (a) Classifier inside the component — rejected: untestable as pure logic, shape logic smeared into markup. (b) Registry-driven classification — rejected: registry is tool identity; FR-002 forbids identity-based rendering.

## D2 — Tolerant multi-value JSON scan, shared with sources extraction

**Decision**: Extend `src/lib/mcp/sources.ts` with a shared scan that, given a text part (or any string), returns the list of top-level JSON values it contains: try whole-string `JSON.parse` first; on failure, walk the string with a bracket-depth scanner that is string-literal- and escape-aware and `JSON.parse` each split segment; an empty/partial tail segment is dropped. `classifyResult` uses it on the summary (and, for MCP details, over `detail.content[].text` parts); `extractSources` refactors onto the same scan so cards and sources see identical parses. `extractSources`' public contract (`ToolSource[]`, cap 10, never throws) is unchanged.

**Rationale**: FR-003/FR-014 + RC1/RC5. Concatenated values are the _normal_ case (mount.ts joins with `''`), so whole-string parse alone is insufficient; the scanner already exists in embryo as sources.ts's per-part parse+fallback. One parse guarantees cards and the sources list can never disagree about what the payload contains.

**Alternatives**: (a) `JSON.parse` whole-string only — rejected: fails every multi-part search result. (b) Regex-split on `}{` — rejected: breaks on braces inside string values. (c) A new shared module — rejected: sources.ts is already the shared home and the natural import site for both consumers.

## D3 — Records rule and link cards

**Decision**: A JSON-parsed result is `records` iff ≥60% of the parsed top-level values contain an http(s) URL (directly or one nesting level deep — object field, or array element that is an object/URL string), reusing `isHttpUrl` so `ftp:`/`mailto:` never count. `records` renders a vertical list of cards: title (`title` string field, else URL host) as an external link (`target="_blank" rel="noopener noreferrer"`), muted host line, one-line description (first string of `description`/`text`/`snippet` fields, HTML tags stripped), optional one-line snippet — deduped by URL, capped at 10 cards + muted "+N more" count. HTML stripping is a tag-removal replace to plain text — payload markup is never rendered as HTML.

**Rationale**: FR-003/FR-006/FR-013 + spec edge cases (threshold-miss → S3; duplicates; multi-line ellipsize). The 60% bar tolerates mixed Brave payloads (web+news+images where a few items lack page URLs) while refusing data-shaped JSON that merely contains a URL.

**Alternatives**: (a) Any-URL rule — rejected: a config blob with one URL would masquerade as search results. (b) Rendering descriptions as sanitized HTML — rejected: FR-013 mandates tag-stripping; the sanitize pipeline is for trusted model markdown, not payload echoes.

## D4 — ToolResultBody consumes the union; header row is the toggle

**Decision**: New `rows/ToolResultBody.svelte` takes `(shape, detail)` and renders per kind: records → cards (D3); markdown → `Markdown.svelte` inside the same bounded container classes; json → `JSON.stringify(value, null, 2)` in the bounded `<pre>`; text → the summary as-is in the bounded `<pre>`; null → nothing. `ToolActivity` keeps its exact verbose computation (`needsExpander || payloadLike`, lines 72-74) and collapsed rendering, but the header row (icon + tool name + chevron) becomes the toggle (button semantics, `aria-expanded`), the expanded body is delegated to `ToolResultBody`, and the separate Show/Hide button is removed. `ToolSources` renders last — and not at all when the shape is `records` (the cards are the one list).

**Rationale**: FR-006..FR-010 + RC3. Keeping `verbose` byte-identical preserves collapsed behavior and the 004 contract (`tool-activity-status.md` result-body section) for non-verbose rows; moving only the expanded body isolates the change. The chevron already exists in the icon vocabulary.

**Alternatives**: (a) Keep the separate toggle button — rejected: spec deliverable 3 explicitly removes it. (b) Fold classification into ToolActivity — rejected: FR-015's component tests should assert delegation, not re-test the classifier.

## D5 — Classifier input: the whole parsed metadata, matching sources extraction

**Decision**: `classifyResult(summary, detail)` where callers pass `detail = parseMetadata(resultMsg.metadata)` — the whole parsed metadata object, exactly what `extractSources` receives today. The nested `ToolResultMeta.detail` read stays untouched where it is used (the verbose rule) but is _not_ the classifier input. Detail overrides consult top-level keys: `detail.markdown` (string) or `detail.mimeType === 'text/markdown'` → markdown; `detail.mimeType === 'application/json'` → JSON beats markdown heuristics.

**Rationale**: RC4. Stored metadata _is_ the detail (spread at write time); anything else would see empty input for every real row and silently disable S4/S2-overrides. `extractSources` precedent proves the whole-metadata shape works against production data.

**Alternatives**: (a) Normalize metadata into `{ detail: … }` at write time — rejected: stored-row rewrite, violates FR-011. (b) Union-read (`metadata.detail ?? metadata`) — rejected: two shapes for one concept; the whole-metadata read is the only shape that exists.

## D6 — Markdown heuristics (S4 fallback) and their bounds

**Decision**: Without a detail override, the summary is markdown iff it contains a fenced code block (` ``` `), or a heading line (`^#{1,6}\s` at line start, multiline), or high link density (≥2 markdown links `[…](http…)` in ≤400 chars, scaling to ≥3 beyond). Otherwise >160 chars → `text`; ≤160 and not payload-like → null (short-prose).

**Rationale**: FR-004. The three signals are the ones a human uses; the density bar avoids flagging ordinary prose that happens to contain one parenthesized URL. Constants live in the classifier beside the taxonomy, tested table-style.

**Alternatives**: (a) Always render long text as markdown — rejected: prose with stray `#`/underscores would mutate meaning (emphasis injection from payload). (b) No heuristic (detail override only) — rejected: MCP text/markdown parts without a metadata-level marker would miss S4.

## D7 — Degradation is structural, not a catch-up branch

**Decision**: Totality by construction: the classifier catches internally (`try` around all parsing; unparseable → continue down the ladder), returns `text` for anything long and `null` for anything short; `ToolResultBody` has an exhaustive kind switch whose every branch is bounded (cards capped, `<pre>`/markdown inside `max-h-60 overflow-y-auto`). No render path can throw on payload content or emit unbounded DOM.

**Rationale**: FR-012 + spec US4. Making the fallback the _ladder's bottom_ (not a try/catch around rendering) means a misdetection still lands in a correct, bounded renderer.

**Alternatives**: Error-boundary component — rejected: Svelte boundary support is not in the project vocabulary and FR-012 wants the raw view, not a blank.

## D8 — Tests, failing-first (constitution II)

**Decision**: (1) `src/lib/chat/result-shape.test.ts` — pure fixtures: concatenated web-search JSON → records; JSON without URLs → json; `detail.markdown` / `detail.mimeType` overrides → markdown/json; heading/fenced/link-density → markdown; long plain text → text; ≤160-char prose → null; precedence (JSON beats markdown heuristics; detail override beats heuristics; 59% URLs → json, 60% → records; non-http URLs don't count). (2) `rows/ToolResultBody.test.ts` — source-inspection: cards markup + external-link attrs + cap line; `Markdown` import for markdown branch; pretty-print `JSON.stringify(…, null, 2)`; bounded classes on every raw branch. (3) Extend `ToolActivity.collapse.test.ts` — header-row toggle present, no floating toggle button, `ToolSources` skipped for records shapes and last otherwise; short-prose rows keep the inline truncate line and no expander. All fail on current code; golden tests run unmodified.

**Rationale**: FR-015 + RC6. Mirrors the established two-tier style (`collapse.test.ts` source-inspection, `entries.test.ts`/`kinds.test.ts` pure logic).

**Alternatives**: None — required.

## D9 — Seams documentation

**Decision**: One bullet in `docs/dev/seams.qmd` under the feature-004 presentation section: the classifier (`result-shape.ts`) is the single shape authority for tool-result bodies; rendering is shape-driven, never tool-name-driven; sources fold into cards for records shapes.

**Rationale**: FR-016; the constitution requires seams docs to track presentation authorities.

**Alternatives**: A new seams section — rejected: this extends 004's tool-activity presentation seam; one bullet keeps the doc honest without fragmenting it.
