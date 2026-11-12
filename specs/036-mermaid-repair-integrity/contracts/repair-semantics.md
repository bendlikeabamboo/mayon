# Contract: Repair Semantics (feature 036)

**Feature**: 036-mermaid-repair-integrity | **Seam**: `src/lib/markdown/mermaid-repair.ts` (+ `mermaid.ts` failure path)

**Amends**: `specs/028-mermaid-error-repair/contracts/render-pipeline.md`
(§`repairMermaidSource` — pure repair) **in place**, cross-referenced from feature 036.
The render-seam behavior (`renderMermaidBlock`: original render → ONE repair attempt →
verdict; unchanged repaired source ⇒ reject with the underlying original error;
repaired attempt failure ⇒ reject with that attempt's error; no loops, no LLM calls) is
UNCHANGED. This contract redefines only the pure repair's rule semantics.

## `repairMermaidSource(source)` — 036 semantics

Pure function `(source: string) => string`. Identity when no rule matches.

### Protected regions

- Directive lines (`%%{…}%%`) and comment lines (`%% …`) are protected: NO rule
  rewrites any character on them — valid or not (directive-local repair is out of
  scope; see spec edge cases).

### Rules (fixed order, each exactly ONE pass, each scoped)

1. **normalizeSmartQuotes** — every non-protected line: typographic `“ ” ‘ ’` →
   straight quotes.
2. **collapseQuotedEdgeLabelLists** — flowchart family (`graph`/`flowchart` declared by
   the first non-protected line) only, inside pipe-delimited edge labels `|…|`: a
   comma-separated run of quoted strings collapses to ONE quoted label in a single
   pass, e.g. `-->|"a", "b", "c"|` → `-->|"a, b, c"|`.
3. **escapeEmbeddedQuotes** — flowchart family only, inside `[…]`/`(…)`/`|…|` label
   spans on non-protected lines: an inner `"` becomes mermaid's `#quot;` entity.
4. **wrapUnquotedCommaNodeLabel** — flowchart family only, a `[label]` bracket preceded
   by a node identifier on the same line, label contains a comma and no quotes:
   wrap in `["label"]`.

### Required properties (test-enforced)

- **Preservation**: for any input, no character on a protected line changes, and no
  construct that is valid syntax in its family/position is rewritten (regression
  corpus: init directives + missing `end`; C4 argument lists; xychart quoted/numeric
  lists).
- **Single pass per rule**: no rule re-executes over its own output within one
  invocation; repairing an N-element chain costs one pass (no `while` re-scan loops).
- **Idempotence**: `repair(repair(x)) === repair(x)` for every input — each rule is a
  no-match on its own output and rule outputs cannot create matches for earlier rules.
- **Corpus correctness**: the 028 canonical example
  (`A["waking"] -->|"sad", "SAD", "sleepy", "del"| B["tring"]`) still repairs to a
  parse-passing diagram (028 SC-002 preserved).

### Explicit non-goals

- No mermaid error-text parsing, no dirty-range tracking, no new fault families.
- C4/xychart/sequence (non-flowchart-family) label faults are NOT rewritten — repair
  returns identity for them and the seam reports the underlying error.
