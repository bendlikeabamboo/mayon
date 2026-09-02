# Feature Specification: Mock-LLM Chat Test Suite

**Feature Branch**: `017-mock-llm-chat-tests`

**Created**: 2026-09-02

**Status**: Draft

**Input**: User description: "Build automated Playwright E2E coverage of the full chat experience — onboarding, send/receive, and rendering — with no live LLM, no API key, and no external network, using a stock OpenAI-protocol mock LLM server in the test stack. Zero product codebase changes."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - First deterministic chat round trip (Priority: P1)

A developer (or CI) runs the automated chat suite. The test environment contains a stand-in LLM service that answers every chat request with the same rich, predetermined reply. The suite drives the real application end to end: it adds a custom-endpoint (OpenAI-compatible) provider pointing at the stand-in through the app's actual add-provider flow, stores a placeholder key through the real key-storage path, selects the provider, sends a chat message, and observes a reply arrive and render. The whole flow completes with no real LLM, no real credential, and no network beyond the test environment.

**Why this priority**: This is the core promise — the request path (onboard → send → receive → render) is finally covered automatically. Without this story there is no way to produce a reply without a live provider, which is the original problem.

**Independent Test**: Can be fully tested by running the suite in a fresh test environment and confirming one complete onboard → send → receive → render cycle passes green.

**Acceptance Scenarios**:

1. **Given** a freshly started test environment, **When** the suite runs its first test, **Then** it completes provider onboarding through the app's real add-provider flow using the stand-in service's address, and the provider appears and behaves like any other provider.
2. **Given** the stand-in provider is onboarded with a placeholder key, **When** the test sends a chat message, **Then** a reply arrives through the application's normal provider-request path (including its server-assisted proxy when the test stack runs all-containerized) and is displayed in the conversation.
3. **Given** the reply has arrived, **When** the test inspects the rendered message, **Then** the displayed content matches the predetermined reply's substance — proving the full loop, not a canned UI state.
4. **Given** no external network access, **When** any part of the suite runs, **Then** every request stays inside the test environment and nothing requires a real AI service, real credential, or internet reachability.

---

### User Story 2 - Deep rendering coverage from one deterministic reply (Priority: P2)

Because the stand-in always returns the same content-rich "kitchen-sink" reply, the suite can assert rendering outcomes that were previously too flaky to automate: markdown structure (headings, lists, tables, quotes), math notation, diagrams, code blocks with their copy affordances, and source alignment for text selection/highlight features. Each covered rendering capability has a test that fails when the renderer regresses, using fixed content and fixed positions rather than guesswork.

**Why this priority**: Rendering is where regression risk concentrates; a deterministic reply finally gives those assertions stable ground. It builds directly on the P1 round trip (a reply must exist before it can be inspected).

**Independent Test**: Can be fully tested by running the rendering assertions against the deterministic reply and confirming each covered capability (structure, math, diagrams, copy affordance, source alignment) is checked and passes.

**Acceptance Scenarios**:

1. **Given** the kitchen-sink reply is rendered, **When** the suite runs the rendering tests, **Then** each covered capability asserts against known content at known locations and the results are identical run to run.
2. **Given** a rendering regression in any covered capability, **When** the suite runs, **Then** the corresponding test fails with a failure localized to the affected capability, not a vague end-to-end error.
3. **Given** the source-alignment tests, **When** they run against the deterministic reply, **Then** positions computed by the app match the known offsets in the reply's underlying text, deterministically.

---

### User Story 3 - The suite runs on every change with zero cost or flake (Priority: P3)

The full chat suite runs automatically in the project's CI on every pull request. It needs no secrets, incurs no per-run cost, and does not depend on any third-party service, so its results are deterministic: the same code always produces the same verdict. A developer can also run the entire suite locally with one command from a fresh environment.

**Why this priority**: CI integration is where the payoff compounds (every PR regression-checked), but it only matters once the suite itself exists and is green locally.

**Independent Test**: Can be fully tested by running the suite twice on identical code (locally and in CI) and confirming both runs are green, secret-free, network-isolated, and identical in outcome.

**Acceptance Scenarios**:

1. **Given** a pull request, **When** CI runs, **Then** the chat suite executes to completion with no credentials configured and no external service contacted.
2. **Given** the same commit, **When** the suite runs repeatedly (local or CI), **Then** outcomes are identical — no intermittent failures attributable to the test environment.
3. **Given** a fresh development machine with the project's standard tooling, **When** the developer runs the suite, **Then** it comes up and completes without manual environment surgery beyond the documented command.

---

### Edge Cases

