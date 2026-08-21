---
description: 'Task list for feature implementation'
---

# Tasks: Shape-Driven Tool Result Rendering

**Input**: Design documents from `/specs/005-shape-driven-results/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/tool-result-shapes.md, quickstart.md

**Tests**: INCLUDED — mandated by spec FR-015 and constitution §II (failing-first, source-inspection + pure-logic style of `ToolActivity.collapse.test.ts` / `entries.test.ts`). Write each test first, confirm it FAILS on current code, then implement.

**Organization**: Tasks grouped by user story (US1–US4) for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g. US1, US2, US3)
- Exact file paths in every description

## Path Conventions

Single-repo SvelteKit SPA: `src/lib/…` (app code), colocated `*.test.ts`. No backend/frontend split.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Baseline verification and regression fixtures

- [x] T001 Verify clean baseline and prepare fixtures: run `pnpm install`, ensure `@mayon/shared` is built (fresh-checkout build order), then confirm `pnpm check`, `pnpm lint`, and `pnpm test` are green before any change. On the dev stack (`pnpm dev`), keep a stored chat containing Brave `brave_web_search` multi-result rows as the manual regression fixture — it must read correctly after the feature with **no data change** (per quickstart.md prerequisites)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared tolerant-JSON scan primitive both the classifier (US1/US2) and sources extraction consume — one parse, never duplicated (FR-014, research D2)

- [x] T002 Add failing-first tests for the scan primitive in `src/lib/mcp/sources.test.ts`: whole-string JSON parses to one value; concatenated `{"url":"https://a"}{"url":"https://b"}` splits into two values; braces inside string literals don't split; string escapes handled; a truncated trailing value is dropped; empty/garbage input yields `[]`; never throws. Then implement `scanJsonValues(text: string): unknown[]` in `src/lib/mcp/sources.ts` (whole-parse first, else bracket-depth split that is string-literal- and escape-aware, per segment `JSON.parse`, partial tail dropped) and refactor `extractSources` onto it — **public contract unchanged** (`ToolSource[]`, cap 10, never throws); all existing tests in `src/lib/mcp/sources.test.ts` stay green unmodified

**Checkpoint**: Shared parse ready — user story implementation can begin

---

## Phase 3: User Story 1 - Search results read as link cards (Priority: P1) 🎯 MVP

**Goal**: Records detection (S2) renders concatenated web-search payloads as a capped, deduped list of link cards with the sources row folded in (FR-003/FR-006/FR-007, research D2/D3/D5, contract tool-result-shapes.md rules 3–4 + rendering)

**Independent Test**: Open the stored brave-search chat and expand a search row: link cards render (title link, host line, one-line stripped description), duplicates once, >10 results show "+N more", and **no separate Sources row renders** (quickstart.md US1)

### Tests for User Story 1

- [x] T003 [P] [US1] Failing-first classifier tests in `src/lib/chat/result-shape.test.ts` (new file, pure-logic style): concatenated two/three-object web-search summary → `{ kind: 'records', values }`; single JSON object with an `https` url → records; 59% URL-bearing → `json` vs 60% → `records` (boundary pair); `ftp://`/`mailto:` values never count toward the ratio; JSON without any URL → `json`; URL nested one level (array element / nested object) counts; truncated-JSON tail contributes no value. Module doesn't exist yet — all fail
- [x] T004 [P] [US1] Failing-first component tests in `src/lib/components/chat/rows/ToolResultBody.test.ts` (new file, source-inspection style of `ToolActivity.collapse.test.ts`): records branch renders card list markup with external-link attributes (`target="_blank" rel="noopener noreferrer"`); card title falls back to URL host; description/snippet tag-stripped (no raw `<strong>` passthrough — assert a strip helper/regex is applied); dedupe by URL; cap at 10 cards with a muted "+N more" line. All fail — component doesn't exist

### Implementation for User Story 1

