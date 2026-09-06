# Contract: Mock-LLM wire protocol (request-kind classification + fixtures)

**Feature**: `020-rc-ui-verification` | **Owner**: test stack (`tests/fixtures/mock-llm/server.mjs`)

The stand-in speaks the OpenAI chat-completions protocol. This contract is the source of truth for how it discriminates request kinds and what each kind receives. Consumers: the browser deck, the CI e2e job, and anyone extending the fixtures.

## Endpoints (unchanged surface)

- `GET /v1/models` → single-model catalog (`mock-sink`) — unchanged.
- `POST /v1/chat/completions` → classified per the table below. Malformed JSON → 400 (existing).

## Classification rules (ordered, first match wins)

Classification reads ONLY: `body.stream`, `body.tools`, the `json` tool's `description`, and code-owned contract bytes in the FIRST system message. Rules 3–5 match exclusively code-owned bytes: grading via the tool description, quiz/lab via `startsWith` on the contract opening (quiz and lab generation lead the system message with their contract — `includeSystemNotes: false` — so appended user instructions can never flip the match). Rule 6 is an `includes` fallback checked LAST: brief generation prepends context system notes to its prompt, so its marker cannot be anchored; after rules 4–5 only genuine brief requests carry it, and a brief request can only be shadowed if user-authored context notes happen to quote a contract opening verbatim (accepted residual, documented here). Markers live once in `tests/fixtures/mock-llm/markers.mjs`, imported by `server.mjs` and pinned to the product constants by `src/lib/ai/generate/classification-markers.test.ts`.

| # | Condition | Kind | Response |
|---|-----------|------|----------|
| 1 | `stream === true` and no `tools` | `chat` | SSE stream: role delta → content chunks of `kitchen-sink.md` (3 blocks/chunk, 150 ms pacing) → terminal `finish_reason: 'stop'` → `[DONE]` (existing behavior, byte-identical) |
| 2 | no `tools`, `stream !== true` | `chat` (non-streamed) | single completion, first prose block of `kitchen-sink.md` (existing behavior) |
| 3 | `tools` present, `json` tool description contains the grading marker (stable substring of `GRADE_TOOL_DESCRIPTION`) | `short_grading` | tool-call reply; outcome from the lever (below) |
| 4 | `tools` present, first system message **starts with** the quiz contract opening (`You are a quiz designer.`) | `quiz_generation` | tool-call reply carrying `quiz-fixture.mjs` |
| 5 | `tools` present, first system message **starts with** the lab contract opening (`You are a learning lab designer.`) | `lab_generation` | tool-call reply carrying `lab-fixture.mjs` |
| 6 | `tools` present, first system message contains the brief marker (`DEFAULT_BRIEF_PROMPT`'s opening line) — fallback, checked last | `brief_generation` | tool-call reply carrying `brief-fixture.mjs` |
| 7 | anything else | *(unknown)* | **HTTP 400** `{ error: 'unrecognized request kind', hints: [hasTools, toolDescriptionPrefix, systemPrefix] }` + server-side log — never a wrong-fixture reply |

> **Amendment (implementation, 2026-09-06):** `brief_generation` was discovered during e2e validation — the learning-brief dialog fires a brief-generation request (generic `json` tool, `DEFAULT_BRIEF_PROMPT` system prompt) during onboarding. 017's protocol-fidelity bar (FR-002: "reply faithfully for every request mode the application actually uses") requires the stand-in to serve it; an earlier build's 400s on this kind were the loud-failure branch doing its job.

## Tool-call reply shape (kinds 3–5)

Non-streamed OpenAI completion whose first choice carries:

```text
tool_calls: [ { function: { name: 'json', arguments: '<fixture payload, JSON-stringified>' } } ]
finish_reason: 'tool_calls'
```

`model` echoes the requested model (fallback `mock-sink`).

## Fixture payloads (single source of truth per kind)

- `brief_generation` → `GeneratedBrief`-conforming object (`goal` required; optional enum fields only — the schema is `.strict()`) with deterministic photosynthesis values.
- `quiz_generation` → `GeneratedQuiz`-conforming object with exactly one question per supported type — `mcq` (options with a **textually unique** correct answer), `flashcard`, `short` (rubric gradeable both ways).
- `lab_generation` → `GeneratedLab`-conforming object: `title`, `intro`, ≥2 known `steps`, ≥2 known `checklist` items.
- `short_grading` → `{ isCorrect: boolean, feedback: string }` selected by the lever.

Fixture payloads MUST validate against the product Zod schemas as-is. Fixture drift is managed by updating `tests/fixtures/mock-llm/*.mjs` when the code-owned contract markers or schemas evolve — never by loosening the mock.

## Grading lever (kind 3)

Scans the request's user block (the grading user block carries rubric + answer):

| Answer text contains (case-insensitive) | `isCorrect` |
|------------------------------------------|-------------|
| `should be correct` | `true` |
| `should be wrong` | `false` |
| neither | `false` (deterministic default) |

`feedback` is a fixed constant per branch. The lever applies only within kind-3 requests; answer text never influences other kinds.

## Guardrail (FR-005 — write-down-before-first-flake)

Every deck request must travel the real path: browser → `createKeychainFetch` (IndexedDB placeholder key `e2e-placeholder-key`) → `/api/llm/proxy` → server container fetch → `http://mock-llm:9999/v1/...`. **`page.route` interception of the provider path is prohibited in this suite — including as a "temporary" flake workaround.** If a spec flakes, fix the timing or the fixture; do not bypass the hop. A bypassed hop tests the mocks, not the app.

## Concurrency

Requests of different kinds in flight concurrently each classify and receive their own fixture; no shared mutable state between requests beyond the static fixture library.
