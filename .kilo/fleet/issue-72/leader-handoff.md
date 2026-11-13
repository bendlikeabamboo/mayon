# Leader Handoff — Issue #72

Approach: speckit pipeline to READY TO IMPLEMENT for feature **036-mermaid-repair-integrity** (branch `fix/issue-72-mermaid-repair`, never switched). The six issue items map to four stories: the repair pass is redesigned as a family-scoped, single-pass-per-rule, idempotent rule set with protected `%%{…}%%`/`%% …%%` lines (items 1–3, one slice — they share one file and one contract); the send path preflights provider resolution before the user-row append (item 4, fixes all entry points incl. the fix affordance); the error block is extracted into a testable builder showing the full wrapped failure text with the source collapsed (item 5); the exclusion test imports the live selector export (item 6). All defect mechanics were verified against the current tree by a read-only node probe (see research.md R0 — init JSON, C4 args, and xychart lists are provably mangled today) and every file:line anchor was re-verified; the issue's stale anchors are corrected in research.md R7 (`EXCLUDED_CHROME_SELECTORS` lives in `src/lib/chat/selection.ts:27`, not `sourcemap.ts`; `Markdown.svelte:536-549` is fix-btn CSS, no info dot exists). The 028 render-pipeline contract stays byte-for-byte intact: one deterministic repair attempt in the failure path, unchanged repaired source ⇒ reject with the underlying original error (`src/lib/markdown/mermaid.ts:86-93` is not modified).

## Artifacts

- Spec: `specs/036-mermaid-repair-integrity/spec.md` (US1–US4, FR-001..FR-007, SC-001..SC-004; assumptions carry every defaulted decision)
- Plan: `specs/036-mermaid-repair-integrity/plan.md` (verified anchors; constitution check pass)
- Research: `specs/036-mermaid-repair-integrity/research.md` (R0 evidence, R1–R6 decisions, R7 anchor corrections)
- Data model: `specs/036-mermaid-repair-integrity/data-model.md` (explicitly none)
- Contracts: `specs/036-mermaid-repair-integrity/contracts/repair-semantics.md`, `.../fix-send-preflight.md` (both amend 028 contracts in place)
- Quickstart: `specs/036-mermaid-repair-integrity/quickstart.md` (V1–V5 capped scenarios)
- Tasks: `specs/036-mermaid-repair-integrity/tasks.md` (T001–T012, strict checklist format, fail-first marked)
- Checklist: `specs/036-mermaid-repair-integrity/checklists/requirements.md` (iteration 1: all pass)
- Feature number: **036**; `.specify/feature.json` → `specs/036-mermaid-repair-integrity`

## Task groups

### Group 1 of 3 — Baseline + repair rule redesign (US1, items 1–3)

- [ ] T001 Baseline: run the four existing touched suites green under the capped runner — `src/lib/markdown/mermaid-repair.test.ts`, `src/lib/markdown/mermaid.test.ts`, `src/lib/stores/chat.svelte.test.ts`, `src/lib/markdown/sourcemap.test.ts` (one capped invocation, files listed together)
- [ ] T002 [US1] Add fail-first tests in `src/lib/markdown/mermaid-repair.test.ts` (extend the existing corpus block at lines 15–26): (a) preservation fixtures (fail on current rules — probe-verified): missing-`end` graph with `%%{init: {"theme":"dark", "logLevel": 1}}%%` ⇒ identity; `C4Context` with `Person_Ext(pA, "Alice", "External user")` + `Container(c1, "DB", "Stores data")` ⇒ identity; `xychart-beta` with `x-axis "months" ["Jan", "Feb", "Mar"]` + `bar [10, 20, 30]` ⇒ identity; (b) idempotence property over corpus ∪ first-pass outputs with adversarial entries (`A[,] --> B`, `-->|"", ""|`, `A[the "best", "worst" thing] --> B`, 8-element chain, smart-quote+comma mixes); (c) 8-element quoted chain collapses to one quoted label; (d) sequenceDiagram `"a", "b"` prose ⇒ identity; (e) 028 canonical example stays asserted.
- [ ] T003 [US1] Redesign `repairMermaidSource` in `src/lib/markdown/mermaid-repair.ts` (rules 10–30, composition + while-loop 32–42) per `contracts/repair-semantics.md`: protected lines (`%%{…}%%`, `%% …`); fixed-order single-pass rules — smart quotes (non-protected), quoted-list collapse scoped to `|…|` edge labels of flowchart family, `#quot;` escape in `[…]`/`(…)`/`|…|` label spans (flowchart family), comma-label wrap for identifier-preceded `[label]` (flowchart family); delete the while-loop (34–36); `buildMermaidFixPrompt` (50–61) and `mermaid.ts` (86–93) untouched.

