# Feature Specification: Test Suite Tiering

**Feature Branch**: `032-test-suite-tiering`

**Created**: 2026-11-10

**Status**: Draft

**Input**: User description: "Audit, evaluate, and ruthlessly refactor the application's test suite to eliminate execution bottlenecks, remove architectural bloat, and achieve instant local and CI feedback loops. Test business logic in pure Node, server endpoints at the module boundary, UI components in Vite's native environment, and end-to-end flows only when real browser integration is mandatory."

## Context (current state, measured)

The audit that motivated this feature found:

- 186 unit/integration test files across the app, the server package, and shared code; 10 end-to-end spec files containing 37 test cases (~1,240 lines).
- 32 "component" or "route" unit files that never render anything: they read `.svelte` source with the filesystem and assert on source text (`readFileSync` + regex / substring checks). They are named `*.render.test.ts`, `*.mount.test.ts`, `*.anatomy.test.ts`, and `*.contract.test.ts`, so the suite reports component coverage that does not exist.
- No real component-rendering tier exists: only 4 files opt into a simulated DOM, and no component-interaction harness is wired into the default test pipeline.
- End-to-end tests are serialized (`workers: 1`), are not marked fully parallel, define no shared authenticated/onboarded state, perform the first-run setup and onboarding journey before every test, and use fixed-duration waits in the telemetry flow.
- The default test run includes an opt-in live-provider integration file (environment-gated, so normally inert) alongside unit tests, and a separate end-to-end stack is orchestrated by hand-rolled scripts.
- The application is a static single-page app served with a separate API/server process, so there are no SvelteKit server route files in the web package; the equivalent "server boundary" is the server package's HTTP handlers, which are already exercised mostly through in-process request injection.

## Clarifications

### Session 2026-11-10

- Q: How should the suite decide whether a machine is powerful enough to run tests in parallel? → A: Detect usable CPU/RAM at run start; parallelize only above the documented threshold (fewer than 8 logical CPUs or less than 8 GiB RAM means serial or reduced parallelism), with an explicit environment override.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Trustworthy instant feedback for logic and server handlers (Priority: P1)

A developer changes a business rule, a repository query, a server handler, or a pure helper. Within seconds they get a pass/fail signal that exercises the real module boundary, without launching a browser, building the app, or starting an HTTP listener.

**Why this priority**: This is the largest share of the suite and the primary source of daily developer friction. Every minute spent booting browsers or transports for logic that can be called directly is wasted on every change, locally and in CI.

**Independent Test**: Introduce a deliberate defect in a pure helper and in a server handler; confirm both fail in the fast tier within seconds, and confirm the tier starts no browser and no network listener.

**Acceptance Scenarios**:

1. **Given** a pure business rule or data-mapping function, **When** the developer runs the fast tier, **Then** the behavior is verified in-process with no browser, no HTTP listener, and no application build.
2. **Given** a server HTTP handler (including rejection, validation, and error branches), **When** its test runs, **Then** the handler is invoked directly with a constructed request and its structured response or thrown framework result is asserted, without a real socket.
3. **Given** a test claims to verify component behavior, **When** it is reviewed, **Then** it either renders the component or is explicitly reclassified as a static-invariant check rather than a behavioral test.
4. **Given** a static invariant (dependency direction, reserved filename prefix, no forbidden API), **When** it is enforced, **Then** it is enforced by a single machine check that names the invariant, not scattered source-text greps inside component test files.

---

### User Story 2 - Real component behavior without full end-to-end cost (Priority: P2)

A developer changes component state, event handling, or reactive derivation, and verifies the actual rendered output and interaction in a real browser engine, without booting the whole application, server, and seeded database.

**Why this priority**: The current suite has no genuine component level. Either behavior is unverified, or it is pushed up into the slowest end-to-end tier. A fast component tier unlocks both correctness and speed.

**Independent Test**: Render an interactive component in isolation, drive a click and a reactive state change, assert accessible output, and confirm the run completes without the application server or a database.

**Acceptance Scenarios**:

1. **Given** an interactive component, **When** its test runs, **Then** the component is rendered in a real browser environment and queried through accessible roles or explicit test identifiers, not through source text.
2. **Given** a component that depends on navigation, environment flags, or app-wide stores, **When** it is tested in isolation, **Then** those dependencies are supplied by the harness at the module boundary rather than by booting the full app.
3. **Given** component-level tests, **When** they are placed beside the component under test, **Then** they are discoverable by convention and runnable as a single filtered tier.
4. **Given** a component test and an end-to-end test that assert the same interaction, **When** the duplication is found, **Then** the end-to-end copy is removed and the component test is the authority.

