# Feature Specification: Quiz & Labs RC Verification

**Feature Branch**: `020-rc-ui-verification`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "ideas/007-rc-ui-verification/spec.md — RC releases get verified by automated, deterministic runs — a browser UI deck over the quiz and labs flows plus logic-layer tests — instead of a manual quiz-and-labs pass on every tag."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The stand-in learns the quiz/lab/grading dialects (Priority: P1)

Today the test environment's stand-in LLM service answers every request with the same single chat reply. The moment any quiz or lab flow runs against it, it serves the wrong kind of answer and every quiz/labs verification is blocked. This story teaches the stand-in to recognize what kind of request it received — chat, quiz generation, lab generation, or short-answer grading — and answer each kind with its own predetermined, deterministic fixture reply. The fixture library lives with the test plumbing, and the stand-in's recognition of request kinds must not depend on any free-form text a user could influence.

**Why this priority**: This is the blocker. The stand-in's one-reply limitation bites on day one and blocks every quiz/labs verification until request kinds are discriminated; it is the bulk of the work, not an edge case. Nothing else in this feature can run without it.

**Independent Test**: Can be fully tested by issuing each request kind against the stand-in (via the real application flows) and confirming each receives its own deterministic fixture reply, identical on every run, regardless of what custom text the requests carry.

**Acceptance Scenarios**:

1. **Given** the stand-in is running, **When** a chat request arrives, **Then** it receives the established deterministic chat reply, unchanged from today's behavior.
2. **Given** the stand-in is running, **When** a quiz-generation request arrives, **Then** it receives a deterministic quiz fixture covering every question type the app supports.
3. **Given** the stand-in is running, **When** a lab-generation request arrives, **Then** it receives a deterministic lab fixture with known steps.
4. **Given** the stand-in is running, **When** a short-answer grading request arrives, **Then** the grading outcome is deterministic and controlled by the caller (see the grading lever, FR-003).
5. **Given** a request carries arbitrary user-authored text (custom instructions, odd answer wording), **When** the stand-in classifies it, **Then** classification depends only on request aspects users cannot influence, and the same request always maps to the same fixture.

---

### User Story 2 - One automated run replaces the manual RC quiz-and-labs pass (Priority: P2)

A release engineer preparing a release candidate runs the automated browser verification deck instead of manually clicking through quiz and labs. The deck drives the real application end to end: it onboards the stand-in provider through the real settings UI, holds a conversation until the deterministic rich reply arrives, generates a quiz from that reply and answers every question type, then generates a lab and steps through it to completion. Every request flows through the application's normal server-assisted provider-request path with the placeholder-key path — nothing about how requests travel changes. Answer text doubles as an outcome selector ("should be correct" grades correct, "should be wrong" grades wrong), so both grading outcomes are asserted, not just the happy path. The verdict is red/green in minutes.

**Why this priority**: This is the headline deliverable — the replacement for the manual pass on every tag. It is what makes RC verification fast, repeatable, and consistently applied.

**Independent Test**: Can be fully tested by running the deck against a fresh test environment and confirming the full onboard → chat → quiz → grade → lab journey passes green with both grading outcomes asserted.

**Acceptance Scenarios**:

1. **Given** a freshly started test environment, **When** the deck runs, **Then** it onboards the stand-in provider through the application's real settings flow with a placeholder key, exactly as a user would.
2. **Given** the stand-in provider is onboarded, **When** the deck drives a conversation, **Then** the deterministic rich reply arrives and renders through the normal request path.
3. **Given** the rich reply is rendered, **When** the deck generates a quiz from it, **Then** a quiz appears with the fixture's known questions, and the deck answers every question type the app supports.
4. **Given** a quiz with short-answer questions, **When** the deck submits an answer marked as "should be correct", **Then** grading returns correct; **When** it submits an answer marked as "should be wrong", **Then** grading returns wrong.
5. **Given** the quiz is complete, **When** the deck generates a lab and steps through it, **Then** each step behaves per the fixture and the lab reaches completion through the real UI.
6. **Given** any point in the journey, **When** requests are issued, **Then** they travel the application's real provider-request path (server-assisted hop, placeholder key) — the deck never intercepts or bypasses that path to fake an outcome.

---

### User Story 3 - Read-only generation contract protects the pipeline (Priority: P3)

Quiz and lab generation prompts have a format/contract section the parser depends on. Today a user can edit it and silently break generation. This story makes the contract section read-only: users can view the full prompt through a settings affordance and attach their own custom instructions, but they can never edit the contract part. This protects generation correctness for real users and keeps the stand-in's request classification robust against customization.