- What happens when the stand-in service is unreachable or misconfigured? The suite fails fast with a clear, localized setup error rather than hanging on timeouts deep inside a test.
- What if the application requests a streamed reply but the stand-in only knows how to answer in one shot? That is a fidelity failure, not an acceptable simplification: the stand-in must behave the way the app expects for every request mode it uses, or the suite's confidence is false. Protocol fidelity is the acceptance bar for the stand-in itself.
- What happens when a new renderer capability ships (e.g., a new content type)? It does not automatically appear in the deterministic reply; the kitchen-sink fixture must be extended manually for it to be covered. This drift is accepted and documented, not solved in this feature.
- What about the other provider kinds (non-OpenAI-compatible dialects)? Explicitly out of scope; their dialect quirks remain untested by this suite and that is acceptable.
- What happens when a future test needs a different reply shape? It is added as a fixture of the stand-in service, never as a product feature; the product must gain no test-only mode.
- How does the suite handle the app's server-absent degradation model? The test stack always runs with the companion server present (the all-containerized stack), which is the configuration the round-trip path exercises.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The test environment MUST include a stand-in LLM service that speaks the standard OpenAI-compatible chat protocol, answering every chat request with one static, content-rich predetermined reply, and answering model-list probes so onboarding completes normally.
- **FR-002**: The stand-in MUST reply faithfully for every request mode the application actually uses (including streamed delivery when the app streams), not merely return a single non-streamed response; protocol fidelity is its acceptance bar.
- **FR-003**: The stand-in MUST be reachable from whichever component issues provider requests in the test environment (the server-assisted request path in the all-containerized stack), with one-time test-environment plumbing only.
- **FR-004**: The suite MUST onboard the stand-in through the application's real add-provider flow for a custom OpenAI-compatible endpoint, storing a placeholder key through the real credential-storage path — no bypass, no special-cased provider entry.
- **FR-005**: The application codebase MUST be unchanged by this feature's core capability: no in-app mock provider kind, no test-only mode, no demo mode. If a future test needs a different reply, it is a fixture of the stand-in service.
- **FR-006**: The suite MUST cover the complete round trip as one flow: onboarding → send → receive (through the application's normal request path) → rendered reply.
- **FR-007**: The suite MUST assert rendering of the deterministic reply for: markdown structure, math notation, diagrams, code blocks and their copy affordance, and source alignment (selection/highlight positions against known offsets).
- **FR-008**: The suite MUST run in CI on every pull request as part of the standard pipeline, requiring no secrets, no external network, and incurring no per-run usage cost; a CI job for the browser suite MUST be added (none exists today).
- **FR-009**: The suite MUST be runnable locally with a single documented command from a fresh environment using the project's standard tooling.
- **FR-010**: The stand-in's scope is limited to the OpenAI-compatible dialect; no support for other provider dialects is required or provided.

### Key Entities *(include if feature involves data)*

- **Stand-in LLM service**: A test-environment-only service speaking the OpenAI-compatible chat protocol. Attributes: static reply behavior (one kitchen-sink completion for every request), model-list response, streaming fidelity. Lives and dies inside the test stack; never shipped or referenced by the product.
- **Kitchen-sink fixture**: The predetermined reply document — deliberately content-rich (headings, lists, tables, quotes, math, diagrams, code) with known structure and known text offsets. Single source of truth for rendering assertions; owned by the test stack as the stand-in's fixture body.
- **Chat E2E suite**: The automated browser-level test suite and its environment wiring (stand-in service + application under test). Attributes: one-command local run, CI job, zero-secret configuration.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a fresh test environment, a complete onboard → send → receive → render cycle passes green in under 5 minutes with no real AI service, real credential, or external network involved.
- **SC-002**: Repeated runs of the suite on identical code produce identical outcomes — zero intermittent failures across consecutive runs (locally and in CI).
- **SC-003**: Every pull request receives automated regression coverage of the chat request path and the covered rendering capabilities, with zero credential configuration and zero per-run cost.
- **SC-004**: An intentional regression introduced in any covered rendering capability (structure, math, diagrams, copy affordance, source alignment) causes exactly the corresponding suite test to fail.
- **SC-005**: The product codebase diff for this feature's core capability is empty (test-stack and test files only).
- **SC-006**: Onboarding of the stand-in provider exercises the same code paths a user would traverse with a real provider (real add-provider flow, real credential storage), verified by the suite passing without any provider-specific shortcuts.

## Assumptions

- The application streams chat replies; the stand-in must therefore speak streamed delivery faithfully. If no off-the-shelf stand-in is protocol-faithful, a minimal tests-owned fixture service is acceptable (the repo already has a tests-owned stub-server precedent).
- "Zero product codebase changes" applies to the core capability (mock service, onboarding path, request path, rendering). Incidental product-adjacent files (compose/test configuration, CI workflow) are part of this feature.
- Only the custom OpenAI-compatible provider kind is exercised; dialect-specific behavior of other provider kinds is explicitly out of scope (per the 2026-09-02 decision, ideas/004-automated-chat-testing).
- Kitchen-sink drift is accepted: new renderer capabilities require manual fixture updates to gain coverage; no auto-generation of the fixture is attempted.
- The test stack runs the all-containerized configuration (companion server present), matching how the product is deployed and exercising the server-assisted provider-request path.
- The suite runs in a single CI job on the standard runner with container support available; the current pipeline has no browser-suite job, so one is added.