---

### User Story 3 - Lean, parallel end-to-end suite for true integration paths (Priority: P3)

A release engineer runs the end-to-end suite and gets a result in minutes, not tens of minutes. Only flows that genuinely require the browser, the real server, real streaming, and real persistence remain in this tier; authenticated/onboarded state and third-party traffic are reused and intercepted instead of replayed.

**Why this priority**: End-to-end tests are the most expensive tier and the least tolerant of duplication. Their cost multiplies across local runs, CI shards, and release verification.

**Independent Test**: Run the end-to-end suite with no prior browser state, confirm onboarding/auth is performed once per worker or once per run, confirm no fixed-duration waits exist, and confirm the suite completes within its budget while split across shards.

**Acceptance Scenarios**:

1. **Given** the end-to-end suite starts, **When** a test needs an authenticated or onboarded session, **Then** it reuses previously captured session state instead of repeating the setup journey per test.
2. **Given** a test would otherwise traverse several screens to reach its subject, **When** equivalent coverage exists at a lower tier, **Then** the end-to-end test is removed and replaced by that lower-tier coverage.
3. **Given** the end-to-end suite, **When** it is scheduled on CI, **Then** spec files are independent and can be distributed across shards with no shared mutable state, ordering dependency, or port collision.
4. **Given** a test waits for asynchronous UI, **When** it asserts readiness, **Then** it uses an auto-retrying, condition-based assertion and never a fixed sleep.
5. **Given** third-party fonts, analytics, or external network requests encountered during a test, **When** the page loads, **Then** they are intercepted or blocked deterministically, and the test never depends on their availability.

---

### User Story 4 - Enforced tier boundaries and visible budgets (Priority: P4)

A reviewer can tell which tier a new test belongs to, and CI rejects a suite that violates the tiering rules or exceeds agreed time budgets.

**Why this priority**: Without enforcement, the suite drifts back to the anti-patterns within a few feature cycles. Budgets make regressions visible before they become accepted debt.

**Independent Test**: Add a test in the wrong tier and a fixed sleep to an end-to-end spec; confirm the guardrail check fails with a message that names the rule and file.

**Acceptance Scenarios**:

1. **Given** a new test file, **When** it is added, **Then** its tier is unambiguous from its location and naming, and the tier's rules apply automatically.
2. **Given** a tier's agreed time budget, **When** CI runs the suite, **Then** per-tier duration is reported and a budget breach fails the relevant job.
3. **Given** a rule violation (browser usage in the fast tier, fixed waits, source-text component assertions, unregistered onboarding), **When** the suite is checked, **Then** the violation is reported with file and line.

---

### Edge Cases

- A static guarantee (for example "this source file must not contain a forbidden construct") is legitimate, but it must live in a clearly named invariant check rather than pretending to be a rendered-component test.
- A component test fails because a SvelteKit virtual module is unavailable outside the full app; the harness must supply the module boundary, not force the test into the end-to-end tier.
- End-to-end tests that mutate shared persisted state (settings, providers, chat graph) must isolate themselves per test and must not depend on execution order or on another spec having run first.
- The telemetry flow depends on an externally reachable stub receiver; sharding must guarantee exactly one shard owns the spec and the port, or the dependency must be removed from the end-to-end tier.
- The first-run security setup gate may be absent or already completed; session-state reuse must handle both states without falling back to per-test UI journeys.
- Live-provider integration checks must never run in the default fast tier and must fail loudly if they are accidentally selected without their environment prerequisites.
- The low-spec test profile must still run every test; tiering must change scheduling, not selection.
- Migrating a behavior test out of the end-to-end tier must preserve its coverage claim (each removed end-to-end scenario maps to a lower-tier test or is explicitly retired with a rationale).
- Real streaming and markdown/mermaid rendering may remain true end-to-end concerns; static rendering checks that do not need the real server must still move down a tier.
- Hardware detection inside containers may see host CPU counts but a cgroup memory limit (or the reverse); the gate must use the smaller/limiting signal and fall back to serial when the usable capability is unknown.
- A capable machine may be transiently loaded by other heavy processes; the gate must prefer reduced parallelism when available memory is close to the threshold rather than risk thrashing.
- An explicit override may intentionally force parallel mode on a below-threshold machine (for diagnostics), but it must be visibly reported and must not change the default path.
- A low-spec machine must still run every test; the gate may only reduce concurrency, never silently drop tier or test selection.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The suite MUST be organized into three explicit tiers: fast in-process logic/handler tests, real-browser component tests, and integrated end-to-end tests.
- **FR-002**: The fast tier MUST verify business logic, data mapping, repositories, and server request handlers by importing and invoking the production module directly, with no browser process, no application build, and no network listener.
- **FR-003**: Server-handler tests MUST assert structured responses, validation failures, and thrown framework results directly from the handler invocation; transport-level round trips are permitted only when the transport itself is the subject under test.
- **FR-004**: Component behavior MUST be verified by rendering the component in a real browser environment and asserting accessible output and interactions; asserting on component source text MUST NOT count as behavioral coverage.
- **FR-005**: Legitimate static invariants MUST be enforced by dedicated, clearly named invariant checks, and each such check MUST name the invariant and the files it governs.
- **FR-006**: Component tests MUST be colocated with their component under test and MUST use accessible-role or explicit test-identifier queries rather than class-name or markup-structure heuristics.
- **FR-007**: Component tests MUST supply navigation, environment, and store dependencies at the module boundary; they MUST NOT require the application server, the primary database, or the end-to-end stack.
- **FR-008**: End-to-end tests MUST be limited to flows that require the real browser plus the real server and persistence, including multi-page workflows, real streaming, and hydration checks.
- **FR-009**: Every end-to-end scenario that does not require that full integration MUST be migrated to the fast or component tier, and each removal MUST be traceable to its replacement coverage or an explicit retirement rationale.
- **FR-010**: End-to-end suites MUST reuse captured authenticated/onboarded session state; the setup journey MUST NOT run before every test.
- **FR-011**: End-to-end suites MUST intercept or block non-essential third-party network traffic (fonts, analytics, external asset hosts) deterministically.
- **FR-012**: End-to-end tests MUST NOT use fixed-duration waits; asynchronous readiness MUST be asserted with condition-based, auto-retrying expectations.
- **FR-013**: End-to-end spec files MUST be independently executable and distributable across parallel workers and CI shards, with no shared mutable state, ordering dependency, or port collision.
- **FR-014**: Parallel execution MUST be capability-gated: the suite MUST detect usable CPU and memory at run start, MUST parallelize only when the machine is above the documented threshold (at least 8 logical CPUs and at least 8 GiB usable RAM), and MUST fall back to serial or reduced parallelism below that threshold. An explicit environment override MUST be able to force either mode for CI or container environments. Forcing parallel mode below the threshold requires an explicit worker count.
- **FR-015**: On a capable machine, end-to-end execution MUST run with full file-level and test-level parallelism enabled; any serialization MUST be justified in a comment next to the test that requires it.
- **FR-016**: On a machine below the threshold, the suite MUST still select and run the complete test set; only concurrency may be reduced. Absent an explicit override, parallelism MUST NOT be enabled merely because a configuration flag exists when the hardware cannot sustain it.
- **FR-017**: CI sharding MUST only distribute work across runners that individually satisfy the capability threshold; a shard is not a substitute for adequate per-runner resources.
- **FR-018**: The test pipeline MUST report per-tier pass/fail and duration, and MUST enforce agreed per-tier time budgets on reference hardware.
- **FR-019**: Automated guardrails MUST reject the known anti-patterns: browser usage in the fast tier, fixed sleeps in end-to-end tests, source-text component assertions, end-to-end setup journeys outside the shared session-state mechanism, and parallelism enabled on a machine below the threshold.
- **FR-020**: Live-provider and other environment-dependent integration checks MUST be excluded from the default fast tier and MUST fail loudly when selected without their prerequisites.
- **FR-021**: The low-spec execution profile MUST continue to run the complete suite with parallelism disabled or reduced and MUST never skip tests.
- **FR-022**: Test-tier placement, commands, contribution rules, and the parallelism gate MUST be documented in the project's agent/contributor guidance so new tests land in the correct tier and the gate is understood by default.
- **FR-023**: Existing test coverage MUST be preserved or deliberately retired with a written rationale during migration; no behavior may silently lose its only test.

