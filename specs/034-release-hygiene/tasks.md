---
description: "Task list for feature 034 release-hygiene"
---

# Tasks: Release hygiene for 0.10.0

**Input**: Design documents from `/specs/034-release-hygiene/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: No vitest suites are added or required. The langfuse-stub probe (Phase 7) is
the fail-first verification: it fails against the current tree (process handlers
present) and must pass after the fix.

**Organization**: Tasks are grouped by user story; each story is independently verifiable via its quickstart scenario.

**Release safety (applies to every task)**: no `git tag`, no tag push, no `gh release`, no GitHub Release edits. Tagging is the maintainer's action (plan.md "Release-safety note").

## Phase 1: Setup

**Purpose**: Confirm the verified baseline still holds before editing.

- [ ] T001 Re-verify baseline facts against the working tree: manifests read `0.9.0` (`package.json:3`, `server/package.json:5`, `packages/shared/package.json:3`); `CHANGELOG.md` `## [Unreleased]` holds exactly the #69/#70 Fixed entries; `ideas/history-map.md` absent; `tests/fixtures/langfuse-stub/server.mjs:90-95` has the two process handlers; `tests/e2e/README.md` ledger row count equals spec-file count. If any fact has drifted (later merges), re-check research.md D-references before proceeding — do not edit yet.

## Phase 2: Foundational

None — this feature has no shared infrastructure; each user story edits disjoint files.

---

## Phase 3: User Story 1 — 0.10.0 release record (Priority: P1) 🎯 MVP

**Goal**: The release pipeline's `verify-version` checks pass against base `0.10.0`; a complete dated changelog section exists; no tag is created.

**Independent Test**: quickstart S1 (manifest equality + changelog section + empty `## [Unreleased]` + `git tag --list 'v0.10.0*'` empty).

### Implementation for User Story 1

