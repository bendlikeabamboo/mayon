# Phase 1 Data Model: Quiz & Labs RC Verification

**Feature**: `020-rc-ui-verification` | **Date**: 2026-09-05

No database schema changes. This document models the feature's data: the fixture library, the classification inputs, the settings-key contract surfaces, and the existing store lifecycle the suites assert against.

## Entities

### RequestKind *(test stack — mock classification output)*

Discriminated result of classifying a `POST /v1/chat/completions` body. Inputs are code-owned only (see [contracts/mock-llm-protocol.md](./contracts/mock-llm-protocol.md)).

| Kind | Classified by | Served by |
|------|---------------|-----------|
| `chat` | `stream: true`, no `tools` | SSE chunks of `kitchen-sink.md` (existing, unchanged pacing) |
| `quiz_generation` | `tools[].function.description` ≠ grading marker AND system prompt contains quiz contract marker | `quiz-fixture.mjs` tool-call reply |
| `lab_generation` | same, but lab contract marker | `lab-fixture.mjs` tool-call reply |
| `short_grading` | grading tool-description marker | lever-resolved `{isCorrect, feedback}` tool-call reply |
| *(unknown)* | none of the above | HTTP 400 + diagnostic hints (hard red) |

Validation rules: classification order is fixed; user-authored strings (custom instructions, answer text) must never influence the outcome (FR-002) — except answer text *inside* a `short_grading` request selecting the outcome via the lever (FR-003).

### QuizFixture *(test stack)*

Deterministic `GeneratedQuiz` payload covering every question type exactly once per fixture version:

- `mcq`: `prompt`, `options[]` (distinct strings; the correct answer text is unique in the document for payload-driven locating), `answerIndex`
- `flashcard`: `front`, `back`
- `short`: `prompt`, `rubric` (worded so both lever outcomes are legitimately gradeable)

Validation rules: must validate against `GeneratedQuizSchema` (strict Zod union) as-is; aliased/drifting fields are NOT included (drift repair is covered by unit tests, not the fixture); MCQ `answerIndex` points at the option whose text the deck locates by label.

### LabFixture *(test stack)*

Deterministic `GeneratedLab` payload: `title`, `intro`, `steps[]` (≥2, known texts), `checklist[]` (≥2 items, known texts). Must validate against `GeneratedLabSchema` as-is; `toLabContent` flattens it into the markdown body with checklist uuids assigned (`done: false`).

### GradingLever *(test stack)*

| Input in answer text (case-insensitive) | `isCorrect` | `feedback` |
|------------------------------------------|-------------|------------|
| contains `should be correct` | `true` | fixed fixture string |
| contains `should be wrong` | `false` | fixed fixture string |
| neither | `false` (default) | fixed default string |

State transitions: none (pure function of the request's user block).

### Settings KV keys *(product surface — see [contracts/prompt-settings-contract.md](./contracts/prompt-settings-contract.md))*

| Key | Status | Semantics |
|-----|--------|-----------|
| `quizInstructions`, `labInstructions` | NEW | user custom instructions; empty/absent = none |
| `quizPrompt`, `labPrompt` | LEGACY | whole-prompt overrides; migrated to instructions on first read (D4), then deleted |
| `providers`, `activeProvider` | existing | untouched (reset by the `onboarded` fixture as today) |

Validation rules: instructions are free text with no schema; assembly (code) appends them after the contract — never before, never instead.

### Existing store lifecycle under assertion *(product — unchanged, asserted by suites)*

- **Quiz attempt**: `quiz_attempts.start` → per-question `quiz_answers.record` (`answer` text; `isCorrect: true/false/null`) → `finishIfComplete` writes `score` = count of `isCorrect === true`. Buckets: MCQ local compare to `payload.answerIndex` → `true|false`; flashcard self-mark `got|missed`; short via grading request → `true|false`, failure → `null` + `aiFeedback` + regrade recovery.
- **Lab stepping**: `labs.create` → `setChecklist` (uuid items, `done: false`) → `toggleChecklistItem` per click (optimistic, revert on persist failure); completion = implicit `done` flags + `doneCount/items.length` header. No terminal "complete" state exists in the DB — the deck asserts the header count, not a phantom state.
- **Failure surfacing**: quiz generation failure → typed `FormattedProviderError` ("Quiz generation failed") card; lab generation failure (`LabGenerationError`) → `rawOffer` "Save raw text as lab" card → `saveRaw` persists markdown with empty checklist.

## Relationships

- `RequestKind 1—1 Fixture reply` (per classification, from the fixture library under `tests/fixtures/mock-llm/`).
- `QuizFixture → quizzes + quiz_questions rows` via `repos.quizzes.create` + `repos.quizQuestions.add` (payload JSON-stringified, `ord` from count, MCQ options shuffled at persist — hence D5).
- `GradingLever → quiz_answers.isCorrect` via `gradeShortAnswer` → `repos.quizAnswers.grade`.
- `LabFixture → labs row (content markdown + checklist JSON)` via `labsRepo.create/setChecklist`.
- `Settings keys → assembled system prompt` inside `generate-quiz.ts` / `generate.ts` (contract + instructions; tool descriptions unchanged).