- [x] T005 [US1] Implement `classifyResult(summary: string, detail: unknown)` in `src/lib/chat/result-shape.ts` (new file): discriminated union per data-model §1; this story lands precedence rules 3–4 and the ladder floor — records (tolerant scan via `scanJsonValues`, ≥60% of values carry an http(s) URL directly or one nesting level, URL test reuses the sources predicate), then `json` (scan yields ≥1 values), then rule 6/7 floor (`summary.length > 160` → `text`; else `null`). Pure, total, `try`-wrapped parsing; no tool-name/server input anywhere. Depends on T002
- [x] T006 [US1] Implement `collectCards(values: unknown[]): LinkCard[]` in `src/lib/mcp/sources.ts` (per data-model §5: url/title/host/description/snippet projection, one-nesting-level URL search, HTML tag-strip, dedupe by URL, first-occurrence-wins) and the records branch of `src/lib/components/chat/rows/ToolResultBody.svelte` (new component, props `shape`/`detail`): vertical card list — title as external link, muted host line, one-line ellipsized description, optional one-line snippet — capped at 10 cards + muted "+N more" count; Tailwind quiet-row vocabulary (text-xs, text-muted-foreground, rounded-lg border, truncate), lucide icons only. Depends on T005
- [x] T007 [US1] Wire `src/lib/components/chat/rows/ToolActivity.svelte`: compute `shape = classifyResult(summary, parseMetadata(resultMsg?.metadata ?? null))` (whole parsed metadata — research D5/RC4), delegate the expanded body to `<ToolResultBody>` (replacing the raw summary `<pre>` + detail `<pre>` pair for expanded rendering), and suppress the `ToolSources` row when `shape?.kind === 'records'` (the cards are the one list). Keep the existing "Show result" toggle and collapsed behavior untouched in this story — US3 reworks the affordance. Depends on T006

**Checkpoint**: US1 independently testable — search results read as cards, one list not two

---

## Phase 4: User Story 2 - Markdown and JSON read as what they are (Priority: P2)

**Goal**: S3 pretty-printed JSON, S4 markdown via the timeline renderer, detail overrides beating string heuristics (FR-004/FR-008/FR-009, research D5/D6, contract rules 1–2/5)

**Independent Test**: Expand a markdown-payload result → formatted markdown in the bounded container; expand a URL-less JSON result → 2-space pretty-printed bounded `<pre>`; `text/markdown` marker wins over payload-like shape (quickstart.md US2)

### Tests for User Story 2

- [x] T008 [P] [US2] Failing-first classifier tests in `src/lib/chat/result-shape.test.ts`: `detail.markdown` string → `markdown` (text = summary); `detail.mimeType === 'text/markdown'` → `markdown` even when summary starts `{`; `detail.mimeType === 'application/json'` → `json` beating markdown heuristics; fenced code block / `^#{1,6}\s` heading line / link density (≥2 md links in ≤400 chars, ≥3 beyond) each → `markdown`; plain prose with one bare URL → NOT markdown; long plain text (>160) → `text`; ≤160-char prose → `null`; JSON object whose string values contain `#` headings → `json` (JSON beats markdown heuristics). Fails until rules 1–2/5 exist
- [x] T009 [P] [US2] Failing-first component tests in `src/lib/components/chat/rows/ToolResultBody.test.ts`: markdown branch imports/renders `Markdown.svelte` (`../Markdown.svelte`) inside bounded container classes (`max-h-60 overflow-y-auto`); json branch uses `JSON.stringify(value, null, 2)` in the bounded `<pre>`; text branch renders the raw summary in the bounded `<pre>`; every branch carries the bounded classes. Fails until branches exist

### Implementation for User Story 2

- [x] T010 [US2] Implement precedence rules 1–2 and 5 in `src/lib/chat/result-shape.ts`: detail overrides first (`detail.markdown` string or `detail.mimeType === 'text/markdown'` → markdown; `detail.mimeType === 'application/json'` → json), then markdown heuristics (fenced block / heading line / link density, constants local to the module) between the json rule and the length rule, per the contract table. Depends on T005 (same file, later rules)
- [x] T011 [US2] Implement the markdown/json/text branches in `src/lib/components/chat/rows/ToolResultBody.svelte`: markdown → `<Markdown raw={shape.text} />` inside the same bounded container styling raw results use today; json → `JSON.stringify(shape.value, null, 2)` in the existing bounded `<pre>` pattern; text → summary as-is in the bounded `<pre>`. Depends on T010 (union kinds complete)

