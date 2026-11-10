---
description: "Task list for feature 036-mermaid-repair-integrity"
---

# Tasks: Mermaid Repair Integrity (028 defects)

**Input**: Design documents from `/specs/036-mermaid-repair-integrity/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Explicitly requested (issue #72 acceptance bullets + constitution II). Fail-first: every test task below MUST be observed failing for the stated reason BEFORE its implementation task runs (exception: T001 baseline must PASS).

**Test runner (STRICT, fleet policy)** — SPA tests ONLY as:

```bash
systemd-run --user --scope -p MemoryMax=500M \
  --setenv=NODE_OPTIONS=--max-old-space-size=384 \
  pnpm test:low-spec <files>
```

One process at a time. Never plain `pnpm test`/vitest/watch. No Docker, no `pnpm dev`, no git mutations.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (e.g. US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the touched suites are green before any edit.

- [ ] T001 Baseline: run the four existing touched suites green under the capped runner — `src/lib/markdown/mermaid-repair.test.ts`, `src/lib/markdown/mermaid.test.ts`, `src/lib/stores/chat.svelte.test.ts`, `src/lib/markdown/sourcemap.test.ts` (one capped invocation, files listed together)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: None — no schema, deps, or shared infra changes; stories are independent
slices over `src/lib/markdown/mermaid-repair.ts`, `src/lib/stores/chat.svelte.ts`,
`src/lib/components/chat/Markdown.svelte` (+ new builder module), and
`src/lib/markdown/sourcemap.test.ts`. Proceed directly to user stories.

**Checkpoint**: N/A — start Phase 3 immediately after T001.

---

## Phase 3: User Story 1 - Repair fixes only what is broken (Priority: P1) 🎯 MVP

**Goal**: Family-scoped, single-pass, idempotent repair rules that never rewrite
protected lines or valid C4/xychart/init syntax; 028 seam contract untouched.

**Independent Test**: quickstart V1 (capped: `src/lib/markdown/mermaid-repair.test.ts src/lib/markdown/mermaid.test.ts`).

### Tests for User Story 1 ⚠️ FAIL FIRST

- [ ] T002 [US1] Add fail-first tests in `src/lib/markdown/mermaid-repair.test.ts` (extend the existing corpus block at lines 15–26):
  (a) **preservation fixtures** (fail on current rules — probe-verified 2026-11-10): a `graph TD` diagram failing only via a missing `end` while containing `%%{init: {"theme":"dark", "logLevel": 1}}%%` asserts `repairMermaidSource(x) === x`; a `C4Context` diagram with `Person_Ext(pA, "Alice", "External user")` + `Container(c1, "DB", "Stores data")` asserts identity; an `xychart-beta` diagram with `x-axis "months" ["Jan", "Feb", "Mar"]` + `bar [10, 20, 30]` asserts identity;
  (b) **idempotence property**: for every corpus entry AND every first-pass output `repair(x)`, `repair(repair(x)) === repair(x)` (closure over outputs; add adversarial entries: `A[,] --> B`, `-->|"", ""|`, `A[the "best", "worst" thing] --> B`, an 8-element quoted chain, smart-quote + comma mixes);
  (c) **single-pass chain collapse**: `-->|"a", "b", …, "h"|` repairs to exactly `-->|"a, b, …, h"|` (one quoted label);
  (d) **non-flowchart identity**: a `sequenceDiagram` message containing `"a", "b"` prose asserts identity (current rules rewrite it);
  (e) the 028 canonical example + existing corpus/identity expectations stay asserted.

### Implementation for User Story 1

- [ ] T003 [US1] Redesign `repairMermaidSource` in `src/lib/markdown/mermaid-repair.ts` (current rules at 10–30, composition + while-loop at 32–42) per `contracts/repair-semantics.md`: partition protected lines (`%%{…}%%`, `%% …`); apply, in fixed order, each exactly once — smart-quote normalization (non-protected lines), quoted-list collapse scoped to `|…|` edge labels of flowchart-family diagrams (first non-protected line declares `graph|flowchart`), embedded-quote `#quot;` escape scoped to `[…]`/`(…)`/`|…|` label spans (flowchart family, non-protected lines), unquoted-comma node-label wrap scoped to identifier-preceded `[label]` brackets (flowchart family); delete the `while` loop (34–36); leave `buildMermaidFixPrompt` (50–61) and `src/lib/markdown/mermaid.ts` failure path (86–93, identity-reject at 88) untouched; T002 + the existing suites (028 corpus, `mermaid.test.ts` seam contract) must be green under the capped runner.

**Checkpoint**: US1 independently testable — preservation fixtures green, idempotence property green, seam contract tests unchanged and green.

---

## Phase 4: User Story 2 - Fix action never leaves orphan rows (Priority: P2)

**Goal**: `chatStore.send()` preflights provider resolution before persisting anything;
all send entry points inherit the guarantee.

**Independent Test**: quickstart V2 (capped: `src/lib/stores/chat.svelte.test.ts`).

### Tests for User Story 2 ⚠️ FAIL FIRST

- [ ] T004 [US2] Add fail-first store tests in `src/lib/stores/chat.svelte.test.ts` (extend/neighbor the `chatStore provider error surfacing (T015)` describe at 1796–1811; `mockedGetActiveSdkProvider` already wired at 103–104):
  (a) with `getActiveSdkProvider` rejecting `MissingKeyError`: after `chatStore.send('fix this diagram…')`, `repos.messages.listByChat(chatId)` contains NO user row (today exactly one orphan row is persisted — that is the failure), `chatStore.streaming === false`, `chatStore.error` carries the mapped guidance, `chatStore.lastFailedPrompt` recorded, and the pre-existing T015 assertions still hold;
  (b) with `getActiveSdkProvider` resolving (existing mock patterns): `send(buildMermaidFixPrompt(src, reason))` persists exactly one visible user row (no `hidden` metadata) — 028 fix-affordance contract preserved.

### Implementation for User Story 2

- [ ] T005 [US2] Implement the preflight in `src/lib/stores/chat.svelte.ts` `send()` per `contracts/fix-send-preflight.md`: after the guards (line 528) and the error-state reset (530–531), resolve `getActiveSdkProvider()`; on rejection, mirror the catch path's presentation — `formatProviderError(mapSdkError(err))` into `this.error`, set `this.lastMappedError`/`this.lastFailedPrompt`, emit the `builder` error trace event — and return BEFORE the user-row append (571–576) and streaming start (579–588); on success, reuse the resolved `model`/`config` (drop the re-resolution in the `Promise.all` at 625 — `assembleContext` stays), keeping `providerFetchFor(config)` (629) and everything downstream unchanged; `AssistantMessage.svelte` wiring (232, 254) stays untouched.

**Checkpoint**: US2 independently testable — no-orphan-row test green, T015 green, normal send round-trips unchanged.

---

## Phase 5: User Story 3 - Readable, wrapped failure display (Priority: P3)

**Goal**: Full failure text always visible and wrapped; source collapsed; fix button
presence rules unchanged; block stays excluded chrome.

**Independent Test**: quickstart V3 (capped: `src/lib/components/chat/mermaid-error-block.test.ts src/lib/markdown/sourcemap.test.ts`).

### Tests for User Story 3 ⚠️ FAIL FIRST

- [ ] T006 [P] [US3] Create `src/lib/components/chat/mermaid-error-block.test.ts` for the new builder module (absent today — the import failing IS the fail-first evidence): `buildMermaidErrorBlock(source, err, onFix?)` returns the `.mermaid-error` block whose (a) notice text is present; (b) full failure text `[err.name, err.message].join(': ')` (or `String(err)`) lives in a `pre.mermaid-error-reason` that is NOT inside any `<details>`; (c) diagram source sits inside a collapsed `<details><summary>` + `<pre><code>` (no `open` attribute); (d) a `.mermaid-fix-btn` button exists iff a handler was passed; (e) `pre-wrap` is carried by the class hook (assert the class name; CSS lives in Markdown.svelte).

### Implementation for User Story 3

- [ ] T007 [US3] Extract and rebuild the error block: create `src/lib/components/chat/mermaid-error-block.ts` exporting `buildMermaidErrorBlock(source: string, err: unknown, onFix?: (prompt: string) => void): HTMLElement` (imports `buildMermaidFixPrompt` from `#lib/markdown/mermaid-repair.js`; DOM-builder style like `mermaid-center.ts`); in `src/lib/components/chat/Markdown.svelte`, replace inline `buildMermaidError` (49–90) with the import and update both call sites (146, 205); restyle the `:global(.mermaid-error …)` CSS (508–549): add `.mermaid-error-reason` with `white-space: pre-wrap; overflow-wrap: anywhere; max-width: 100%`, style the new source `<details>`, drop the dead "Why?" `<code>` rules (529–533); keep `.mermaid-fix-btn` rules (534–549) unchanged.

**Checkpoint**: US3 independently testable — builder tests green; sourcemap exclusion fixtures green (block still wholesale-excluded); `pnpm check` clean (Svelte + new module).

---

## Phase 6: User Story 4 - Exclusion coverage derives from the export (Priority: P3)

**Goal**: The DOM-canonical coverage walker iterates the live exclusion selector list.

**Independent Test**: quickstart V4 (capped: `src/lib/markdown/sourcemap.test.ts`).

### Implementation for User Story 4

