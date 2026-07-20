# Plan — Expound source map: P4 (cleanup verify) + P5 (docs & acceptance)

**Source refinement:** `refinement/2026-07-19_expound-source-map.md` (§7 P4, §8 P5, §9 gates).
**Date:** 2026-07-20.
**Scope:** Close out the expound source-map epic. P0–P3 shipped in prior sessions;
P4's code cleanup landed with them. This plan is **P4 verify-only** + **P5 docs and
manual acceptance**.

## Starting-state finding (verified by code inspection, not assumption)

P4 code cleanup is **already complete**:

- `src/lib/chat/highlight.ts` and its test are deleted; `selection.ts`,
  `wrap-range.ts`, `sourcemap.ts` exist.
- Grep sweep all zero hits: `resolveSelectionOffsets | collapseStripped |
  MARKDOWN_SYNTAX | surroundContents | findOccurrence`.
- Full-span fallback gone; `chatStore.createExpoundBranch`
  (`src/lib/stores/chat.svelte.ts:767`) takes `ResolvedOffsets`; its tests pass
  `{startChar,endChar,excerpt}`.
- `Highlighter.svelte` imports `canonicalize`/`alignDomToCanonical`/
  `resolveSelection`/`wrapRange`; no duplicate `collapse`/`findOccurrence`.
- `expound.ts` header + store doc-comment already reference `resolveSelection`
  + the source map.

So **no source-code deletion/edit is required for P4** — only verification.

## Resolved decisions

1. **architecture.qmd edit width:** broader audit (not just lines 71–72).
2. **Audit depth:** accuracy + selective completeness — fix every stale factual
   claim, add the required expound/source-map subsection, add a brief `lib/agent`
   note; for absent infra subsystems (MCP, sandbox DB, backup, search/FTS,
   boot-gating) add one-line pointers to the AGENTS.md phase gates rather than
   full sections.
3. **AGENTS.md:** add a concise boundary bullet capturing source-map invariants.
4. **Notes file:** create `refinement/2026-07-20_notes_on_use.md` with the
   one-line pointer entry; leave the empty `2026-07-18_notes_on_use.md` alone.

---

## P4 — Verify (no code edits expected)

1. Re-run the grep sweep; confirm zero hits in `src/`:
   `rg -n 'resolveSelectionOffsets|collapseStripped|MARKDOWN_SYNTAX|surroundContents|findOccurrence' src/`
2. Confirm no stale type references:
   `rg -n 'SelectionInput|startChar: 0, endChar: excerpt\.length' src/` (expect none).
3. Confirm `highlight.ts`/`highlight.test.ts` absent from `src/lib/chat/`.
4. Run the suite: `pnpm lint && pnpm check && pnpm test`. Must be green (last
   session reported 947 tests passing; this re-confirms nothing regressed).
5. If any of 1–4 fail, stop — that means P4 has real remaining work; surface it
   before proceeding to P5.

**P4 acceptance:** sweep clean + suite green. No code edits made.

---

## P5 — Docs

### 5A. `docs/dev/architecture.qmd` — accuracy + selective audit

Re-verify each item against current code at edit time (some findings are from
grep/memory). Apply:

**Required (the P5 core):**
- **New subsection "Expound / source map"** under `## UI stack` (after the
  streaming-render bullet, ~line 73). One paragraph: expound offsets are
  raw-markdown (code-space) offsets resolved deterministically against a source
  map (`src/lib/markdown/sourcemap.ts`, built from mdast positions on the same
  unified processor as the HTML pipeline) and aligned to the rendered DOM
  (`src/lib/chat/selection.ts`); underlines wrap via `src/lib/markdown/wrap-range.ts`
  (no `surroundContents`); selections touching generated content (math, mermaid,
  copy-button chrome) disable the menu; stale rows self-heal in memory at render
  time (no DB write).

**Accuracy fixes (verified stale):**
- **Line 71** — replace `marked + DOMPurify for markdown; KaTeX (math) and shiki
  (code) optional` with the real pipeline per `src/lib/markdown/render.ts:1-27`:
  unified/remark → `remark-parse → remark-gfm → remark-math → remark-rehype →
  rehype-katex → rehype-highlight → rehype-sanitize` (KaTeX math, lowlight/
  highlight.js code). No marked, no DOMPurify, no shiki.
- **Line 72** — replace the old "Selection/Range API captures startChar/endChar"
  Highlighter bullet with a one-line pointer to the new Expound/source-map
  subsection (do not duplicate the paragraph).
- **Line 26** — AI row lists only `OpenAI/Anthropic/Gemini/Ollama`; add the
  OpenAI-compatible gateways/templates per `src/lib/ai/registry.ts`
  (default Z.AI/GLM, plus OpenRouter, Kilo Gateway, generic OpenAI-compatible).
- **Line 45** — routes block is missing `/search`; add it (verified in
  `src/routes/`).
- **Lines 47–48** — the `lib/ai` box omits the shipped `lib/agent` (tool loop,
  registry, capability gating, critic, deterministic/generative tools per
  `src/lib/agent/`). Add a `lib/agent` line. Verify `generateLab`/`generateQuiz`
  still named as in doc (`generate.ts:79`, `generate-quiz.ts:151` — confirmed);
  **verify `gradeAnswer` still exists with that name** (grep did not surface it —
  may be renamed; correct the doc to the actual export).
- **Line 50** — `lib/chat` box: add `expound/source-map` and `assembleContext`
  (lives in `src/lib/chat/context.ts`).
- **Line 200** — `quiz_answers.is_correct` is documented `INTEGER` but
  `src/lib/db/schema.ts:163` is `boolean('is_correct')`. Correct to `BOOLEAN`.
