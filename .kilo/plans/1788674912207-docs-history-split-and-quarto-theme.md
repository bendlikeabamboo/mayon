# Plan: Split decision history into per-feature pages + condense specs/ideas folders + barangay-style docs facelift

## Goal

1. **Condense** every folder-based feature in `specs/` (12 folders, 013–020) and `ideas/` (8 folders, 001–008) into the docs decision history, then **delete the source folders** (user-ruled; same pattern as feature 013 for retired specs 001–012).
2. **Split** the single 588-line `docs/history/index.qmd` into per-feature pages (one page per feature) — less scrolling.
3. **Facelift** the docs site to match `~/projects/barangay/quarto-docs` aesthetics (cosmo theme, footer, page-nav, repo actions, card-grid landing).

Excluded by user: loose root files (`specs/history-map.md` stays as tombstone; the 13 loose `ideas/*.md` files stay untouched, uncondensed).

## Verified facts the implementer needs

- `docs/history/index.qmd` covers features 001–012 in 3 arcs (A/B/C) with per-entry format: `> **Status:** …`, **Goal.**, **Why.**, **Outcome & reversals.**, **Learnings.**, plus arc intro/retrospective paragraphs and "Where the story stands". Entries keep `{#sec-NNN}` anchors.
- Idea→spec mapping (verified via each spec's `Input` line): ideas/001→specs/014, ideas/002→specs/017-secure-public-launch, ideas/003→specs/017-section-peek-strip (+ relates to specs/015), ideas/004→specs/017-mock-llm-chat-tests, ideas/005→specs/018, ideas/006→specs/019-diataxis-docs-website, ideas/007→specs/020-rc-ui-verification, ideas/008→specs/020-branch-backprop. Standalone specs: 013, 016, 019-security-posture-detection.
- **All 12 spec features shipped except `specs/015-floating-reply-outline`** — spec'd (spec/plan/contracts), never implemented (no tasks.md, no impl commits, no ReplyOutline component). Its contract primitives shipped via 017-section-peek-strip; its floating panel is the recorded future upgrade path. Record its status accordingly.
- Duplicate spec numbers are real: 017 ×3, 019 ×2, 020 ×2. Filenames disambiguate by slug.
- Docs build: `quarto render docs/` → `build/docs`, deployed by `.github/workflows/deploy-pages.yml` which also runs an offline lychee internal-link check on every push to main.

## Load-bearing references INTO the folders being deleted (must retarget)

| Referencing file | References | Action |
|---|---|---|
| `docs/how-to/building.qmd:83` | `specs/020-rc-ui-verification/contracts/mock-llm-protocol.md` | preserve → appendix; retarget link |
| `tests/fixtures/mock-llm/README.md:7` (relative link) | same contract | retarget to appendix path |
| `tests/fixtures/mock-llm/markers.mjs:3`, `tests/e2e/fixtures/kitchen-sink.ts:22` | same contract (comments) | retarget comment |
| `src/lib/ai/generate/assembly.ts:3,24` | `specs/020-rc-ui-verification/contracts/prompt-settings-contract.md` | preserve → appendix; retarget comment |
| `src/lib/ai/vision-capability.ts:3` | `specs/018-image-chat-parts/contracts/provider-vision-flag.md` | preserve → appendix; retarget comment |
| `src/lib/chat/propagation.ts:9` | `specs/020-branch-backprop/data-model.md` (raw-delta format) | preserve → appendix; retarget comment |
| `packages/shared/src/protocol.ts:55` | `specs/016-github-copilot-support/contracts/copilot-server-api.md` | preserve → appendix; retarget comment |
| `packages/shared/src/auth.ts:3` | `specs/017-secure-public-launch/contracts/auth-api.md` | preserve → appendix; retarget comment |
| `src/lib/chat/images.ts:2` | `specs/018-image-chat-parts` research (provenance only) | retarget comment to the new history page (no appendix needed) |
| `docs/explanation/architecture.qmd:333` | `../history/index.qmd#sec-009` anchor | retarget to the new `009-provider-request-settings.qmd` page |

Test descriptions mentioning "specs/018 FR-…" (`vision-gate.test.ts`, `chat.svelte.test.ts`) are provenance only — leave.

## Tasks (in order)

### A. Preserve load-bearing contracts as appendices
1. Copy verbatim into `docs/history/appendices/` with the same provenance comment header style used by existing appendices (`preserved from <path> @ <commit>`, copied date):
   - `020-mock-llm-protocol.md` ← specs/020-rc-ui-verification/contracts/mock-llm-protocol.md
   - `020-prompt-settings-contract.md` ← specs/020-rc-ui-verification/contracts/prompt-settings-contract.md
   - `018-provider-vision-flag.md` ← specs/018-image-chat-parts/contracts/provider-vision-flag.md
   - `020-branch-backprop-data-model.md` ← specs/020-branch-backprop/data-model.md
   - `016-copilot-server-api.md` ← specs/016-github-copilot-support/contracts/copilot-server-api.md
   - `017-auth-api.md` ← specs/017-secure-public-launch/contracts/auth-api.md
2. Retarget every reference in the table above to the appendix paths (comment-only code edits; no behavior changes).

### B. Split old history (001–012) into per-feature pages
3. Create `docs/history/<NNN>-<slug>.qmd` for 001–012 (slugs exactly as in `specs/history-map.md`: brave-search-mcp, chat-timeline-kinds, timeline-ux-fixes, internal-area-unification, shape-driven-results, ai-elements-adoption, inference-provider-templates, inference-router-templates, provider-request-settings, custom-expound-instructions, podman-support, ui-visual-articulation). Each page: YAML `title: "NNN — <name>"`, the entry's existing prose moved over verbatim (Status blockquote, Goal, Why, Outcome & reversals, Learnings).
4. Rewrite intra-file cross-references that pointed at `#sec-NNN` anchors into links to the new pages (e.g. "superseded → #004").

### C. Write the new-era entries (one page per spec folder; idea stage folded in)
5. Create 12 pages, filename = spec folder slug, same entry format, ≤700 words each (013's discipline). Draw Goal/Why from the spec `Input` + idea `decisions.md` verdict + deck cards; Outcome/reversals from plan/tasks/quickstart/CHANGELOG/git log; Learnings from research/decisions. Status per current reality (all shipped except 015 = "designed, not built; primitives shipped via 017; panel is the future upgrade path"). Cross-link idea↔spec relationships (esp. 015↔017-strip, ideas/005's remaining voice/video slices as future work, ideas/008→020-branch-backprop).
   - `013-consolidate-spec-history`, `014-settings-navigation`, `015-floating-reply-outline`, `016-github-copilot-support`, `017-mock-llm-chat-tests`, `017-section-peek-strip`, `017-secure-public-launch`, `018-image-chat-parts`, `019-diataxis-docs-website`, `019-security-posture-detection`, `020-branch-backprop`, `020-rc-ui-verification`

### D. Rebuild `docs/history/index.qmd` as an overview
6. New index: updated intro (24 features, not "twelve"), the three existing arc intros + retrospectives (Arc A/B/C prose stays, now wrapping links to pages), new arc groupings for the new era — proposed: **Arc D — Trust, gates & the industrialized practice** (013, 017-secure-public-launch, 017-mock-llm-chat-tests, 019-security-posture-detection, 020-rc-ui-verification) and **Arc E — Surface, reach & the docs themselves** (014, 017-section-peek-strip, 015, 016, 018, 020-branch-backprop, 019-diataxis-docs-website) — plus a complete feature→page table and the "Where the story stands" close, extended for the new era. Refine arc names/ordering chronologically while writing.
7. Update `docs/_quarto.yml` sidebar 'Decision history' section: index first, then nested `section:` per arc with the 24 pages in order.

### E. Tombstones + numbering sentinels (deletion safety)
8. Update `specs/history-map.md`: fix the 12 "History entry" links to the new per-feature pages; add rows for 013–020 (and the 8 idea folders mapped to their spec/docs page); update sentinel to "Last used feature number: 020"; append a second "Retired: 2026-09-XX" line for this consolidation.
9. Create `ideas/history-map.md` tombstone (same style): rows 001–008 → resulting spec → docs page; sentinel "Last used idea number: 008"; git-recovery note.
10. Patch the sequential-numbering rules so retired numbers are never reused once dirs are gone (scan would otherwise restart at 001):
    - `.kilo/commands/speckit.specify.md` + `.github/skills/speckit-specify/SKILL.md`: "next available NNN = max(scan of `specs/`, `specs/history-map.md` sentinel)".
    - `.kilo/commands/speckit.prespec.idea.md`: same fallback via `ideas/history-map.md` sentinel.

### F. Delete the condensed folders
11. `git rm -r` the 12 `specs/` folders and 8 `ideas/` folders listed above. Do NOT delete `specs/` or `ideas/` dirs themselves, `specs/history-map.md`, the new `ideas/history-map.md`, or the loose `ideas/*.md` files.

### G. Aesthetics — mirror barangay (`~/projects/barangay/quarto-docs/_quarto.yml`)
12. `docs/_quarto.yml`:
    - Add `format: html: theme: cosmo, toc: true, toc-location: right, smooth-scroll: true`.
    - `website:` add `page-navigation: true`, `repo-actions: [issue, source]`, `open-graph: true`, and a `page-footer: center:` with GitHub · Releases links.
    - Flatten the navbar: drop the "Sections" dropdown; left = Home, Tutorials, How-to guides, Reference, Explanation, Dev notes, Decision history.
    - Keep sidebar `style: floating`, `search`, `collapse-level: 2` (or drop `style` to match barangay's default — cosmetic; either is fine).
13. Facelift `docs/index.qmd` into a barangay-style landing: one-paragraph hero (what Mayon is), a "Choose your path" `::: {layout-ncol="3"}` grid covering the six sections with their one-line intents (from the current table), and a short quick-start code block (`docker compose pull && docker compose up -d` / `pnpm dev`). Keep it modest — no badges/SEO scripts.

### H. Wrap-up
14. Add a `## [Unreleased]` CHANGELOG bullet noting the history split/consolidation and docs theme change.
15. Validate (below), then done — no commit unless the user asks.

## Validation

1. Coverage bijection: `ls -d specs/*/ ideas/*/` (before deletion) vs the docs/history page list — exactly one page per folder, none missing, none extra (loose files excluded).
2. No dangling references: repo-wide grep for `specs/(013|014|015|016|017|018|019|020)-` and `ideas/00[1-8]` outside `docs/history/`, both history-map files, and legacy appendix provenance headers — must return nothing.
3. `quarto render docs/` (if quarto is installed locally; otherwise rely on CI) + `lychee --offline --no-progress build/docs` (CI runs this on push to main) — zero broken internal links.
4. `pnpm lint` (comment-only TS edits in src/packages/tests must stay prettier/eslint clean; note `tests/fixtures/` is prettier-ignored).
5. `pnpm test` quick run — comment-only edits, expect green.

## Risks / notes

- Old deep links (`history/index.html#sec-001…012`) will drift to the new per-feature pages; accepted (update the two in-repo referrers: `specs/history-map.md`, `docs/explanation/architecture.qmd:333` `#sec-009` link).
- `docs/history/appendices/` files keep their pre-existing provenance comments pointing at already-deleted specs 001–012 — that's the established 013 pattern; leave as-is.
- Appendices are not sidebar-listed (unchanged behavior).
- cosmo re-skins every page (fonts/colors) — that's the point of the facelift; no content changes needed for it.
- Do not reuse feature numbers 001–020 (sentinels now enforce this for both specs and ideas).

## Out of scope

- Condensing or deleting the loose `ideas/*.md` files.
- The app UI (docs site only; the app's low-contrast theme ruling does not apply here).
- Release/version bumps.