**Checkpoint**: US2 independently testable — content reads as content

---

## Phase 5: User Story 3 - One obvious toggle, content that flows (Priority: P3)

**Goal**: Header row (icon + tool name + chevron) is the toggle; body flows below; sources last; no floating control (FR-010, research D4/RC3)

**Independent Test**: Every verbose row toggles via its header; no "Show result"/"Hide result" button exists; non-records sources rows render last; short-prose rows unchanged (quickstart.md US3)

### Tests for User Story 3

- [x] T012 [P] [US3] Extend `src/lib/components/chat/rows/ToolActivity.collapse.test.ts` (behavior contract changes by design — research RC6): header row carries the toggle (button semantics + `aria-expanded` + chevron); source contains no `'Show result'`/`'Hide result'` strings; `ToolSources` renders only after the body when rendered at all (last element); verbose computation still `needsExpander || payloadLike` with `TOOL_SUMMARY_THRESHOLD` (unchanged rule); short-prose rows keep the inline `truncate` one-liner and no expander; verbose collapsed rows still render no inline summary

### Implementation for User Story 3

- [x] T013 [US3] Restructure `src/lib/components/chat/rows/ToolActivity.svelte`: make the header row (status icon + tool name + chevron) the expand/collapse toggle for verbose rows (button semantics, `aria-expanded`, chevron flips `ChevronRight`/`ChevronDown`); remove the separate floating toggle button; expanded `ToolResultBody` flows directly below the header; `ToolSources` (when rendered) is the last element. Non-verbose rows are not toggles; the verbose rule itself stays byte-identical. Depends on T007 (same file, later restructure)

**Checkpoint**: US3 independently testable — one control, predictable flow

---

## Phase 6: User Story 4 - Safe for everything else, honest for history (Priority: P4)

**Goal**: Structural degradation — malformed/exotic payloads never crash, never render unbounded; stored bytes immutable (FR-011/FR-012/FR-013, research D7)

**Independent Test**: Malformed/truncated/oversized fixtures and pre-feature chats all render (bounded raw view at worst); golden tests pass unmodified (quickstart.md US4)

### Tests for User Story 4

- [x] T014 [P] [US4] Failing-first edge-case tests: in `src/lib/chat/result-shape.test.ts` — deeply nested JSON without URLs → `json`; mixed payload half text half JSON (scan yields nothing whole) → falls to `text`/`null` by length; empty summary with detail → never throws; very long single-line text → `text`; summary with `title` field but non-URL → not records; detail with non-text `content` parts (image/audio objects) → classification unaffected. In `src/lib/components/chat/rows/ToolResultBody.test.ts` — every branch's container carries `max-h-60` + `overflow-y-auto` (no unbounded path exists in the component source)

### Implementation for User Story 4

- [x] T015 [US4] Harden totality per research D7 if T014 reveals gaps (expected minimal — the ladder bottom is the fallback by construction): ensure all parsing sits inside the classifier's `try`, `ToolResultBody`'s kind switch is exhaustive with every branch bounded, and no payload-sourced markup renders as HTML anywhere. Fix only what the tests expose; no catch-up render branch

**Checkpoint**: US4 independently testable — nothing can break an old chat

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Gates, manual validation, perf evidence, documentation