### Key Entities

- **Test Tier**: An execution layer with a defined environment, cost budget, allowed dependencies, and placement rules (fast logic/handler, real-browser component, integrated end-to-end).
- **Evidence Mapping**: A record linking each retired end-to-end scenario to its replacement lower-tier test or its retirement rationale.
- **Session State Fixture**: A reusable captured authentication/onboarding state shared by end-to-end tests instead of replaying the setup journey.
- **Invariant Check**: A named machine check for a static guarantee (dependency direction, naming, forbidden constructs).
- **Tier Budget**: The agreed wall-clock and failure threshold for a tier, reported by CI and enforced as a gate.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The fast logic/handler tier completes in under 60 seconds on a developer machine with 8 logical CPUs and the full suite still passes.
- **SC-002**: The real-browser component tier completes in under 2 minutes on the same reference machine.
- **SC-003**: The end-to-end tier completes in under 8 minutes on CI when distributed across at least 4 shard runners that each meet the capability threshold, down from the current serialized runtime.
- **SC-004**: Zero browser processes are started by the fast tier, verified by the tier's startup trace.
- **SC-005**: Zero fixed-duration waits remain in the end-to-end suite.
- **SC-006**: End-to-end setup/onboarding is performed at most once per worker (or once per run), not once per test; the current per-test setup drops to zero.
- **SC-007**: At least 50% of current end-to-end test cases are removed or migrated, with 100% of removals traceable to replacement coverage or a written retirement rationale.
- **SC-008**: 100% of tests that claim component behavior actually render a component; zero source-text assertions remain classified as component tests.
- **SC-009**: Every end-to-end spec file passes when run alone and when distributed across shards, with no ordering dependency.
- **SC-010**: The fast tier's final test-file count equals its recorded baseline plus only the migration-ledger `convert` and `regression` additions; the ledger reports both counts and contains no unexplained increase.
- **SC-011**: A deliberately introduced fixed sleep, browser import in the fast tier, source-text component assertion, or rejection of the capability gate is detected by the guardrail check within 10 seconds.
- **SC-012**: CI reports per-tier durations on every run and fails when a tier exceeds its agreed budget.
- **SC-013**: On a machine below the documented threshold, the suite executes 100% of tests with a single worker (or the explicitly reduced worker count), starts no more concurrent workers than the machine can sustain, and never enables full parallelism.
- **SC-014**: On a machine at or above the documented threshold, the suite enables parallelism by default; on an unknown or ambiguous hardware reading it defaults to serial.
- **SC-015**: An explicit override changes the parallelism mode and is reported in the run output; the default behavior is unchanged without it.

## Assumptions

- The existing test toolchain (the project's in-process test runner and its browser automation runner) is retained; this feature changes where and how tests execute, not the shipped application runtime.
- The web package is a static single-page app, so "server route isolation" applies to the server package's HTTP handlers rather than to SvelteKit server route files.
- The real-browser component tier is introduced with the corresponding browser provider for the existing test runner; it is a development-only dependency with no effect on the application bundle.
- Native browser engines are available in CI for the component tier; if a runner cannot provision one, the tier is marked unavailable rather than silently falling back to a simulated DOM.
- The reference machine for local budgets is an 8-logical-CPU, 8 GiB machine, which is exactly the documented parallelism threshold; the low-spec profile is measured separately and is allowed to be slower.
- The capability gate uses the project's existing low-spec boundary (fewer than 8 logical CPUs or less than 8 GiB usable RAM means low-spec) so test scheduling and the project's agent/contributor guidance cannot drift apart.
- When usable CPU or memory cannot be determined reliably (for example inside a constrained container), the gate defaults to serial execution rather than assuming capacity.
- Existing low-spec scheduling remains valid: it affects concurrency only, never which tests run.
- Some rendered-output assertions may remain at the end-to-end tier when they depend on real streaming or real provider transport; those are treated as legitimate integration concerns.
- Session-state capture is feasible for the current onboarding/security setup flow; if a flow cannot be captured deterministically, it is performed once in a setup project and shared, not repeated per test.
- The telemetry end-to-end flow may be redesigned or moved out of the sharded suite if its external stub dependency cannot be made shard-safe.
- Coverage preservation is judged by scenario intent, not by identical assertions; a migrated test may assert at a different layer.
- No shipped runtime dependency is added by this feature.
