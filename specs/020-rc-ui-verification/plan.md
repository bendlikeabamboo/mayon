# Implementation Plan: Quiz & Labs RC Verification

**Branch**: `020-rc-ui-verification` | **Date**: 2026-09-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/020-rc-ui-verification/spec.md`

## Summary

Extend the 017 mock-LLM verification stack so release candidates are verified on quiz and labs flows by automated, deterministic runs. The stand-in LLM service (`tests/fixtures/mock-llm/server.mjs`) learns to classify request kinds — chat, quiz generation, lab generation, short-answer grading — from user-un-influenceable request aspects (tool-description sentinels, streaming flag) and serve a deterministic fixture per kind, with an answer-text grading lever selecting the deterministic grading outcome. A browser deck drives the real journey (settings onboarding → chat → quiz with every question type → both grading outcomes → lab to completion) through the real server proxy hop and placeholder-key path. A non-browser Vitest suite adds parse→persist, grading-bucket, and failure-path depth by stubbing the provider at the `LanguageModel` seam. One deliberate product change ships alongside: the format/contract section of quiz and lab generation prompts becomes read-only (viewable, custom instructions attachable, contract never editable).

## Technical Context

**Language/Version**: TypeScript 5.x on Node 22 (`.nvmrc`), pnpm 10, SvelteKit (Svelte 5 runes) SPA

**Primary Dependencies**: Playwright (browser deck, already installed), Vitest (logic layer, already installed), Vercel AI SDK (`generateObjectViaTool` choke point in `src/lib/ai/generate/object-tool.ts`), Zod schemas (`GeneratedQuizSchema`, `GeneratedLabSchema`, `GradedAnswerSchema`), drizzle + pglite (test driver `src/lib/db/driver/pg-test.ts`)

**Storage**: Postgres via drizzle (app; tables `quizzes`, `quiz_questions`, `quiz_attempts`, `quiz_answers`, `labs`, `settings` — **no schema changes in this feature**); pglite (logic-suite driver); browser IndexedDB (placeholder key)

**Testing**: `pnpm test:e2e` (Playwright: `playwright.config.ts`, testDir `tests/e2e`, chromium, `workers: 1`, `retries: 0`, trace retain-on-failure) against the `mayon-dev` compose stack; `pnpm test` (Vitest, pglite, per-file `useFileTestDb()` bootstrap); server package unchanged (`pnpm --filter @mayon/server test` still required by constitution if server code is touched — none planned)

**Target Platform**: All-containerized dev stack (`docker-compose.dev.yml`, project `mayon-dev`: web :5173, server :4319, `mock-llm` :9999 internal-only); isolated `mayon-e2e` variant (web :5174 via `docker-compose.e2e.yml`); CI `e2e` job in `.github/workflows/ci.yml`

**Performance Goals**: Full quiz/labs RC verification run red/green in under 15 minutes (SC-001); the deck adds no runtime cost to the product (test-stack-only execution)

**Constraints**: Zero `page.route` interception of the provider path (FR-005 guardrail); mock classification must not read user-influenceable free text (FR-002); determinism — identical outcomes across ≥10 consecutive runs (SC-004); no new product runtime dependencies

**Scale/Scope**: 3 new mock fixture kinds + lever (test stack), ~4–6 new Playwright specs, ~3–4 new/extended Vitest suites, 2 settings components reworked (read-only contract + instructions + view affordance), 2 settings KV keys migrated

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Code Quality — layering | ✅ Pass | Prompt-assembly change stays inside `src/lib/ai/generate/*` and reads settings via `repos.settings` only; no direct `db` imports in components/stores. `StorageDriver` seam untouched. |
| I. Code Quality — gates | ✅ Pass | `pnpm check` + `pnpm lint` required before merge; test files avoid the `+` prefix. |
| I. Code Quality — no secrets in settings | ✅ Pass | Placeholder key (`e2e-placeholder-key`) already lives in IndexedDB only; settings KV gains instruction text only. |
| II. Testing Standards | ✅ Pass | New behavior (read-only contract, instructions assembly) ships with Vitest coverage; `pnpm test` must pass; suites must not write `search_vec` (they don't). |
| III. UX Consistency | ✅ Pass | Settings rework reuses existing `QuizPromptConfig`/`LabPromptConfig` components and Tailwind/shadcn vocabulary; view/read-only affordances extend established patterns. No server-presence assumptions (prompt view is client-side data from `repos.settings`). |
| III. UX Consistency — no downtime | ✅ Pass | Settings KV change is data-only; no restarts, no restore interaction. |
| IV. Performance | ✅ Pass | No perf-sensitive paths touched (generation prompt assembly is unchanged in shape); no new runtime dependencies (Playwright is dev-only, already present); `@mayon/shared` untouched. |
| Quality Gates — migrations | ✅ Pass | No drizzle schema changes; no `pnpm db:generate` run needed. Settings migration is KV-key semantics only (see research.md D4). |
| Quality Gates — RC flow | ✅ Pass | The feature's purpose is to feed the existing RC-first flow; no release-contract changes. |

**Post-Phase-1 re-check**: Pass — design adds no documented-seam deviations (see Complexity Tracking: none).

## Project Structure

### Documentation (this feature)

```text
specs/020-rc-ui-verification/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions D1–D7
├── data-model.md        # Phase 1 output — fixtures, settings keys, attempt lifecycle
├── quickstart.md        # Phase 1 output — validation guide
├── contracts/
│   ├── mock-llm-protocol.md       # Classification rules + per-kind wire contract
│   └── prompt-settings-contract.md# Read-only contract + instructions KV contract
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
tests/
├── e2e/
│   ├── onboard.spec.ts            # existing — reused unchanged
│   ├── render.spec.ts             # existing — reused unchanged
│   ├── quiz.spec.ts               # NEW — quiz deck: generate → mcq/flashcard/short → both grading outcomes
│   ├── lab.spec.ts                # NEW — lab deck: generate → step checklist → completion header
│   ├── prompt-contract.spec.ts    # NEW — read-only contract UI: view, edit-blocked, instructions attach
│   └── fixtures/
│       ├── onboard.ts             # existing `onboarded` fixture — extended with quiz/lab entry helpers
│       ├── kitchen-sink.ts        # existing constants — new per-kind fixture constants
│       └── render.ts              # existing
└── fixtures/
    └── mock-llm/
        ├── server.mjs             # EXTENDED — request-kind classification + tool-call replies + lever
        ├── kitchen-sink.md        # existing chat fixture
        ├── quiz-fixture.mjs       # NEW — deterministic GeneratedQuiz tool-call payload (mcq, flashcard, short)
        ├── lab-fixture.mjs        # NEW — deterministic GeneratedLab tool-call payload (steps + checklist)
        └── README.md              # NEW — the FR-005 guardrail written down before the first flake

src/
├── lib/
│   ├── ai/
│   │   ├── generate/
│   │   │   ├── generate-quiz.ts # EXTENDED — split contract vs instructions; QUIZ/GRADE sentinels kept stable
│   │   │   ├── generate.ts      # EXTENDED — same split for lab prompt; LAB sentinel
│   │   │   └── *.test.ts        # EXTENDED — Vitest suites (parse→persist, buckets, failure paths, assembly)
│   │   └── ...
│   ├── components/
│   │   ├── quizzes/QuizPromptConfig.svelte  # EXTENDED — read-only view, instructions textarea, no contract edit
│   │   └── labs/LabPromptConfig.svelte      # EXTENDED — same
│   ├── db/repositories/settings.ts          # existing — KV access (keys per contracts/prompt-settings-contract.md)
│   └── stores/quizzes.svelte.ts             # existing — exercised by deck; no changes planned
└── routes/settings/+page.svelte             # existing — hosts the two config components

docs/how-to/building.qmd                      # EXTENDED — quiz/labs verification run instructions
```

**Structure Decision**: Extend the existing web-app tree — no new top-level directories. Test-stack work lives under `tests/` (product diff = the prompt-contract product change only, per spec Assumptions); product change stays inside the established generate/components/settings seams.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | — | — |
