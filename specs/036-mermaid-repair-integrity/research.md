# Research: Mermaid Repair Integrity (028 defects)

Phase 0 output. All evidence below was verified against the current tree on 2026-11-10
(worktree `fix/issue-72-mermaid-repair`) by reading the files and by a read-only node
probe executing the real `repairMermaidSource` from `src/lib/markdown/mermaid-repair.ts`.

## R0. Verified defect mechanics (evidence)

**Item 1 — valid syntax silently rewritten.** Current rules in
`src/lib/markdown/mermaid-repair.ts`: `SMART_QUOTES` (10–15), `QUOTED_LIST` (19,
`/"([^"]*)",\s*"([^"]*)"/`), `EMBEDDED_QUOTE` (24), `UNQUOTED_COMMA_LABEL` (30,
`/\[([^"\]"]*,[^"\]"]*)\]/g`); composed in `repairMermaidSource` (32–42). Probe results
on the CURRENT code:

- `%%{init: {"theme":"dark", "logLevel": 1}}%%` (diagram failing elsewhere, missing
  `end`) → `"theme":"dark, logLevel"` — the init directive's JSON is rewritten by
  `QUOTED_LIST` even though the fault is a missing `end`.
- `C4Context … Person_Ext(pA, "Alice", "External user")` →
  `Person_Ext(pA, "Alice, External user")` — valid C4 argument lists collapsed.
- `xychart-beta … x-axis "months" ["Jan", "Feb", "Mar"]` → `["Jan, Feb, Mar"]` and
  `bar [10, 20, 30]` → `bar ["10, 20, 30"]` — valid xychart lists mangled by
  `QUOTED_LIST` and `UNQUOTED_COMMA_LABEL` respectively.

Root cause: every rule is a whole-source regex with no diagram-family or label-position
scoping, and the render seam applies them on ANY failure
(`src/lib/markdown/mermaid.ts:86-93`).

**Item 2 — quadratic rescans.** `mermaid-repair.ts:34-36` wraps `QUOTED_LIST` in
`while (QUOTED_LIST.test(s)) s = s.replace(QUOTED_LIST, …)`. The regex is non-global:
each iteration collapses ONE adjacent pair and rescans the full source; an N-element
quoted chain needs N−1 iterations ⇒ O(N·n) total. (Output correctness is fine today;
the cost shape is the defect.)

**Item 3 — non-idempotent output.** The 028 contract requires
`repair(repair(x)) === repair(x)` (`specs/028-mermaid-error-repair/contracts/render-pipeline.md:45`).
The existing corpus (4 entries) passes idempotence today, and the probe could not
produce a counterexample on simple inputs; the risk is real specifically in cross-rule
interplay (quoted-list collapse feeding embedded-quote escape and comma-wrap on mixed
quote/comma labels, e.g. `A[the "best", "worst" thing] --> B` chains two rules in one
pass). The issue demands the property test as an explicit regression gate; the rule
redesign (below) must satisfy it by construction, and the corpus must be widened to
every first-pass output and adversarial quote/comma-only labels (`A[,] --> B`,
`|"", ""|`, multi-rule mixes).

**Item 4 — fix affordance persists orphan rows.**
`src/lib/components/chat/rows/AssistantMessage.svelte:232` and `:254` wire
`onFixMermaid={(prompt) => void chatStore.send(prompt)}`. In
`src/lib/stores/chat.svelte.ts`, `send()` (515–528 guards) persists the user row at
571–576 (`repos.messages.append`) and enters streaming (579–588) BEFORE provider
resolution at 625 (`getActiveSdkProvider()` inside the try). A
`MissingKeyError` (`src/lib/ai/client.ts:111-133` — no active provider / removed
provider / missing key / no model) therefore lands in the catch (951–980) AFTER the row
was persisted: orphan user row + empty assistant state. Existing test
`chat.svelte.test.ts:1796-1811` (T015) asserts the surfaced error but NOT row absence —
it keeps passing under the fix.

**Item 5 — unreadable error display.** `src/lib/components/chat/Markdown.svelte`
`buildMermaidError` (49–90): reason `err.message` inside a `<code>` in a collapsed
`<details>` "Why?" (60–67); source in an always-expanded `<pre>` (69–73). Multi-line
parse errors render as a run-on (white-space collapsed) or overflow; full text requires
interaction. Issue anchors `:536-549` ("title only on hover of an info dot") are stale —
those lines are `.mermaid-fix-btn` CSS; the substance (wrapped, full message visible,
source collapsed) is authoritative.

**Item 6 — hardcoded exclusion selectors.** `src/lib/markdown/sourcemap.test.ts:195-201`
hardcodes `EXCLUDED_SELECTORS` (5 entries) inside the `domCanonical` fixture walker. The
real export `EXCLUDED_CHROME_SELECTORS` (`src/lib/chat/selection.ts:27-40`) has 12
entries — the hardcoded copy is missing `.md-copy-btn`, `.md-focusable-btn`,
`.external-link-icon`, `.mermaid-svg`, `.mermaid-pending`, `.section-strip`,
`.section-strip-preview`. The issue's claim that the export lives in `sourcemap.ts` is
wrong — it lives in `selection.ts` (corrected in the plan).

## R1. Decision: structural scoping over error-text gating (item 1)

- **Decision**: rules are scoped by diagram family and label position so each rule
  matches ONLY shapes that are never valid mermaid in that position; no parsing of
  mermaid error text.
- **Rationale**: keeps `repairMermaidSource` pure (028 contract: pure string surgery)
  and deterministic; mermaid error messages are not a stable interface. "Skip repair
  when the error is not in the repairable family" falls out structurally: a
  non-repairable failure (e.g. missing `end`) yields an identity repair, and the seam
  (`mermaid.ts:88`) already rejects with the underlying original error when
  `repairedSource === source` — the 028 contract's exact semantics.
- **Alternatives considered**: (a) gate on mermaid error text ("Expecting 'SQE'"…) —
  brittle, version-coupled, rejected; (b) line-diff the parse error position and repair
  only that line — mermaid error positions are unreliable for label faults that span
  lines, rejected.

## R2. Decision: rule-set redesign (items 1–3)

- **Decision**: `repairMermaidSource` becomes a fixed-order composition of four
  single-pass rules over a "protected-lines" partition:
  1. Line partition: directive lines (`%%{…}%%`) and comment lines (`%% …`) are
     protected — no rule touches them.
  2. `normalizeSmartQuotes` — global except protected lines (typographic quotes are
     never valid outside them).
  3. `collapseQuotedEdgeLabelLists` — only inside pipe-delimited edge labels
     (`|…|`, flowchart family): one global pass
     `/"([^"|]*)"(?:\s*,\s*"([^"|*)")+"/g`-shaped match collapsing the maximal run to a
     single quoted label `"a, b, c"`.
  4. `escapeEmbeddedQuotes` — inside `[…]`/`(…)`/`|…|` label spans only (non-protected
     lines): inner `"` → `#quot;` (unchanged mechanism from 028).
  5. `wrapUnquotedCommaNodeLabel` — flowchart family only, only brackets preceded by a
     node identifier on the same line (never numeric/data-series contexts): wrap label
     containing a comma (no quotes) in `["…"]`.
  Diagram-family detection reads the first non-protected, non-empty line
  (`graph|flowchart` ⇒ flowchart family; anything else ⇒ only rules 2 applies).
- **Rationale**: C4 argument lists live inside `Directive(…)` argument positions and
  xychart lists inside data positions — neither occurs inside flowchart `|…|` edge
  labels or after a node id + `[`, so the scoped rules cannot reach them; init JSON
  lives on protected lines. Each rule is a no-op on its own output by construction
  (no smart quotes remain; no quoted run remains inside pipes; no raw inner quotes
  remain; wrapped labels start with `"`), and rule outputs cannot create matches for
  EARLIER rules in a second application (fixed order + disjoint scopes) ⇒ idempotent.
  Single global regex per rule ⇒ O(n) per rule.
