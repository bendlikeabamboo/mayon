# Quiz & labs RC verification — Playwright UI deck + logic tests

**What**: RC releases get verified by automated, deterministic runs — a Playwright UI deck over the quiz and labs flows plus logic-layer tests — instead of a manual quiz-and-labs pass on every tag.
**Why**: Every manual RC pass is a repeat-on-every-tag chore that's slow, inconsistently applied, and grows with the features; automation surfaces quiz/labs regressions in minutes, deterministically, before ship.

## The path

Extend the 017 e2e stack (`tests/fixtures/mock-llm/`, the `mock-llm` compose service, the onboarding fixture, existing chat/onboard/render specs) with full quiz/labs Playwright specs: onboard the mock provider through the real settings UI, drive a chat to the deterministic kitchen-sink reply, generate a quiz from it and answer every question type, generate a lab and step through it to completion — all through the real LLM proxy hop and placeholder-key path, so nothing about how data is intercepted changes. Teach the mock to discriminate request shapes (chat stream vs quiz generation vs lab generation vs short-answer grading) and serve a deterministic fixture reply per shape, keeping the fixture library inside `tests/fixtures/mock-llm/` so the test plumbing keeps the product diff empty. Add the mock's deterministic grading lever: the test answer text acts as an outcome selector ("should be correct" grades correct, "should be wrong" grades wrong), so both grading paths are assertable. Complement the browser deck with Vitest logic-layer coverage on the pglite driver — quiz reply → parse → questions → rows, every grading bucket, and the error paths (malformed/truncated replies, `QuizGenerationError`, `LabGenerationError`) — stubbing the provider at its interface where browser coverage would be miserable. Fold in one deliberate product change: the format/contract section of the quiz and lab generation prompts becomes read-only — users may attach custom instructions and view the full prompt via a settings button, but never edit the contract part — which protects the parser's output contract and makes the mock's request discrimination robust to user customization.

## Known snags

- The mock's one-reply limitation — bites on day one and blocks every quiz/labs spec until the mock discriminates request shapes; it is the bulk of the work, not an edge case.
- Discrimination robustness — even with the contract section locked, the mock's shape-detection must not depend on free text users can influence.
- The grading-lever trigger strings must survive whatever the app does to the answer text between the textarea and the request body, or the lever snaps quietly.
- Interception erosion — the first flaky spec will tempt `page.route` stubs of the proxy call; each stub bypasses the real hop and the suite starts testing the mocks, not the app. Write the "everything flows through the real server-container hop and placeholder-key path" guardrail down before the first flake.
- Role/label locators couple the specs to UI copy; copy changes mean spec updates.
- Logic tests stub the provider interface, so they have no witness for prompt assembly, the proxy hop, or the key path — the UI deck is the only automated witness for the interception path, which is why both layers ship together.

## Accepted trade-offs

- Green e2e proves the mock-path works, not that real providers work (accepted in 017; now extended to quiz/labs).
- A fixture library mirrors real LLM output shapes and needs drift management as prompts evolve — the read-only contract section reduces but does not eliminate this.
- A product change (read-only prompt contract) rides inside this feature, against 017's zero-product-change spirit — deliberate, user-ruled scope call.
- RC image/packaging verification is out of scope (card 003 declined); Docker reproducibility is trusted as-is.
- The logic layer does not cover rendering or wiring seams; the browser deck covers those instead.
- Visual-regression coverage (card 005 screenshot baselines) is not picked; subtle styling regressions stay caught by eye.

## The bet

This wins if the 017 mock-llm seam can be taught quiz/lab/grading dialects deterministically and the quiz/labs flows are stable enough to assert — then every RC drops its manual quiz-and-labs pass, regressions surface in minutes red/green, and the logic layer gets depth no browser suite could affordably reach.