- [ ] T008 [P] [US4] In `src/lib/markdown/sourcemap.test.ts`, delete the hardcoded `EXCLUDED_SELECTORS` array (195–201) and import `EXCLUDED_CHROME_SELECTORS` from `#lib/chat/selection.js` (the actual export lives there at 27–40 — NOT in `sourcemap.ts` as issue #72 states), iterating it in `domCanonical`'s `isExcluded` (207–215); every existing fixture and the two exclusion regression tests (276, 289) must stay green (derivation change only, no behavior change — not fail-first, and none expected).

**Checkpoint**: US4 independently testable — coverage suite green with the live import; `grep EXCLUDED_SELECTORS src/lib/markdown/sourcemap.test.ts` returns nothing.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Contract amendments, docs, changelog, full verification.

- [ ] T009 [P] Amend the 028 contracts IN PLACE with 036 cross-references: `specs/028-mermaid-error-repair/contracts/render-pipeline.md` §`repairMermaidSource` (38–45) — replace "Rule set is small, explicit…" with the 036 semantics (protected lines; family-scoped single-pass rules; idempotence property over corpus ∪ first-pass outputs) and add "*(amended in place by feature 036 — `specs/036-mermaid-repair-integrity/contracts/repair-semantics.md`)*"; `specs/028-mermaid-error-repair/contracts/fix-affordance.md` §Availability (9–17) — add the preflight sentence and the same cross-reference (`…/fix-send-preflight.md`). The render-seam steps (§`renderMermaidBlock`, 9–34) stay untouched.
- [ ] T010 [P] Update `docs/reference/seams.qmd` §"Mermaid render seam (feature 028)" (184–188): keep the seam paragraph's one-pass verdict sentence, update the repair description to "family-scoped, single-pass-per-rule repair that never rewrites `%%{…}%%` directive lines or valid C4/xychart syntax (036)", and update the caller sentence "failure reason behind 'Why?'" to "full failure text shown wrapped with the source collapsed (036)".
- [ ] T011 [P] Add CHANGELOG entries inside `## [0.10.0]` → `### Fixed` (line 44 area): one entry for the surgical/idempotent/single-pass mermaid repair (036, issue #72 items 1–3), one for the no-orphan-row send preflight (item 4), one for the readable error block (item 5), one for the derived exclusion list (item 6) — follow the existing `### Fixed` entry style (bold lead + em-dash summary).
- [ ] T012 Final verification (quickstart V5): `pnpm check && pnpm lint`, then ONE capped run of all five suites — `src/lib/markdown/mermaid-repair.test.ts src/lib/markdown/mermaid.test.ts src/lib/stores/chat.svelte.test.ts src/lib/markdown/sourcemap.test.ts src/lib/components/chat/mermaid-error-block.test.ts`; confirm `git status` shows only intended files (no stray artifacts, `.kilo/fleet/` never added).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (T001)**: no dependencies — blocks all stories.
- **Phase 2**: empty — nothing blocks the stories.
- **Phases 3–6 (US1→US4)**: independent file sets; can proceed sequentially (priority
  order) or in parallel across implementers. Within a story, tests (fail-first) MUST
  precede implementation.
- **Phase 7**: T009–T011 are mutually parallel ([P]) but depend on their story's
  implementation being final (T009/T010 after T003+T005+T007 land the semantics they
  describe); T012 depends on everything.

### User Story Dependencies

- **US1 (T002→T003)**: self-contained in `src/lib/markdown/mermaid-repair*.ts`; the seam (`mermaid.ts`) is untouched.
- **US2 (T004→T005)**: self-contained in `chat.svelte.ts` (+ its test); no dependency on US1.
- **US3 (T006→T007)**: new module + `Markdown.svelte`; no dependency on US1/US2.
- **US4 (T008)**: single test file; no dependencies.

### Parallel Opportunities

- T006 [P] and T008 [P] are different files — can run together or alongside US1/US2 work.
- T009, T010, T011 are different files — parallel once the described semantics have landed.
- Within US1/US2/US3, test task → implementation task are strictly sequential (same file pair).

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001 baseline green.
2. T002 fail-first tests red for the stated reasons (preservation fixtures certain-red; property suite documented).
3. T003 redesign lands US1 — repair integrity restored (the issue's highest-severity item).
4. STOP and VALIDATE via quickstart V1 before pulling US2–US4 forward.

### Incremental Delivery

US2 (store integrity) → US3 (presentation) → US4 (test derivation) each land
independently with their own capped verification; Phase 7 closes contracts/docs/changelog
and runs the full capped sweep (T012).

## Notes

- Anchors in task text were verified against the current tree on 2026-11-10; if
  drift is observed at implementation time, re-anchor before editing (research.md R7
  records the issue-vs-tree corrections).
- NEVER `git add` anything under `.kilo/fleet/` (scratch handoff lives there).
- The 028 canonical example (`SPEC_EXAMPLE` in `mermaid-repair.test.ts:13`) must keep
  repairing to a parse-passing diagram — it is 028's acceptance case and 036's
  regression guard.