**Context**: FAIL-FIRST: T002(a) and (d) are probe-verified red on current rules (research R0); T002(b) may pass today — required guard regardless. Family detection = first non-protected, non-empty line matches `graph|flowchart`. Keep `mermaid.test.ts` untouched — its seam tests are the contract regression.

### Group 2 of 3 — Send preflight + readable error block (US2 + US3, items 4–5)

- [ ] T004 [US2] Add fail-first store tests in `src/lib/stores/chat.svelte.test.ts` (extend/neighbor the `chatStore provider error surfacing (T015)` describe at 1796–1811; `mockedGetActiveSdkProvider` at 103–104): (a) rejecting `MissingKeyError` ⇒ after `send()`, NO user row in `repos.messages.listByChat` (today one orphan row persists — the failure), `streaming === false`, mapped `chatStore.error` + `lastFailedPrompt`, T015 assertions hold; (b) resolving provider ⇒ `send(buildMermaidFixPrompt(...))` persists exactly one visible user row.
- [ ] T005 [US2] Implement the preflight in `src/lib/stores/chat.svelte.ts` `send()` per `contracts/fix-send-preflight.md`: after guards (528) + error reset (530–531), resolve `getActiveSdkProvider()`; on rejection mirror the catch-path presentation (`formatProviderError(mapSdkError(err))`, `lastMappedError`/`lastFailedPrompt`, builder error trace) and return BEFORE append (571–576) + streaming (579–588); reuse resolved `model`/`config` (drop re-resolution in the `Promise.all` at 625); `AssistantMessage.svelte` (232, 254) unchanged.
- [ ] T006 [P] [US3] Create `src/lib/components/chat/mermaid-error-block.test.ts` (module absent — import failing IS the fail-first): `buildMermaidErrorBlock(source, err, onFix?)` ⇒ `.mermaid-error` block with notice; full text `[err.name, err.message].join(': ')` in `pre.mermaid-error-reason` NOT inside `<details>`; source in collapsed `<details><summary>` + `<pre><code>` (no `open`); `.mermaid-fix-btn` iff handler passed; `pre-wrap` class hook asserted.
- [ ] T007 [US3] Extract + rebuild: create `src/lib/components/chat/mermaid-error-block.ts` (DOM-builder style like `mermaid-center.ts`, imports `buildMermaidFixPrompt`); in `Markdown.svelte` replace inline `buildMermaidError` (49–90; call sites 146, 205) with the import; CSS 508–549: add `.mermaid-error-reason` (`white-space: pre-wrap; overflow-wrap: anywhere; max-width: 100%`), style source details, drop dead "Why?" code rules (529–533), keep `.mermaid-fix-btn` (534–549).

**Context**: FAIL-FIRST: T004(a) red today (orphan row); T006 red (no module). The T015 test (1797) does NOT assert row presence — it survives the preflight. Preflight ordering nuance: `this.error = null` reset stays before the preflight.

### Group 3 of 3 — Exclusion derivation + contracts/docs/changelog (US4 + polish, item 6)

- [ ] T008 [P] [US4] In `src/lib/markdown/sourcemap.test.ts`, delete hardcoded `EXCLUDED_SELECTORS` (195–201), import `EXCLUDED_CHROME_SELECTORS` from `#lib/chat/selection.js` (real export: `selection.ts:27-40`), iterate in `domCanonical`'s `isExcluded` (207–215); all fixtures + exclusion regressions (276, 289) stay green.
- [ ] T009 [P] Amend 028 contracts IN PLACE with 036 cross-references: `specs/028-mermaid-error-repair/contracts/render-pipeline.md` §`repairMermaidSource` (38–45) — replace rule-set sentence with 036 semantics + "*(amended in place by feature 036 — specs/036-mermaid-repair-integrity/contracts/repair-semantics.md)*"; `.../fix-affordance.md` §Availability (9–17) — preflight sentence + cross-ref to `.../fix-send-preflight.md`; `renderMermaidBlock` steps (9–34) untouched.
- [ ] T010 [P] Update `docs/reference/seams.qmd` §"Mermaid render seam (feature 028)" (184–188): repair description → "family-scoped, single-pass-per-rule repair that never rewrites `%%{…}%%` directive lines or valid C4/xychart syntax (036)"; caller sentence "failure reason behind 'Why?'" → "full failure text shown wrapped with the source collapsed (036)". One-pass verdict sentence unchanged.
- [ ] T011 [P] CHANGELOG entries inside `## [0.10.0]` → `### Fixed` (line 44 area): surgical/idempotent/single-pass repair; no-orphan-row send preflight; readable error block; derived exclusion list — existing bold-lead entry style.
- [ ] T012 Final verification (quickstart V5): `pnpm check && pnpm lint`, then ONE capped run of all five suites (`mermaid-repair.test.ts mermaid.test.ts chat.svelte.test.ts sourcemap.test.ts mermaid-error-block.test.ts`); `git status` shows only intended files; `.kilo/fleet/` never staged.

**Context**: T008 is derivation-only — NOT fail-first (and none expected). T009–T011 land after Groups 1–2 final semantics exist (they describe them). Never `git add` `.kilo/fleet/`.

## Decisions

- **Structural scoping, not error-text gating** — rules match only shapes never valid in their family/position; mermaid error strings are version-brittle and repair stays pure (research R1).
- **Rule set redesign** — protected directive/comment lines; 4 fixed-order single-pass rules; label rules scoped to flowchart family; quoted-list collapse scoped to `|…|` edge labels (research R2/contracts/repair-semantics.md). "Skip when not repairable" falls out: identity ⇒ seam rejects with the original error (028 contract intact).
- **Idempotence strategy** — by construction (each rule a no-match on its own output; disjoint scopes; fixed order) + property test over corpus ∪ first-pass outputs (closure) (R3).
- **Fix-button preflight shape** — hoist `getActiveSdkProvider()` inside `chatStore.send()` before the user-row append; no `requestFix` variant, no reactive button gating — one seam protects every entry point and surfaces the existing add-key guidance (R4, contracts/fix-send-preflight.md).
- **Error display layout** — extracted `mermaid-error-block.ts` builder; full `name: message` in a visible `pre.mermaid-error-reason` (pre-wrap + anywhere); source behind a collapsed `<details>`; fix button presence rules unchanged; block stays wholesale excluded chrome (R5).
- **Exclusion import source** — from `#lib/chat/selection.js` (where the export actually lives); issue's `sourcemap.ts` attribution corrected (R6/R7).
- **Docs/contract posture** — 028 contracts amended IN PLACE with 036 cross-references; `seams.qmd` §Mermaid updated in the same change; CHANGELOG under `## [0.10.0]` → `### Fixed` (fleet release-train rule).
- **Scope discipline** — no schema, no server, no new deps, no new fault families; C4/xychart label faults deliberately NOT repaired (identity) — speculative repair is what corrupted them.

## Verification

All SPA test runs use the capped runner, one process at a time (never plain `pnpm test`):

```bash
RUN="systemd-run --user --scope -p MemoryMax=500M --setenv=NODE_OPTIONS=--max-old-space-size=384 pnpm test:low-spec"
```

- **Group 1**: `$RUN src/lib/markdown/mermaid-repair.test.ts src/lib/markdown/mermaid.test.ts` (T001 baseline = the four suites; use the Group-1 pair after T002, full four at T001)
- **Group 2**: `$RUN src/lib/stores/chat.svelte.test.ts` and `$RUN src/lib/components/chat/mermaid-error-block.test.ts src/lib/markdown/sourcemap.test.ts`
- **Group 3**: `$RUN src/lib/markdown/sourcemap.test.ts` (T008); T012 close-out: `pnpm check && pnpm lint` then `$RUN src/lib/markdown/mermaid-repair.test.ts src/lib/markdown/mermaid.test.ts src/lib/stores/chat.svelte.test.ts src/lib/markdown/sourcemap.test.ts src/lib/components/chat/mermaid-error-block.test.ts`

## Open questions

- Smart quotes inside an `%%{init}%%` directive's JSON are never repaired (protected lines; rare fault) — directive-local repair is future work if ever needed.
- 028 US3 scenario 3's "visibly unavailable" affordance is satisfied by the preflight's surfaced guidance rather than reactively hiding/disabling the button — reactive button gating remains an option if product wants it.
- Non-flowchart label faults (C4, xychart, sequence) are no longer speculatively rewritten — broadening rule families requires dedicated parse-verified fixtures (future feature).