- [x] T016 Run all quality gates in order: `pnpm exec vitest run src/lib/components/chat/ src/lib/chat/` (targeted) then full `pnpm test` (golden tests in `src/lib/chat/golden/*` pass UNMODIFIED — any golden failure means provider-visible context changed and is a stop-the-line defect), `pnpm check`, `pnpm lint`; run `pnpm --filter @mayon/server test` as a guard (no server changes expected)
- [x] T017 Execute the full `specs/005-shape-driven-results/quickstart.md` walkthrough on the dev stack across all four stories, including the immutability check (stored content byte-identical before/after viewing) and the pre-feature legacy chat check
- [x] T018 Measure with the perf probe (`window.__MAYON_PERF__ = 1`, `localStorage.mayon_perf_scenario = 'shape-driven-results'`) before/after on the brave-search chat: frame timing, longtasks, `TimelineRow` render counts while scrolling/expanding; record the numbers in the PR (constitution IV — no unmeasured perf claims)
- [x] T019 [P] Document the seam in `docs/dev/seams.qmd` (feature-004 presentation section): one bullet — the classifier (`src/lib/chat/result-shape.ts`) is the single shape authority for tool-result bodies; rendering is shape-driven, never tool-name/server-driven; sources fold into cards for records shapes — pointing at `specs/005-shape-driven-results/contracts/tool-result-shapes.md` for detail

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: after Setup; blocks US1 and US2 (shared scan)
- **User Stories (Phases 3–6)**: after Foundational; independently testable, but note the same-file chains below
- **Polish (Phase 7)**: after all desired stories complete

### User Story Dependencies

- **US1 (P1)**: consumes T002's `scanJsonValues`; touches `sources.ts` + `result-shape.ts` + `ToolResultBody.svelte` + `ToolActivity.svelte`. **MVP**
- **US2 (P2)**: extends `result-shape.ts` (after T005) and `ToolResultBody.svelte` (after T006); otherwise independent
- **US3 (P3)**: restructures `ToolActivity.svelte` — run after US1's T007 (same file)
- **US4 (P4)**: mostly inherited by construction; its tests are the proof — run last against the finished ladder

### Within Each User Story

- Tests written first and FAILING before implementation (constitution II)
- Pure classifier before components that consume it
- Golden tests are never modified

### Parallel Opportunities

- Test authoring across different files: T003 ∥ T004 ∥ T008 ∥ T009 ∥ T012 ∥ T014 (all [P], new/extended test files)
- T002 ∥ T001 fixture prep is sequential (baseline first), but T002 ∥ nothing else in Phase 2
- After T005/T006 land: T010 ∥ T013 are different files (`result-shape.ts` vs `ToolActivity.svelte`)
- T019 ∥ T016–T018

---

## Parallel Example: User Story 1

```bash
# Launch the failing-first tests together (different files):
Task: "T003 classifier records tests in src/lib/chat/result-shape.test.ts"
Task: "T004 component card tests in src/lib/components/chat/rows/ToolResultBody.test.ts"

# Then implement sequentially (parse feeds classifier feeds component feeds wiring):
Task: "T005 classifyResult records rule + ladder floor in src/lib/chat/result-shape.ts"
Task: "T006 collectCards + ToolResultBody records branch (src/lib/mcp/sources.ts + rows/ToolResultBody.svelte)"
Task: "T007 ToolActivity delegation + sources fold in rows/ToolActivity.svelte"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: Foundational (T002)
3. Complete Phase 3: US1 (T003–T007)
4. **STOP and VALIDATE**: search chats read as cards, one list not two; quickstart US1 walkthrough passes
5. Ship/demo if desired — the motivating wall-of-text defect is fixed

### Incremental Delivery

1. Setup + Foundational → shared scan ready
2. +US1 → link cards, sources folded (MVP!)
3. +US2 → markdown/JSON readability + precedence
4. +US3 → header-row toggle, predictable flow
5. +US4 → degradation proven, immutability proven; then Polish (gates, perf numbers, seams bullet)

### Parallel Team Strategy

- Dev A: US1 → US3 (the ToolActivity/delegation chain)
- Dev B: US2 after US1's classifier lands (extends rules + branches)
- Dev C: US4 tests can be authored in parallel (T014) and run against the finished ladder

---

## Notes

- [P] = different files, no dependencies; same-file chains called out explicitly (T005→T010, T007→T013, T002→T005)
- Every new behavior ships its failing-first test (constitution II / FR-015); fixtures use distinct ids and production-shaped metadata (003 fixture-bias lesson)
- Stored rows, provider context, golden tests, and the tool registry are frozen (FR-011) — any golden failure is a stop-the-line defect
- `ToolActivity.collapse.test.ts` expectations change **by design** (header toggle, sources fold — research RC6); golden fixtures never change
- Commit after each task or logical group; stop at any checkpoint to validate independently
