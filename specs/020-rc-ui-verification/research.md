# Phase 0 Research: Quiz & Labs RC Verification

**Feature**: `020-rc-ui-verification` | **Date**: 2026-09-05
**Input**: [spec.md](./spec.md), codebase investigation of the 017 e2e stack and quiz/labs internals

All spec-level questions were already ruled in ideas/007 (hybrid approach, read-only contract in scope, image/packaging and visual regression out of scope). This document records the design decisions the plan depends on. No NEEDS CLARIFICATION items remain.

## D1 — Request-kind classification mechanism

**Decision**: The mock classifies `POST /v1/chat/completions` bodies by **code-owned, user-un-influenceable request aspects**, in this order:

1. `body.stream === true` and no `tools` → **chat** (existing SSE kitchen-sink behavior, unchanged).
2. `tools` present with a `json` tool → inspect the tool's `description` (a private code constant, never user-editable): contains the grading description marker → **short_grading**; otherwise inspect the system prompt for the quiz contract-section marker (`# Output shape` block unique to `DEFAULT_QUIZ_PROMPT`) vs the lab contract-section marker (unique to `DEFAULT_LAB_PROMPT`) → **quiz_generation** / **lab_generation**.
3. Anything else → unknown kind (see D7).

The quiz/lab contract sections become code-owned by the read-only contract change (D4), so their markers are as trustworthy as tool descriptions.

**Rationale**: FR-002 forbids classification from user-influenceable text. Tool descriptions (`QUIZ_TOOL_DESCRIPTION`, `GRADE_TOOL_DESCRIPTION`, lab equivalent) and the contract sections of the system prompts are private constants; user custom instructions are appended *after* the contract and never replace it, so markers survive any customization. Zero extra sentinel bytes are added to the product — the existing prose already carries stable distinctive markers, keeping "one deliberate product change" true.

**Alternatives considered**:
- *Sentinel lines appended to tool descriptions* (e.g. `mock-discriminator: quiz-v1`) — maximally explicit, but adds a second visible-to-no-one product diff; rejected to preserve the ruled scope.
- *Classifying on the user message content* — user-influenceable (custom instructions, answer wording); violates FR-002.
- *Separate mock endpoints per kind* — impossible without product changes; all kinds funnel through one OpenAI-compatible path by design (that is the point of testing the real request path).

## D2 — Mock reply protocol for generation and grading kinds

**Decision**: For quiz/lab/grading kinds the mock replies in the **OpenAI tool-call wire format** — a single assistant message with `tool_calls: [{ function: { name: 'json', arguments: '<fixture JSON as string>' } }]`, non-streamed, echoing the requested `model`. Chat keeps the existing SSE shape.

**Rationale**: All three kinds are served by `generateObjectViaTool` (`src/lib/ai/generate/object-tool.ts`), which expects the model to emit a `json` tool call; replying with plain text would trip `ObjectToolError` (`invalid_text`/`no_result`) instead of exercising the happy path. Fixture payloads are held as JS objects and stringified at reply time, so the fixtures stay readable and diffable.

**Alternatives considered**: *Fenced-JSON text replies* — only the legacy parser path (`parseGeneratedQuiz`) reads those; the live path ignores them, so coverage would be false.

## D3 — Grading lever semantics

**Decision**: On a **short_grading** request the mock scans the request's user block for trigger substrings (case-insensitive): contains `should be correct` → `{ isCorrect: true, feedback: <deterministic string> }`; contains `should be wrong` → `{ isCorrect: false, feedback: <deterministic string> }`; **neither → default `isCorrect: false`** with the deterministic default feedback. Both feedback strings and the graded shape (`{ isCorrect, feedback }` per `GradedAnswerSchema`) are fixed constants in the fixture library.

**Rationale**: FR-003 requires both outcomes assertable on demand plus a defined deterministic default. `false` is the conservative default: an unmarked answer can never fake a green score (attempt score counts `isCorrect === true` only). The triggers are plain lowercase words; investigation shows the app persists the answer text verbatim from the textarea into the grading request (no transformation), so the lever survives the real UI path — and FR-006/FR-012's end-to-end assertion is exactly what proves it stays that way.

**Alternatives considered**: *Default `true`* — an accidentally unmarked answer would inflate scores; rejected as fail-unsafe in the wrong direction. *Structured marker fields in the request* — would require product changes to the grading call; rejected (scope).

## D4 — Read-only contract model and legacy settings migration

**Decision**: Split prompt assembly into two parts:

- **Contract**: stays in code (`DEFAULT_QUIZ_PROMPT` / `DEFAULT_LAB_PROMPT` contract sections + tool descriptions). Never read from settings, never rendered editable.
- **Custom instructions**: new settings KV keys `quizInstructions` / `labInstructions` (free text). Assembly = contract + (instructions ? `# Custom instructions` block appended after the contract : nothing).

Legacy whole-prompt overrides (`quizPrompt` / `labPrompt`) are **migrated on read**: if a legacy value exists and the new key is absent, its content becomes the value of the instructions key and the legacy key is deleted (one-time, idempotent). The settings UI components are reworked: contract shown read-only in the "effective prompt" view, instructions textarea, reset-instructions button.