**Why this priority**: It is the feature's one deliberate product change, user-ruled into scope. It directly protects both real users (parser contract) and the verification (stable request shapes). It ships with the feature but does not block stories 1–2 from being built; it does gate their long-term robustness.

**Independent Test**: Can be fully tested by opening the settings affordance for quiz and lab generation prompts, confirming the contract section cannot be edited, custom instructions can be attached, and the full prompt is viewable.

**Acceptance Scenarios**:

1. **Given** a user opens the quiz or lab generation prompt settings, **When** they view the prompt, **Then** the full prompt including the contract section is visible.
2. **Given** the prompt settings are open, **When** the user attempts to edit the contract section, **Then** the interface does not allow it (the section is read-only).
3. **Given** the prompt settings are open, **When** the user attaches custom instructions, **Then** they are saved and included in subsequent generation requests alongside the untouched contract section.
4. **Given** custom instructions are attached, **When** a quiz or lab is generated, **Then** generation succeeds and the contract section in the request is byte-identical to the shipped contract.

---

### User Story 4 - Logic-layer depth no browser suite could affordably reach (Priority: P4)

Complementing the browser deck, a non-browser logic-layer suite exercises quiz and lab processing directly: a generation reply is parsed into questions and persisted rows, every grading bucket is exercised, and the failure paths are asserted — malformed and truncated replies, and generation-level errors. The LLM is stubbed at the provider interface, which means this layer has no witness for prompt assembly, the proxy hop, or the key path; that witness is the browser deck's job, which is why both layers ship together.

**Why this priority**: It adds regression depth cheaply — grading buckets and corrupt-reply handling are miserable to reach through a browser. It completes the verification story but the manual pass is already replaced by stories 1–2.

**Independent Test**: Can be fully tested by running the logic suite against the in-memory test database and confirming parse→persist, every grading bucket, and each failure path is asserted and passes.

**Acceptance Scenarios**:

1. **Given** a well-formed quiz generation reply fixture, **When** the logic layer processes it, **Then** it parses into the expected questions and persisted rows, deterministically.
2. **Given** each grading bucket, **When** a short answer is graded, **Then** it lands in the correct bucket — every bucket is exercised and asserted.
3. **Given** a malformed or truncated generation reply, **When** the logic layer processes it, **Then** the documented failure behavior occurs (no silent partial state).
4. **Given** a generation-level error condition, **When** the logic layer processes it, **Then** the corresponding error path is taken and surfaced as designed.

---

### Edge Cases

- What happens when a user's custom instructions contain the grading lever trigger phrases or text that mimics another request kind? Classification and grading must not depend on user-influenceable free text for request-kind detection; the lever's trigger phrases must survive whatever the application does to answer text between the input field and the request, or the lever snaps quietly — the deck must prove the lever works end to end through the real UI.
- What happens when an answer contains no trigger phrase? The default grading outcome must be defined and deterministic, never ambiguous between runs.
- What happens when the stand-in receives a request kind it does not recognize (a future request shape)? It must fail loudly and observably rather than silently serving the wrong fixture and producing a false-green.
- What happens when two different request kinds are in flight concurrently (e.g., a chat stream while a quiz generates)? Each must receive its own correct fixture reply.
- What happens when UI copy changes? The deck's locators couple to roles and labels; copy changes mean deck updates. Accepted maintenance, documented as such.
- What happens when a lab step or quiz question set evolves? Fixtures must be updated deliberately; drift between fixtures and prompts is accepted and managed (the read-only contract section reduces but does not eliminate it).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The test environment's stand-in LLM service MUST discriminate request kinds — chat, quiz generation, lab generation, and short-answer grading — and serve a deterministic fixture reply per kind.
- **FR-002**: Request-kind classification MUST rely only on request aspects users cannot influence (structure/shape of the request), never on free-form user-authored text.
- **FR-003**: The stand-in MUST offer a deterministic grading lever: the submitted answer text acts as an outcome selector, such that a "should be correct" answer grades correct and a "should be wrong" answer grades wrong, with a defined deterministic default for answers containing neither trigger.
- **FR-004**: The browser verification deck MUST cover the full journey through the real application: provider onboarding via the real settings UI, chat to the deterministic rich reply, quiz generation from that reply, answering every supported question type, lab generation, and stepping a lab to completion.
- **FR-005**: Every request in the deck MUST travel the application's real provider-request path (server-assisted hop and placeholder-key path); interception or stubbing of that path to fake outcomes MUST NOT be introduced, and this guardrail holds even when a spec gets flaky.
- **FR-006**: The grading lever MUST be exercised end to end through the real user interface for both outcomes (correct and wrong), proving trigger phrases survive the application's answer handling.
- **FR-007**: An RC MUST be verifiable by running the automated suites (browser deck + logic suite) with no manual quiz-and-labs pass required; the suites MUST be runnable with one documented command from a fresh test environment.
- **FR-008**: The logic-layer suite MUST cover, without a browser: generation reply → parse → questions → persisted rows; every grading bucket; and the failure paths for malformed replies, truncated replies, and generation-level errors.
- **FR-009**: The format/contract section of the quiz and lab generation prompts MUST become read-only to users; users MUST be able to view the full prompt via a settings affordance and attach custom instructions, but MUST NOT be able to edit the contract section.
- **FR-010**: Fixture replies MUST live with the test plumbing (never as product features); the product gains no test-only mode, and the stand-in's fixture library stays inside the test stack.
- **FR-011**: The stand-in MUST handle concurrent requests of different kinds correctly, each mapped to its own fixture.
- **FR-012**: Unknown request kinds MUST produce a loud, diagnosable failure rather than a wrong-fixture reply.

### Key Entities *(include if data involved)*

- **Stand-in LLM service**: The test-environment-only provider stand-in. Attributes: per-request-kind fixture replies, streaming fidelity for chat (established), deterministic grading lever, loud failure on unknown kinds. Never shipped or referenced by the product.
- **Fixture library**: The predetermined reply bodies per request kind — quiz fixture covering every question type, lab fixture with known steps, grading behavior. Single source of truth for quiz/labs assertions; owned by the test stack.
- **Grading lever**: The trigger-phrase convention embedded in submitted answers ("should be correct" / "should be wrong") that selects the deterministic grading outcome, plus its defined default.
- **Browser verification deck**: The automated UI journey suite for RC verification. Attributes: real onboarding, real request path, both grading outcomes, one-command run, red/green verdict.
- **Logic-layer suite**: The non-browser suite over quiz/lab processing. Attributes: parse→persist coverage, all grading buckets, failure-path coverage; stubs at the provider interface with no witness of the network path.
- **Prompt contract section**: The read-only portion of quiz/lab generation prompts that the parser's output contract depends on; viewable, never editable.
- **Custom instructions**: User-attached text included in generation requests alongside the immutable contract section.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A release candidate's quiz-and-labs verification completes as one automated red/green run in under 15 minutes, with no manual steps.
- **SC-002**: The manual quiz-and-labs RC pass is dropped entirely: zero manual verification passes per RC tag once this ships.
- **SC-003**: Every supported question type, every grading bucket, and both deterministic grading outcomes are asserted in each verification run (100% of the covered matrix, every run).
- **SC-004**: Verification runs are deterministic: consecutive runs on identical code produce identical outcomes, with zero intermittent failures across at least 10 consecutive runs.
- **SC-005**: A deliberately introduced quiz or lab regression (generation, grading, or stepping) causes the corresponding suite test to fail with a failure localized to the affected capability, proven by fault injection.
- **SC-006**: Malformed and truncated generation replies and generation-level errors are caught automatically — each failure path fails the suite when its handling regresses.
- **SC-007**: Users can attach custom instructions to quiz and lab generation and view the full prompt, while no UI path allows editing the contract section (verified by attempting it).
- **SC-008**: The stand-in classifies request kinds identically regardless of user-authored content: varying custom instructions and answer wording never changes which fixture a request receives.

## Assumptions

- The existing 017 verification stack is extended, not replaced: the stand-in service, its compose wiring, the onboarding fixture, and the existing chat/onboard/render specs remain, and the interception approach is unchanged.
- Quiz and labs flows are stable enough to assert against deterministically — this is the feature's stated bet; if flows churn, fixture upkeep grows.
- Green verification proves the mock-path works, not that real providers work (accepted in 017; now extended to quiz/labs).
- Fixture replies mirror real LLM output shapes and need drift management as prompts evolve; the read-only contract section reduces but does not eliminate this.
- Exactly one deliberate product change rides in this feature — the read-only generation contract — against 017's zero-product-change spirit; user-ruled scope call (ideas/007, 2026-09-05).
- RC image/packaging verification is out of scope (card 003 declined); Docker reproducibility is trusted as-is.
- Visual-regression coverage (screenshot baselines) is not picked; subtle styling regressions stay caught by eye.
- The logic layer does not cover rendering or wiring seams; the browser deck is the sole automated witness for prompt assembly, the proxy hop, and the key path.
- The grading-lever trigger phrases are chosen to survive the application's answer-text handling; if the application transforms answers in ways that mangle them, the deck will catch it (that is the point of FR-006).