- [ ] T002 [US1] Author the `### Added` bullets for `## [0.10.0] - 2026-11-10` in `CHANGELOG.md` — five entries (027 back-propagation tool, 028 mermaid containment/repair, 029 micro-thoughts, 030 image generation, 031 split test suites + per-shard e2e) with content and commit references exactly per research.md D9 (no vite/rolldown entry).
- [ ] T003 [US1] Move the two existing `## [Unreleased]` → `### Fixed` entries (#69 credential/SSRF, #70 assistant image replies) into `## [0.10.0]` → `### Fixed` in `CHANGELOG.md`, add the PR #77 engine-seam Fixed entry, and leave a fresh empty `## [Unreleased]` header above the section (contracts/release-contract.md).
- [ ] T004 [P] [US1] Set `"version": "0.10.0"` in `package.json`, `server/package.json`, and `packages/shared/package.json` (version field only, no other manifest change).
- [ ] T005 [US1] Format and verify the release record: `pnpm exec prettier --write CHANGELOG.md package.json server/package.json packages/shared/package.json`, then run quickstart S1 including the no-tag assertion.

**Checkpoint**: Release contract passes locally; nothing tagged.

---

## Phase 4: User Story 2 — Authoritative docs accuracy (Priority: P2)

**Goal**: `docs/reference/seams.qmd` and `docs/explanation/architecture.qmd` describe the shipped projection/reasoning/mermaid behavior.

**Independent Test**: quickstart S2 greps plus passage-by-passage eyeball against the code cited in research.md D10.

### Implementation for User Story 2

- [ ] T006 [P] [US2] Rewrite the projection Rules line at `docs/reference/seams.qmd:74`: user image parts (018 shape), assistant vision gate (`visionCapable` via `supportsVision`), assistant images as provider file parts `{type:'file', mediaType, data}` (base64-only), text-only fallback; excluded kinds unchanged (wording source: research.md D10.1; code: `src/lib/chat/projection.ts:88-118,169-177,276-312`).
- [ ] T007 [P] [US2] Add a `### Mermaid render seam (feature 028)` subsection to `docs/reference/seams.qmd` under "Presentation seams (feature 004)" (section starts at `seams.qmd:158`): serialized render chain, `{ svg, theme, repaired }` contract, exactly one deterministic repair pass, reject-with-underlying-error on persistent failure, caller-side containment + fix affordance (source: `src/lib/markdown/mermaid.ts:60-98`, `src/lib/components/chat/Markdown.svelte:93-145`, `specs/028-mermaid-error-repair/contracts/render-pipeline.md`).
- [ ] T008 [P] [US2] Update per-kind semantics in `docs/explanation/architecture.qmd`: line 306 `assistant_message` (ordered text+image parts, image-only rows, segmented rendering, legacy text-only rows), line 307 `reasoning` (one row per reasoning segment, arrival-ordered, `metadata: {iteration, anchored:true}`; legacy per-iteration rows still readable — `src/lib/chat/kinds.ts:86-89`, `specs/029-micro-thoughts/contracts/persistence-and-display.md`), and line 292 external-lane phrase ("assistant text and image parts").
- [ ] T009 [P] [US2] Update the context-projection table rows at `docs/explanation/architecture.qmd:330-331` (`user_message`, `assistant_message`) to match the seam wording from T006.
- [ ] T010 [P] [US2] Add one mermaid bullet to the UI-stack list in `docs/explanation/architecture.qmd` after the markdown-pipeline bullet (line 77): render-seam contract summary + pointer to the seams.qmd subsection and the 028 render-pipeline contract.
- [ ] T011 [US2] Verify docs accuracy end-to-end in `docs/reference/seams.qmd` and `docs/explanation/architecture.qmd`: run quickstart S2 greps, then read each edited passage against the cited code; confirm no other passage in either file was touched (research.md D10 "nothing else" rule).

**Checkpoint**: Both authority docs match shipped behavior.

---

## Phase 5: User Story 3 — Idea tombstone (Priority: P3)

**Goal**: `ideas/history-map.md` exists again with sentinel 013 and both retirements recorded; no idea file deleted.

**Independent Test**: quickstart S3.

### Implementation for User Story 3

- [ ] T012 [P] [US3] Restore `ideas/history-map.md` per contracts/idea-tombstone.md: sentinel `**Last used idea number: 013**` (+ 011-gap aside), directory table rows 001–008 verbatim from `git show 84389bf^:ideas/history-map.md`, new loose-file retirement table for `llm-mocks.md` (delivered → `tests/fixtures/mock-llm/`, specs 017/020) and `security-scan.md` (partially delivered → 019 history + #69; open remainder → `ideas/dependency-vulnerability-backlog.md`), and the deletion/restoration provenance note.
- [ ] T013 [US3] Verify the tombstone: `pnpm exec prettier --check ideas/history-map.md` (write-format if needed) and run quickstart S3 (sentinel present, both retirements recorded, `git status` shows no idea-file deletion).

**Checkpoint**: Idea numbering protected; retirements auditable.

---

## Phase 6: User Story 4 — Mock-LLM README (Priority: P3)

**Goal**: `tests/fixtures/mock-llm/README.md` alone suffices to trigger and parse an image reply.

**Independent Test**: quickstart S4.

### Implementation for User Story 4

- [ ] T014 [P] [US4] Extend the 030 image-dispatch bullet in `tests/fixtures/mock-llm/README.md` (currently lines 66–70) per research.md D11: `image_reply` classification of the trigger phrase; route split (OpenAI-compatible `POST /v1/chat/completions` vs Google `POST /models/{model}:streamGenerateContent?alt=sse` — Google never reaches the completions path); both wire shapes (`choices[0].delta.images[]` data-URL frame; candidate part `inlineData { mimeType, data }`) with the raw-chunk/SDK-strip note; deliberate slower-than-150ms image-frame pacing for CI caption observability. Match the file's prose style (Prettier-ignored directory).
- [ ] T015 [US4] Run quickstart S4 greps against `tests/fixtures/mock-llm/README.md` (`image_reply`, `delta.images`, `inlineData`, `streamGenerateContent`, pacing all present).

**Checkpoint**: Fixture README is self-sufficient for the 030 dispatch.

---

## Phase 7: User Story 5 — Langfuse stub fault surface (Priority: P3)

**Goal**: No process-level swallow handlers; aborts answered/handled at the request path; genuine faults crash loudly; the original abort-race resilience is preserved.

**Independent Test**: quickstart S5 (fail-first: `grep -c "process.on(" server.mjs` currently returns 2 — the probe must fail before the fix and pass after).

### Implementation for User Story 5

- [ ] T016 [P] [US5] Record the fail-first baseline for `tests/fixtures/langfuse-stub/server.mjs`: run the quickstart S5 static checks against the current tree and capture the failure (two `process.on(` matches; `node --check` passes).
- [ ] T017 [US5] Rework `tests/fixtures/langfuse-stub/server.mjs` per contracts/stub-fault-surface.md: delete `process.on('unhandledRejection'/'uncaughtException')` (lines 90–95); make `readBody` settle on aborted bodies ('aborted'/'close' before 'end'); guard `sendJson` against dead sockets (`res.writableEnded`/`socket.writable` or `res.on('error')` no-op) so the malformed/abort 400 path (route catch at lines 45–53) never writes to a destroyed response; keep `server.on('clientError')` unchanged.
- [ ] T018 [US5] Run the standalone probe (quickstart S5): boot the stub on a free port under `/tmp/kilo`; assert malformed body → 400, aborted mid-body request → process alive + no phantom batch in `/__received`, `POST /__reset` → 200; `grep -c "process.on(" server.mjs` → 0; kill the stub.

**Checkpoint**: Stub fails loudly on genuine faults; abort races stay non-fatal.

---

## Phase 8: User Story 6 — E2e engine seam + ledger verification (Priority: P3)

**Goal**: Evidence that the image e2e is engine-agnostic and the ledger is complete (expected: already true; fix only if drift found).

**Independent Test**: quickstart S6.

### Implementation for User Story 6

- [ ] T019 [P] [US6] Run quickstart S6: `resolveEngine` present in `tests/e2e/image-round-trip.spec.ts`; no hardcoded `docker compose` invocations; `ls tests/e2e/*.spec.ts | wc -l` equals the README ledger row count and includes `backprop-tool.spec.ts`. If (and only if) a mismatch appears, apply the minimal fix and re-run; otherwise change nothing.

**Checkpoint**: Item 6 acceptance closed with evidence.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T020 Run the full quickstart (S1–S6) plus `pnpm exec prettier --check package.json server/package.json packages/shared/package.json CHANGELOG.md ideas/history-map.md tests/e2e/README.md`; confirm `git tag --list 'v0.10.0*'` is empty and `git status` shows exactly the intended files changed (CHANGELOG, 3 manifests, 2 docs, tombstone, mock-llm README, stub).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (T001)**: first — baseline facts gate everything.
- **Phase 2**: none exist.
- **Phases 3–8 (US1–US6)**: independent of each other (disjoint files); can proceed in parallel or in priority order P1 → P2 → P3.
- **Phase 9 (T020)**: last, after all stories.

### User Story Dependencies

- **US1 (Phase 3)**: none. **US2 (Phase 4)**: none (T009 wording follows T006, same story). **US3–US6 (Phases 5–8)**: none.

### Parallel Opportunities

- T004 (manifests) parallels T002/T003 (CHANGELOG).
- T006–T010 are file-disjoint doc edits; T012/T014/T017/T019 touch four different files entirely.

### Within Each User Story

- US1: content (T002/T003) before verify (T005).
- US5: fail-first baseline (T016) before fix (T017) before probe (T018).

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001 baseline → 2. US1 (T002–T005) → **STOP and VALIDATE** (quickstart S1): the release contract now passes; this alone unblocks the maintainer's RC tag.

### Incremental Delivery

Each subsequent story (US2…US6) is independently landable and verifiable; none can regress another (disjoint files).

---

## Notes

- [P] tasks = different files, no dependencies.
- No vitest runs are planned; if one becomes unavoidable, use the fleet wrapper from quickstart (never plain `pnpm test`).
- Commit messages should follow repo history style (e.g. `docs(034): …`, `chore(034): …`, `fix(034): …`).
- NO tagging from this feature — the RC/stable tags and GitHub Release bodies are the maintainer's actions per AGENTS.md.
