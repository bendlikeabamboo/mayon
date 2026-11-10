# Mock-LLM fixture library

Static fixtures served by `server.mjs`, the stand-in OpenAI-compatible LLM used
by the RC verification deck (feature `020-rc-ui-verification`). The wire
protocol — request-kind classification, reply shapes, and the grading lever —
is specified in
[docs/history/appendices/020-mock-llm-protocol.md](../../../docs/history/appendices/020-mock-llm-protocol.md) The classification markers themselves live once in [markers.mjs](markers.mjs) — imported by `server.mjs` and pinned to the product constants by `src/lib/ai/generate/classification-markers.test.ts`; never re-type them.,
which is the source of truth for this directory.

## Import rules: single-source fixture strings

The fixture-only assertion strings (grading-lever triggers, back-propagation
dispatch, image reply) live once in [strings.mjs](strings.mjs): `server.mjs`
serves exactly those constants, e2e specs get them via the
`tests/e2e/fixtures/kitchen-sink.ts` re-export, and fast-tier tests import
dynamically via `fileURLToPath` (this directory is tsconfig-excluded). The
drift guard is
`src/lib/ai/generate/classification-markers.test.ts`. Hand-mirroring a served
string anywhere is a violation — the full consumer rules and guard contract:
[specs/031-split-text-e2e-tests/contracts/shared-fixtures.md](../../../specs/031-split-text-e2e-tests/contracts/shared-fixtures.md).

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
- Back-propagation dispatch (feature 027, quickstart V6) — no fixture files:
  three kinds in `server.mjs`, selected by the trigger phrase in the LAST user
  message (anchored on the last message being role 'user', so continuations
  fall through to the chat stream). `this branch feels done` →
  `propagate_offer` (US2 offer-once: one plain-text offer naming the manual
  back-propagate control plus an explicit ask, never a tool call);
  `backpropagate this branch` → `propagate_tool_call` (tools contain
  `propagate_to_parent`; streams an OpenAI-style `propagate_to_parent` tool
  call with arguments `{"mode":"raw"}`) or `propagate_unavailable` (tool
  absent — root chats; streams the manual-control sentence). The trigger and
  reply constants live in [strings.mjs](strings.mjs) (fixture-only, no
  product-constant pin, so not in `markers.mjs`) and are re-exported for spec
  assertions by `tests/e2e/fixtures/kitchen-sink.ts`
  (`PROPAGATE_TRIGGER`, `PROPAGATE_UNAVAILABLE_REPLY`, `OFFER_TRIGGER`,
  `OFFER_REPLY`).
- Interleaved reasoning (feature 029, `chat_interleaved`) — no fixture file:
  a streamed plain chat where the LAST user message contains the exact,
  case-sensitive marker `[[interleaved-thoughts]]` (and the request has no
  tools) streams reasoning/text deltas interleaved — ≥2 `reasoning_content`
  deltas, 1–2 content deltas, ≥2 `reasoning_content` deltas again (reasoning
  re-opened AFTER text — the defect case), 1–2 content deltas, then one final
  `reasoning_content` delta with no trailing content — before the unchanged
  `stop` terminal. Without the marker all flows are byte-identical. Spec:
  `specs/029-micro-thoughts/contracts/mock-llm-reasoning.md`.
- Image-reply dispatch (feature 030, US1) — no fixture file: the
  `IMAGE_TRIGGER` phrase in the LAST user turn selects an image reply (openai
  and google dialects), with constants (`IMAGE_TRIGGER`, `IMAGE_REPLY_TEXT`,
  `IMAGE_PNG_MIME`, `IMAGE_PNG_BASE64`) in [strings.mjs](strings.mjs),
  re-exported by `kitchen-sink.ts` alongside `IMAGE_DATA_URL`.
