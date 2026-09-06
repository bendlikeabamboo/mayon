# Mock-LLM fixture library

Static fixtures served by `server.mjs`, the stand-in OpenAI-compatible LLM used
by the RC verification deck (feature `020-rc-ui-verification`). The wire
protocol — request-kind classification, reply shapes, and the grading lever —
is specified in
[docs/history/appendices/020-mock-llm-protocol.md](../../../docs/history/appendices/020-mock-llm-protocol.md) The classification markers themselves live once in [markers.mjs](markers.mjs) — imported by `server.mjs` and pinned to the product constants by `src/lib/ai/generate/classification-markers.test.ts`; never re-type them.,
which is the source of truth for this directory.

## FR-005 guardrail: the real request path only

Every request must travel the real path: browser → placeholder key from
IndexedDB (`e2e-placeholder-key`) → `/api/llm/proxy` → server container fetch →
`http://mock-llm:9999/v1/...`. **`page.route` interception of the provider path
is PROHIBITED in this suite, including as a flake workaround — a bypassed hop
tests the mocks, not the app.** If a spec flakes, fix the timing or the
fixture; do not bypass the hop.

## Fixture inventory

- `kitchen-sink.md` — chat SSE reply (streamed blocks; non-streamed requests
  get the first prose block).
- `brief-fixture.mjs (brief_generation) + quiz-fixture.mjs` — `quiz_generation` tool-call payload
  (`GeneratedQuiz`-conforming, exactly one question per type).
- `lab-fixture.mjs` — `lab_generation` tool-call payload
  (`GeneratedLab`-conforming).
- Grading (`short_grading`) — no fixture file: the lever in `server.mjs`
  resolves `{isCorrect, feedback}` from the request's user block (triggers:
  `should be correct` / `should be wrong`).
