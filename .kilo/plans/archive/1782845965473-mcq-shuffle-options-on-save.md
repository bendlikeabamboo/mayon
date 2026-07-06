# Plan: Shuffle MCQ options on save

## Problem
LLM quiz generation is biased toward emitting `answerIndex: 0`, so the correct
answer lands on the first option ("A") disproportionately. Fix: shuffle MCQ
options **once at save time** so the stored payload is permanently shuffled with
a consistent `answerIndex`. The model keeps emitting its natural order; we permute
before persist. Scoring and rendering are unaffected (both already data-driven).

## Decision: shuffle inside `toQuizQuestions`
File: `src/lib/ai/generate/quiz.ts`

This is the single chokepoint — both persist paths funnel through it:
- store: `src/lib/stores/quizzes.svelte.ts:179` (`generateQuiz` -> `toQuizQuestions` -> `repos.quizQuestions.add`)
- agent: `src/lib/agent/generative-tools.ts:41` (same chain)

After this transform, the stored `payload.options` (shuffled order) and
`payload.answerIndex` (points at the correct option in the new order) are
permanently consistent. No schema or semantics change.

Consumers already correct — verify no edits needed (only read `answerIndex`):
- Scoring: `src/lib/stores/quizzes.svelte.ts:257` (`selectedIndex === payload.answerIndex`)
- Rendering: `src/lib/components/quizzes/McqQuestion.svelte:38` (`i === payload.answerIndex`)

## Tasks

### 1. Add `shuffleMcqOptions` helper (pure) — `src/lib/ai/generate/quiz.ts`
- Signature: `shuffleMcqOptions(options: string[], answerIndex: number, rng: () => number = Math.random): { options: string[]; answerIndex: number }`
- Track **positions**, not values (avoids a bug if two option strings are equal):
  1. Build `order = [0, 1, ..., options.length - 1]`.
  2. Fisher–Yates shuffle `order` using `rng()` (in-place, backwards).
  3. New options = `order.map((i) => options[i])`.
  4. New answerIndex = `order.indexOf(oldAnswerIndex)`.
- Export it (used by tests).

### 2. Call it from `toQuizQuestions` — same file
- In the `map`, for `q.type === 'mcq'`, replace the payload with
  `shuffleMcqOptions(q.payload.options, q.payload.answerIndex)`.
- Leave `flashcard` and `short` payloads untouched.
- Runtime uses the default `rng = Math.random` (each generated quiz is one-shot;
  no seed is needed or stored).

### 3. Update tests — `src/lib/ai/generate/quiz.test.ts`
- The existing `toQuizQuestions` test (lines 181-184) asserts the exact payload
  `{ options: ['3','4','5','6'], answerIndex: 1 }`. This is now non-deterministic.
  Replace with **invariant** assertions:
  - shuffled options are a permutation of input (same multiset, same length),
  - `out[0].payload.options[out[0].payload.answerIndex] === '4'` (the originally-correct option — the answer always points at the right text regardless of where it lands).
- Add a dedicated `describe('shuffleMcqOptions')` using a **deterministic stub rng**
  (e.g. a closure returning values from a fixed sequence, or a tiny seeded LCG) to
  assert an exact permutation and that `answerIndex` correctly tracks the moved
  correct option. Include the 2-option edge case.

### 4. Verify no other consumer assumes a fixed answer position
- Grep for `answerIndex` (known callers listed above are all data-driven).
- `registry.test.ts:118` and `generative-tools.test.ts:40` build hand-crafted
  payloads directly via `repos.quizQuestions.add` (bypassing `toQuizQuestions`);
  they are test fixtures and do NOT need shuffling — leave as-is.

## Validation
- `pnpm test` — helper unit test (exact permutation via stub rng) + `toQuizQuestions`
  invariant assertions pass.
- `pnpm check` + `pnpm lint` clean.
- Manual: generate a quiz (`/chat` -> quiz) several times; confirm the correct
  answer no longer always appears as the first option, and that selecting it still
  scores "Correct".

## Out of scope
- **Existing already-persisted quizzes are NOT re-shuffled.** Their recorded
  attempts reference the original option order; re-shuffling would corrupt stored
  picks. Only newly-generated quizzes are shuffled. No DB migration.
- No change to the generation prompt, schema, scoring, or rendering.
