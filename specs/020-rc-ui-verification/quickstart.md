# Quickstart: Validating Quiz & Labs RC Verification

**Feature**: `020-rc-ui-verification` | **Date**: 2026-09-05

Runnable scenarios proving the feature end-to-end. Contract details live in [contracts/](./contracts/); entity semantics in [data-model.md](./data-model.md).

## Prerequisites

- Node 22, pnpm 10, Docker or Podman (`MAYON_DEV_ENGINE` selects).
- `pnpm install` and `pnpm --filter @mayon/shared build` (fresh checkout).

## Setup

```bash
pnpm dev:up                 # mayon-dev stack: web :5173, server :4319, mock-llm :9999 (internal)
```

Isolated variant (runs beside a busy dev stack):

```bash
docker compose -p mayon-e2e -f docker-compose.dev.yml -f docker-compose.e2e.yml up -d
export E2E_BASE_URL=http://127.0.0.1:5174
```

Sanity: the mock is reachable only from inside the network —

```bash
docker compose -p mayon-dev exec -T server wget -qO- http://mock-llm:9999/v1/models   # expect mock-sink catalog
```

## Scenario 1 — Browser deck replaces the manual pass (SC-001/003/004)

```bash
pnpm test:e2e               # existing chat/onboard/render specs + new quiz/lab/prompt-contract specs
```

Expected: all green; quiz spec onboards via the real settings UI, drives chat to the kitchen-sink reply, generates the fixture quiz, answers mcq (by answer text, not position — D5), flashcard, and short answers marked `should be correct` and `should be wrong`, and asserts both grading outcomes plus the attempt score; lab spec generates the fixture lab, toggles every checklist item, and asserts the `doneCount/items.length` header reaches full. Repeat the run on identical code: identical outcomes.

## Scenario 2 — Logic-layer depth (SC-006)

```bash
pnpm test
```

Expected: green. New/extended Vitest coverage asserts: prompt assembly per [prompt-settings-contract.md](./contracts/prompt-settings-contract.md) invariants I1–I4 (incl. legacy `quizPrompt`/`labPrompt` migration); parse → `quiz_questions`/`labs` rows from the fixture payloads; every grading bucket (`true` / `false` / `null` via `GradeError`, with regrade recovery); failure paths — malformed/truncated payloads → corrective retries → `QuizGenerationError` (typed error card state), `LabGenerationError` → rawOffer → `saveRaw`.

## Scenario 3 — Read-only contract UI (SC-007)

On the running stack, open `/settings` → quiz (or lab) prompt config:

1. The effective prompt is viewable: contract read-only + instructions block.
2. Attempting to edit the contract is impossible — only the instructions textarea accepts input.
3. Attach custom instructions, save, generate a quiz from a chat → generation succeeds (contract untouched per I1/I4).
4. Clear instructions → key deleted → contract-only prompt.

Automated equivalent: `tests/e2e/prompt-contract.spec.ts` (green in Scenario 1).

## Scenario 4 — Fault injection proves the suites bite (SC-005/006)

Deliberately break one covered capability, e.g. change a quiz question-type payload key or the short-grading outcome mapping, then:

```bash
pnpm test:e2e && pnpm test
```

Expected: exactly the corresponding tests fail, localized to the affected capability (quiz fixture reply shape → quiz spec; grading bucket → logic suite; read-only edit guard → prompt-contract spec). Revert → all green.

## Scenario 5 — Unknown kinds fail loudly (FR-012)

Temporarily point a generation call at a body the mock cannot classify (or add a bogus tool description) and run the deck: the mock answers **HTTP 400** with `unrecognized request kind` hints; the spec fails red immediately — never a wrong-fixture green. Revert.

## RC gate (SC-002)

An RC candidate is verified by Scenario 1 + 2 alone (one command each, <15 min combined, no manual quiz/labs clicking). The manual pass is dropped once these are green in CI (`e2e` job) and locally.