- **Lines 256–269 (Project structure)** — component inventory is stale: says
  `TreeSidebar` (actual `Sidebar.svelte`); lists flat components but real layout
  is subdirs `ai/ chat/ labs/ quizzes/ settings/ mcp/ diagnostics/ ui/` under
  `src/lib/components/`. Rewrite the block to reflect actual dirs (verify via
  `ls src/lib/components/`). Also add missing `src/lib/` dirs present in the
  tree: `agent/`, `mcp/`, `services/`, `stores/`, `markdown/`, `dev/`.

**Selective completeness (brief, not full sections):**
- One-line note for `lib/agent` (agent tool/loop system) — app-logic core beside
  `lib/chat`, currently undocumented.
- A short "Infrastructure subsystems" bullet list pointing to AGENTS.md phase
  gates for: MCP tooling (P2), sandbox DB (P4), backup/restore (P5/pg-5),
  search/FTS (P-pg-4), boot-gating/server-caps (P-pg-3). One sentence each; do
  not reproduce the AGENTS.md gate detail.

### 5B. `AGENTS.md` — boundary bullet

Under `## Architecture boundaries (do not violate)`, add a 2–4 line bullet:

> **Expound offsets are raw-markdown offsets** resolved via the source map
> (`src/lib/markdown/sourcemap.ts`) + DOM alignment (`src/lib/chat/selection.ts`),
> wrapped by `src/lib/markdown/wrap-range.ts`. Do not re-introduce substring
> heuristics, `surroundContents`, or the `startChar=0` full-span fallback.
> Selections touching generated content (math, mermaid, copy-button chrome)
> disable the menu; stale rows self-heal in memory only (no DB write).

### 5C. Notes pointer

Create `refinement/2026-07-20_notes_on_use.md` with a one-line entry pointing at
`refinement/2026-07-19_expound-source-map.md` (shipped: P0–P4 done; P5 docs this
date). Match the freeform style of the other `*_notes_on_use.md` files.

### 5D. Acceptance for docs

- `pnpm lint && pnpm check` green (docs-only change; `pnpm test` should be
  unchanged-green from P4).
- `rg -n 'marked|DOMPurify|shiki|TreeSidebar' docs/dev/architecture.qmd` → no
  hits.
- New Expound/source-map subsection present; `lib/agent` mentioned; `/search`
  route present; `is_correct` documented `BOOLEAN`.

---

## P5 — Manual acceptance gates (§9, human/browser)

Reproduce each reported failure mode; each must now be exact. These require a
running `docker compose up` stack + a real assistant reply containing the
constructs. Mostly human; the implementer runs the browser checks.

- **Across emphasis:** reply with `**bold** and `code` and [a link](u)` → select
  a span crossing all three → Expound → underline covers exactly the selection.
- **Duplicate prose:** `"the cat chased the bird in the tree"` → select the
  second "the" → underline on the second, not first/third.
- **Lists / tables:** select across list items / table cells → exact underline.
- **Generated — Mermaid:** select over a rendered Mermaid diagram → Expound
  disabled, hint "Can't branch from a rendered diagram or formula."
- **Generated — math:** select over `$E=mc^2$` output → disabled, same hint.
- **Copy button:** select prose including a code block's "Copy" text → disabled.
- **Self-heal:** a DB row stored under the old heuristic whose
  `raw.slice(start,end)` ≠ excerpt → reload → underline lands correctly via
  in-memory re-resolve; verify `branch_sources` row unchanged (no DB write).
- **Persistence:** reload → underline survives and still lands exactly.
- No new automated tests required — P3 `wrap-range.test.ts` self-heal + cross-
  element cases and P2 `selection.test.ts` duplicate-prose/generated cases
  already cover the logic; §9 is the human confirmation.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| A doc "fix" introduces a new inaccuracy (e.g., wrong route/component name). | Each edit re-verified against code at edit time; `rg` sweep at 5D catches leftovers (`marked`, `DOMPurify`, `shiki`, `TreeSidebar`). |
| `gradeAnswer` renamed since the doc was written. | Verify the actual export before editing line 48; correct to the real name (or remove if split into quiz-grading flow). |
| Selective-completeness pointers drift from AGENTS.md gate names. | Use the exact phase headings from AGENTS.md (`P2`, `P4`, `P-pg-3/4/5`). |
| Doc edit accidentally widens into full subsystem re-documentation. | Scope locked by decision #2: infra = one-line pointers only. |

## Out of scope

- Re-documenting MCP, sandbox DB, backup, search/FTS, or boot-gating in full
  (one-line pointers only; AGENTS.md remains the detailed source).
- Write-back of self-healed offsets to the DB (still render-only; refinement
  §11).
- Any source-code change to the expound/selection/sourcemap/wrap-range modules.
- Multi-message selections, `.expound-mark` CSS changes (refinement §11).
- Updating the stale kilo memory fact `project.md … highlight_expound_architecture`
  (still describes deleted `highlight.ts`) — noted as housekeeping: once P5
  ships, run `kilo_memory_save` to correct that fact and the
  `highlight_expound_architecture` project_fact to reference `selection.ts` +
  `wrap-range.ts` + `sourcemap.ts`. Not a code task.

## Validation summary

`pnpm lint && pnpm check && pnpm test` green (P4 + 5D); §9 manual gates pass;
grep sweeps clean (`resolveSelectionOffsets|collapseStripped|MARKDOWN_SYNTAX|
surroundContents|findOccurrence` in `src/`; `marked|DOMPurify|shiki|TreeSidebar`
in `docs/dev/architecture.qmd`).