- **Alternatives considered**: keep whole-source rules but pre-strip protected regions
  and re-inject — equivalent complexity, more splice bookkeeping, rejected; dirty-range
  tracking across rules — unnecessary at these sizes, rejected ("single pass per rule"
  is the issue's own suggested remedy).
- **Trade-off (recorded)**: label rules become flowchart-family-scoped; a C4 diagram
  with an embedded-quote label fault is no longer (speculatively) rewritten — today's
  whole-source pass "repaired" such cases only by accident while corrupting valid
  ones. Broadening to other families is future work with dedicated parse-verified
  fixtures.

## R3. Decision: idempotence strategy (item 3)

- **Decision**: idempotence by construction (R2) PLUS a property-style test: for a
  corpus of broken inputs, assert `repair(repair(x)) === repair(x)` for every `x` in
  the corpus AND every first-pass output `repair(x)` (the closure guards cross-rule
  interplay). Corpus widened with adversarial cases: `A[,] --> B`, `-->|"", ""|`,
  multi-rule mixes (`A[the "best", "worst" thing]`), N-way chains, smart-quote +
  comma combos, plus the 028 canonical example (kept verbatim — SC-002 of 028).
- **Rationale**: the property is the contract; the closure-over-outputs formulation
  catches any rule that produces input for another rule differently on a second pass.

## R4. Decision: send-path provider preflight (item 4)

- **Decision**: hoist provider resolution in `chatStore.send()` to a preflight BEFORE
  the user-row append: right after the existing guards (528), resolve
  `getActiveSdkProvider()`; on rejection, run today's catch-path presentation
  (`mapSdkError` + `asImageUnsupported` refinement is not needed pre-stream — plain
  `formatProviderError(mapSdkError(err))`, set `lastFailedPrompt`, keep
  `this.error`) and return — no row, no streaming. The later `Promise.all` at 625
  reuses the already-resolved provider (no double resolution; `assembleContext`
  stays where it is).
- **Rationale**: fixes EVERY send entry point (composer, regenerate, fix affordance)
  with one seam change; keeps the 028 fix-affordance contract's trigger payload
  untouched; the surfaced error (e.g. "Missing API key … Add an API key in Settings")
  is the same guidance the composer path shows, satisfying 028 US3 scenario 3's "not
  silently failing" without reactive provider-state plumbing into the runtime-created
  button DOM.
- **Alternatives considered**: (a) a dedicated `requestFix` store method that validates
  then delegates — a second send path to keep in sync, rejected; (b) reactively
  hiding/disabling the button when no provider — requires threading provider state
  through `AssistantMessage` → `Markdown` → runtime DOM, and the 028 contract already
  states availability equals sendability, rejected for 036 (residual in spec Open
  questions is intentional).

## R5. Decision: error-block presentation (item 5)

- **Decision**: extract `buildMermaidError` from `Markdown.svelte` (49–90) into
  `src/lib/components/chat/mermaid-error-block.ts` (pure DOM builder; imports
  `buildMermaidFixPrompt`; placed beside `mermaid-center.ts`). New structure: notice →
  full failure text (`[err.name, err.message].join(': ')` for Errors, `String(err)`
  otherwise) in a `<pre class="mermaid-error-reason">` with
  `white-space: pre-wrap; overflow-wrap: anywhere` (always visible, no details) →
  diagram source in a collapsed `<details><summary>show source</summary><pre>…` → fix
  button when a handler was passed (unchanged condition). CSS: extend the existing
  `:global(.mermaid-error …)` rules in `Markdown.svelte`; remove the "Why?" details
  styling that no longer applies.
- **Rationale**: extraction makes the presentation testable without mounting a failing
  mermaid render (constitution II: UI change + regression test); pre-wrap + anywhere
  preserves line structure and prevents horizontal overflow at any width; the block
  stays excluded chrome wholesale (`.mermaid-error` selector unchanged), so expound
  alignment and the sourcemap fixtures are unaffected.
- **Alternatives considered**: keep the builder inline and test via full component
  mount with a forced render failure — needs idle-callback + mermaid-failure
  orchestration in jsdom, brittle, rejected.

## R6. Decision: exclusion test derives from the export (item 6)

- **Decision**: in `sourcemap.test.ts`, import `EXCLUDED_CHROME_SELECTORS` from
  `#lib/chat/selection.js` and iterate it in `domCanonical` (replacing the hardcoded
  5-entry copy). No change to `selection.ts`.
- **Rationale**: single source of truth; a future chrome selector added to the export
  automatically participates in coverage (the test's purpose). Cross-module test
  import is established practice (`#lib/...` alias used across store tests).

## R7. Anchor corrections (issue #72 vs current tree)

| Issue claim | Current tree (verified 2026-11-10) |
| --- | --- |
| `mermaid-repair.ts:19,30` whole-source rules | Correct: `QUOTED_LIST` at 19, `UNQUOTED_COMMA_LABEL` at 30 |
| `mermaid-repair.ts:34-36` while-loop | Correct: 34–36 |
| `AssistantMessage.svelte:232` fix wiring | Correct: 232 (and a second wiring at 254) |
| `chat.svelte.ts:543` / `:588` / `:717` send internals | Drifted: guards 528, user-row append 571–576, streaming start 579–588, provider resolution 625, catch 951–980 |
| `Markdown.svelte:60-66` error in `<code>` | Correct in substance: 60–67 (`<details>`/`<code>`) |
| `Markdown.svelte:536-549` title on hover of info dot | Stale: 536–549 is `.mermaid-fix-btn` CSS; no info dot exists; substance taken per R5 |
| `sourcemap.test.ts:195-201` hardcoded selectors | Correct: 195–201 |
| export lives in `sourcemap.ts` | Wrong: `EXCLUDED_CHROME_SELECTORS` is exported from `src/lib/chat/selection.ts:27-40` |

## R8. Test-profile note

Fleet policy (authoritative for implementers): SPA tests run ONLY under the capped
runner (see tasks.md). This machine's profile is irrelevant to the artifacts; tasks
embed the exact commands. Baseline suites that must stay green:
`src/lib/markdown/mermaid-repair.test.ts`, `src/lib/markdown/mermaid.test.ts`,
`src/lib/stores/chat.svelte.test.ts`, `src/lib/markdown/sourcemap.test.ts`.
