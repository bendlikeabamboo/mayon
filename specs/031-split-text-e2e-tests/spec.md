# Feature Specification: Split Text-Generation Tests from UI E2E

**Feature Branch**: `031-split-text-e2e-tests`

**Created**: 2026-11-10

**Status**: Draft

**Input**: User description: "following `specs/025-text-first-runtime` we can now afford to separate the artifacts that tests text generation vs. the UI itself. since text generation testing is a lot faster than e2e testing, we will yield significant upsides in feedback speed for tests etc."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Text-generation behavior is proven in the fast suite (Priority: P1)

Several behaviors of chat text generation — persistence of streamed turns, classification of requests into kinds, agent tool-call rounds such as branch propagation, the offer-once rule — are today proven inside browser e2e tests that boot the entire live stack. Those behaviors live behind the repository seam and can be proven without rendering anything: seed state through the repository seam, run the logic, assert on text outcomes. After this feature, each such behavior has its home in the fast non-browser suite, proven in seconds with coverage at least equal to what the browser test asserted about it. The known browser-timing flakiness (boot-gate reloads landing mid-turn) stops being able to fail these invariants at all.

**Why this priority**: This is the core value transfer — every behavior moved out of the browser suite buys feedback speed immediately and removes flake exposure for that invariant. It stands alone: even before any inventory or gating changes, migrated behaviors get faster, more deterministic verification.

**Independent Test**: Take a migrated behavior (e.g., the persisted-rows and no-approval-ask invariants of branch propagation), deliberately break the logic in a scratch change: the fast suite fails naming the broken invariant; restore it and the same test passes — with no browser anywhere in the loop.

**Acceptance Scenarios**:

1. **Given** a behavior currently proven only by a browser test whose purpose is text-generation behavior (not rendering), **When** the split lands, **Then** an equivalent non-browser test proves the same invariant by seeding state through the repository seam and asserting on text outcomes.
2. **Given** the known timing flakiness of the live browser stack (a boot-gate hard-reload landing mid-turn), **When** a migrated invariant runs in the fast suite, **Then** its pass/fail no longer depends on that timing.
3. **Given** a migrated behavior, **When** its fast-tier test fails, **Then** the failure names the behavior and the invariant broken, not a rendered-page symptom.
4. **Given** a browser test that asserted both data invariants and rendered presentation, **When** the split lands, **Then** the data invariants are proven in the fast suite and only the presentation part remains in browser coverage.
5. **Given** the fast suite after migration, **When** it runs on a developer machine or in an agent sandbox, **Then** it reaches a verdict without booting the live stack, in a small fraction of the browser suite's duration.

---

### User Story 2 - Browser suite reduced to UI-only purpose, fully classified (Priority: P2)

After the split, every remaining browser test exists for a UI-only reason — rendering, wiring, visual behavior — and says so in the maintained browser-suite inventory. No browser test remains whose real purpose is text-generation behavior; adding one becomes a visible policy mismatch rather than an acceptable default. The inventory covers every browser spec, including the two added since the original classification pass (branch propagation and telemetry) that are currently unclassified.

**Why this priority**: This is the durable guardrail — Story 1's split rots back without a classification that keeps "what is this browser test for?" answerable at a glance and reviewable at addition time. It depends on Story 1's vocabulary, not its per-behavior mechanics, and it delivers navigation value even while migrations are still in flight.

**Independent Test**: For each remaining browser spec, its inventory entry names a UI-only purpose; planting a new behavior-proving browser test (asserting what a fast-tier test already proves) is caught as an inventory/policy mismatch in review.

**Acceptance Scenarios**:

1. **Given** the browser suite after the split, **When** the inventory is read, **Then** every spec file is classified with a stated UI-only purpose — none left unclassified, including the two currently unclassified specs.
2. **Given** a browser test containing assertions that duplicate what a fast-tier test already proves, **When** it is reviewed against the policy, **Then** it is reduced to its UI-only residue or removed.
3. **Given** a future change that adds a browser test, **When** the inventory is updated, **Then** the entry must state a UI-only purpose, and an entry that cannot state one is an explicit, reviewable mismatch rather than an acceptable default.
4. **Given** a behavior whose proof genuinely requires the live request path through the real proxy, **When** it is classified, **Then** it is kept in browser/live coverage by an explicit classification decision, not left there by default.

---

### User Story 3 - Fast feedback loop becomes the default proof cycle (Priority: P3)

Developers and implementing agents get a pass/fail verdict on text-generation behavior from the fast suite alone, in a single short command cycle, without waiting for the browser job. The browser suite — now smaller — keeps verifying UI-only wiring and visual behavior. The daily experience changes shape: behavior changes are proven in seconds-to-minutes; the browser suite is reserved for what it uniquely proves and is run less often and feared less.

**Why this priority**: This is the payoff story — the quantified speedup and flake-noise reduction in the daily loop — and it emerges from Stories 1–2 rather than being deliverable by a single change. It lands last because it needs the migrations and the classification to exist.

**Independent Test**: Time a full fast-suite run and the browser-suite run before and after on comparable hardware: behavior feedback arrives at least an order of magnitude faster than the prior e2e cycle for the same invariants, and the browser suite duration drops measurably with the removed behavior coverage.

**Acceptance Scenarios**:

1. **Given** a behavior-affecting change, **When** the fast suite runs, **Then** a verdict on all migrated invariants arrives without booting the live stack, in a small fraction of the prior browser-suite time.
2. **Given** the same change afterwards, **When** the browser suite runs, **Then** it exercises UI-only wiring — not behavior already proven in the fast tier.
3. **Given** a failing migrated invariant, **When** re-running to confirm a fix, **Then** the re-run cost is a fast-suite cycle, not a full live-stack browser cycle.

---

### Edge Cases

- **Straddling behaviors** (streaming render pacing, expound offsets, selection mapping): decisions and data consequences split to the fast tier while pixel/animation behavior legitimately stays in browser coverage — the split must not force these wholly into either tier.
- **Coverage parity**: a behavior moved out of a browser test must not silently lose an assertion the browser test made; parity is accounted per migrated behavior (moved, not dropped; fast-tier assertion exists before the browser assertion is removed).
- **Shared fixtures**: both tiers must keep asserting against the same deterministic text fixtures and markers, so an identical text change fails both tiers identically instead of the tiers diverging.
- **Genuinely live-path behaviors**: proofs that require the full request path (browser through the real proxy to a stand-in model) remain in browser/live coverage by explicit classification, not by default or oversight.
- **Residual browser flakiness**: migration removes exposure for migrated invariants, but remaining UI tests that span a model turn must still cope with the boot-gate mid-turn reload behavior.
- **Unclassified recent additions**: the branch-propagation and telemetry browser specs must be classified as part of this split, not left as inventory gaps.
- **In-flight work**: new tests written while this feature is underway land on the correct side of the split immediately — no add-then-migrate churn.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The project MUST maintain two explicitly separated test artifact tiers — a fast non-browser tier that proves text-generation behavior by seeding state through the repository seam and asserting on text outcomes, and a browser tier that verifies UI-only wiring and visual behavior.
- **FR-002**: Every browser test whose purpose is text-generation behavior (not rendering) MUST, by the end of this feature, have its behavior invariants proven by an equivalent fast-tier test, with a parity accounting that maps each moved assertion to its new home.
- **FR-003**: The browser suite MUST NOT retain assertions whose only purpose is proving behavior already covered by the fast tier; residual browser assertions MUST be UI-only.
- **FR-004**: Every browser test spec MUST be classified in the maintained inventory with a stated UI-only purpose; unclassified specs and behavior-proving purposes MUST be treated as policy mismatches.
- **FR-005**: Both tiers MUST assert against shared deterministic text fixtures (the same expected texts and markers), so identical text changes fail identically in either tier.
- **FR-006**: The fast tier MUST reach a verdict without booting the live stack — no browser, no containers — both on a developer machine and in the automated gates.
- **FR-007**: The automated gates MUST keep both tiers merge-blocking, with the fast tier serving as the primary behavior verdict.
- **FR-008**: For every invariant removed from the browser tier, an equivalent fast-tier assertion MUST exist first — coverage must never dip below its pre-split level during or after the migration.
- **FR-009**: Behaviors whose proof genuinely requires the live request path MUST be explicitly classified as such rather than migrated by assumption.
- **FR-010**: The feature MUST NOT change product runtime behavior; it reorganizes test artifacts and their classification only.

### Key Entities *(include if feature involves data)*

- **Test tier**: one of the two separated artifact groups (fast non-browser behavior tier; browser UI tier), each with a distinct purpose and run profile.
- **Behavior invariant**: a single provable statement about text-generation behavior (persisted rows, reply kind, offer-once, no-approval-ask) that lives in exactly one tier with a recorded home.
- **Parity ledger**: the per-migration accounting mapping each browser-test assertion to its fast-tier replacement, or to an explicit decision to remain in browser coverage.
- **Browser-test classification**: the inventory entry stating a browser spec's UI-only purpose.
- **Shared text fixture**: the deterministic expected-text/marker set both tiers assert against.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of browser specs are classified in the inventory with a stated UI-only purpose, including the two currently unclassified ones.
- **SC-002**: For 100% of behavior invariants previously proven only in browser tests, an equivalent fast-tier test proves the same invariant — verified via the parity ledger with zero unaccounted assertions.
- **SC-003**: A full fast-tier run completes without booting the live stack and delivers its verdict in at most one tenth of the browser suite's run duration on comparable hardware.
- **SC-004**: The browser suite contains zero behavior-only assertions duplicating fast-tier coverage, and every removed browser spec or assertion is traceable through the parity ledger.
- **SC-005**: Migrated invariants show zero occurrences of the known browser-timing flake classes (e.g., boot-gate mid-turn reload aborts) across repeated fast-tier runs, where their previous browser homes exhibited them.

## Assumptions

- The 025 text-first runtime is fully in place: the two-tier boundary, its enforcement, and the sanctioned proving path (seed state through repositories, assert on text outcomes, no browser) are established. This feature applies that policy to the existing test artifacts; it does not invent new mechanisms.
- The behaviors in scope are those currently proven by the browser suite (ten specs today); classification extends the existing browser-suite inventory, which predates two of those specs.
- Both tiers continue to run inside the existing automated gate structure; no new gate infrastructure is built.
- The deterministic text fixtures and markers used by the browser harness are reusable by the fast tier, since they are plain text contracts; how they are shared is left to planning.
- The browser story never reaches zero: UI wiring, visual behavior, and explicitly-classified live-path coverage remain in the browser tier.
- Server-package tests' absence from the automated gates is a known, separate gap and is out of scope here.
- No new runtime surface, product feature, or user-visible change ships with this feature.