**Rationale**: FR-009 requires that no UI path can edit the contract; keeping the contract as a code constant is the only enforcement that holds against every path (today the whole prompt — contract included — is a user-editable KV value). Read-migration avoids silent data loss for users who customized prompts; any old contract text embedded in migrated instructions is inert for discrimination (contract comes from code, D1) and for the parser (the contract arrives first and unmodified).

**Alternatives considered**: *Keep `quizPrompt` as full prompt, enforce read-only in UI only* — the KV value remains user-writable via any settings write path; contract protection would be cosmetic; rejected. *Drop legacy values* — silent user-data loss; rejected.

## D5 — MCQ option shuffle vs deck determinism

**Decision**: The deck asserts MCQ outcomes **payload-driven**: it locates options by their label text from the fixture (the fixture's correct answer text is unique and known) and asserts the attempt score from fixture payloads — never from option positions. No product change to `shuffleMcqOptions`.

**Rationale**: `toQuizQuestions` shuffles MCQ options at persist time with an unseeded Fisher–Yates, so option positions legitimately differ run-to-run; asserting positions would break SC-004 determinism. Payload-driven locators keep the product untouched (the ruled scope allows exactly one product change) while remaining deterministic.

**Alternatives considered**: *Seed the RNG in test mode* — a test-only product behavior, violates the "no test-only mode" invariant (017 FR-005 spirit) and the one-product-change scope; rejected.

## D6 — Deck structure and journey chaining

**Decision**: Two new spec files, `tests/e2e/quiz.spec.ts` and `tests/e2e/lab.spec.ts`, plus `tests/e2e/prompt-contract.spec.ts`. Quiz and lab each run as **one chained journey per test** (onboarded fixture → chat to kitchen-sink reply → generate → interact → assert), matching the 017 "complete round trip as one flow" style. The existing `onboarded` fixture (real settings onboarding, placeholder key) is reused as-is; shared constants (fixture markers, expected payloads, trigger phrases) live in `tests/e2e/fixtures/kitchen-sink.ts` alongside the existing ones. A `tests/fixtures/mock-llm/README.md` records the FR-005 guardrail ("everything flows through the real server-container hop and placeholder-key path; no `page.route`, ever, even when flaky") before the first flake.

**Rationale**: Journeys exercise the artifact entry points users actually use (chat page composer buttons, `/quiz/[id]` and `/lab/[id]` runners). Separate files keep failure localization (SC-005) and let each ship independently. Writing the guardrail down now is the spec's explicit ask ("before the first flake").

**Alternatives considered**: *One mega-spec for quiz+lab* — poorer localization, slower feedback; rejected. *State-preserving shared onboarding across specs* — couples specs to execution order; rejected (each test re-onboards, as today).

## D7 — Unknown request kinds fail loudly

**Decision**: An unclassifiable `tools`-bearing request gets **HTTP 400** with a JSON body naming the mismatch (`{ error: 'unrecognized request kind', hints: [...] }`), and the mock logs the classification inputs. The deck treats any 400 from the proxy path as a hard failure.

**Rationale**: FR-012 + edge case: a future request shape (e.g. a fourth generation kind) must never silently receive the wrong fixture and produce a false-green. A 400 surfaces as an immediate, diagnosable red.

**Alternatives considered**: *Fall back to the chat fixture* — exactly the false-green this feature exists to prevent; rejected. *Fall back to 500* — equivalent, but 400 + hints makes the fix obvious.

## D8 — Logic-layer suite shape and stub point

**Decision**: Extend the existing Vitest patterns rather than inventing new ones: stub at the **AI SDK `generateText` boundary** (`vi.mock('ai')` returning `toolCalls: [{ toolName: 'json', input: <fixture> }]` — the established pattern in `generate-quiz.test.ts` / `object-tool.test.ts`) for orchestrator-level tests, and drive **store-level flows on pglite** (`useFileTestDb()`, as `quizzes.svelte.test.ts` does) for parse → persist → grade → attempt-finalization chains. New/extended coverage: (a) prompt assembly — contract bytes immutable, instructions appended, legacy migration; (b) every grading bucket via `runShortGrading` with mocked true/false/failure outcomes (true/false/null tri-state incl. `GradeError → isCorrect: null`); (c) failure paths — malformed/truncated fixture payloads → corrective retries → `QuizGenerationError`, lab → `LabGenerationError` + rawOffer path.

**Rationale**: The `LanguageModel`/`generateText` seam is the established stub point (constitution-compliant: repositories and stores still touch real pglite). Reusing per-file db bootstrap matches the repo's test conventions; no new test infra.

**Alternatives considered**: *Stub `getActiveSdkProvider` only* — misses corrective-retry and error-wrapping paths at the orchestrator; *browser-only coverage of failure paths* — explicitly the "miserable" case the spec assigns to the logic layer.

## Constitution re-check (post-design)

Pass — D1–D8 add no seam deviations: settings access stays via `repos.settings`, prompt assembly stays in `src/lib/ai/generate/`, UI rework stays in the two existing settings components, test work stays under `tests/` and existing Vitest patterns. No schema changes, no new runtime dependencies, no `search_vec` writes. Complexity Tracking in plan.md remains empty.
