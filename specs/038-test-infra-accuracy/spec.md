# Feature Specification: Test-infrastructure accuracy fixes

**Feature Branch**: `fix/issue-75-test-infra`

**Created**: 2026-11-11

**Status**: Draft

**Input**: User description: "test infrastructure: shard-log selection can cross projects, drift guard coverage gaps, missing no-toast assertions, discovery-merge parity reimplemented, no CI cache + unbalanced shards, artifacts claim no CI edits (GitHub issue #75, P4 — test-infra accuracy only, no product regressions claimed)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A sharded e2e run reads only its own stack's logs (Priority: P1)

When the e2e deck runs sharded (`pnpm dev:shard:up`/`:test`, one dev stack per
shard), a spec that counts the mock LLM's logged requests must read the logs of
the compose project its own runner targets. Today the spec that scrapes mock
logs picks the FIRST running compose project that mounts the shared base dev
compose file — so with sibling shard stacks (or a local dev stack) running side
by side, it can count a sibling's requests and pass or fail on the wrong
stack's behavior.

**Why this priority**: A test that grades the wrong subject is worse than no
test — it can green-light real regressions and red-flag healthy code; every
other accuracy fix assumes the e2e tier observes the system it drives.

**Independent Test**: With two shard stacks (and optionally the base dev stack)
running concurrently, the log-scraping spec must resolve the project whose web
port matches the runner's target base URL, and must refuse to run (clear error)
when that project is not running.

**Acceptance Scenarios**:

1. **Given** shard 1 and shard 2 stacks running side by side, **When** the
   shard-2 runner's spec resolves its compose project, **Then** it selects the
   shard-2 project (never shard 1's, never the base dev stack's), regardless of
   ordering in the compose project listing.
2. **Given** only the base dev stack running, **When** an unsharded e2e run
   resolves its project, **Then** it selects the base dev project.
3. **Given** no running project matching the target base URL, **When** the spec
   resolves its project, **Then** it fails immediately with an error naming the
   expected project and how to start it — never silently falling back to a
   sibling.
4. **Given** a project with the expected name but not mounting this checkout's
   compose files, **When** resolution runs, **Then** it fails loudly (name
   collision is treated as misconfiguration, not a match).

---

### User Story 2 - The fixture drift guard patrols every mirror (Priority: P1)

The mock LLM's fixture-only assertion strings live once in a shared fixture
module, and several fast-tier suites re-type some of those values at their use
sites (deliberately, for local readability). Today the drift guard patrols only
two files (the mock server and the e2e kitchen-sink re-export); the other
mirrors are unpatrolled, so a fixture string renamed in the shared module
without updating a mirror (or vice versa) drifts silently until a far-away e2e
or store test fails for a confusing reason.

**Why this priority**: Same class as US1 — an unpatrolled mirror is a silent
accuracy hole in exactly the tests that are supposed to prove string-sensitive
behavior.

**Independent Test**: For every known mirror site, flipping the mirrored value
(to any divergence from the shared fixture constant) makes the guard fail,
naming the mirror file and the shared constant; with all mirrors in sync the
guard passes.

**Acceptance Scenarios**:

1. **Given** the shared fixture module renames a trigger string, **When** a
   mirror file still carries the old value, **Then** the drift guard fails and
   names both files.
2. **Given** a mirror file retypes a value that diverges from the shared
   constant, **When** the guard runs, **Then** it fails (one implementation of
   containment catches both drift directions).
3. **Given** a new mirror is introduced later, **When** the guard's mirror
   registry is not updated, **Then** the registry's own doc comment and guard
   failure messages make the omission discoverable (single registry lists every
   patrolled file).
4. **Given** all mirrors byte-match their constants, **When** the guard runs,
   **Then** it passes.

---

### User Story 3 - Toast-absence assertions exist for declined and latched propagation (Priority: P2)

The back-propagation journey must never report success it did not earn: a
declined propagation approval and a second propagation refused because one is
already in flight must both stay toast-free. The product behavior exists (a
prior feature hardened it), but no test asserts the absence — the e2e backprop
spec never checks for toasts, and the toast store's own suite has no negative
assertions — so a regression that reintroduces a false success toast would not
be caught by a failing assertion.

**Why this priority**: The product guarantee is only as durable as the
assertion that pins it; this is the accuracy gap most likely to mask a user-facing
lie.

**Independent Test**: Drive a declined propagation turn and a latch-refused
second propagation attempt; assert the toast collection stays empty throughout
(and the success record stays unset), at the store level — runnable without
containers — plus an e2e-level absence sweep that is maintainer-verifiable on a
dev stack.

**Acceptance Scenarios**:

1. **Given** a propagation approval that the learner declines, **When** the
   turn completes, **Then** no toast of any kind was emitted for the declined
   attempt.
2. **Given** one propagation in flight, **When** a second attempt is refused by
   the in-flight latch, **Then** no success toast is emitted for the refused
   attempt and no second artifact lands in the parent.
3. **Given** the toast store's suite, **When** negative paths run (no push from
   no-op interactions; dismissing a toast never spawns another), **Then** the
   assertions pass without any container runtime.
4. **Given** the e2e backprop suite on a running dev stack, **When** the
   decline journey and the approval journey settle, **Then** the toast layer is
   asserted absent/present respectively.

---

### User Story 4 - One implementation of the discovery-merge rule (Priority: P2)

When a provider's live model catalog is discovered, the discovered IDs merge
ahead of the stored manual additions (deduplicated, stored order preserved for
the rest). Today that merge formula is written three times — twice in the
settings UI component and once re-implemented in the connection-test suite —
so a change to the formula can diverge silently between the UI paths and the
tested path.

**Why this priority**: The tested behavior and the shipped behavior must be the
same code; a parity suite that re-implements the rule proves nothing about the
rule it claims to test.

**Independent Test**: A single shared merge helper is consumed by both UI call
sites and the test; unit tests pin the ordering/dedupe semantics directly.

**Acceptance Scenarios**:

1. **Given** discovered IDs `[b, a]` and stored models `[manual, a]`, **When**
   the merge runs, **Then** the result is `[b, a, manual]` (discovered order
   first, deduped, manual additions preserved at the end).
2. **Given** the settings UI's two discovery paths (background refresh and
   explicit test-connection), **When** either merges a catalog, **Then** both
   call the same shared helper.
3. **Given** the connection-test suite's persisted-settings merge check,
   **When** it builds the merged list, **Then** it calls the same shared helper
   instead of re-implementing the formula.
4. **Given** an empty discovery result, **When** the merge runs, **Then** the
   stored list is returned unchanged.

---

### User Story 5 - CI caches image builds and shards are balanced (Priority: P3)

The e2e CI job builds the dev images per shard with no build cache (dependency
caching already exists), and the two-shard split assigns tests 21 vs 12 — the
second shard idles while the first gates the pipeline. CI should reuse image
build layers between runs and the shards should carry roughly equal loads.

**Why this priority**: Pure velocity/efficiency; accuracy of results is
unaffected.

**Independent Test**: The workflow builds the dev images through a cache-backed
builder (validated by workflow syntax/lint plus reasoning — CI itself is
maintainer-verified), and a local, container-free listing of the shard split
shows each shard within one test of half the deck.

**Acceptance Scenarios**:

1. **Given** an e2e CI run, **When** it builds the dev images, **Then** layers
   are exported to and restored from the runner's actions cache (same cache
   scope across shards and reruns).
2. **Given** the ten-file e2e deck, **When** shards are assigned, **Then** the
   split is at most 18/15 (33 tests total), verified by the container-free test
   listing.
3. **Given** the workflow edit, **When** it is validated locally, **Then** the
   YAML is well-formed under the repository's formatter/linter and the change
   is commented for maintainers.

---

### User Story 6 - Feature-031 artifacts stop claiming CI was never edited (Priority: P3)

The feature-031 specification artifacts (plan, research, tasks) state that the
CI workflow was verified-but-not-edited. That was true when 031 landed; once
this feature edits the workflow, those claims read as contradictions. The
historical record should stay truthful without rewriting history.

**Why this priority**: Documentation accuracy for future maintainers reading
the spec tree; cheap once the CI edit exists.

**Independent Test**: Each of the three artifacts carries a dated addendum
noting the later CI edit and cross-referencing this feature; the original
decision text remains intact above it.

**Acceptance Scenarios**:

1. **Given** this feature's CI edit has landed, **When** a maintainer reads
   feature-031's plan/research/tasks "no CI edits" claims, **Then** each is
   followed by a dated addendum pointing at this feature's CI change.
2. **Given** the addenda, **When** the original 031 decision text is read,
   **Then** it is unchanged (history is annotated, not rewritten).

---

### User Story 7 - Reload parity covers every AI SDK entry point used on load (Priority: P3)

Re-hydrating a chat from the database (the `load()` a reload or chat switch
performs) must issue zero provider requests. The existing parity test pins only
the streaming entry point; the object- and text-generation entry points are
unpinned, so a regression that fires one of them during hydration would go
uncaught.

**Why this priority**: Completes an existing invariant's proof matrix with the
same test pattern; lowest risk in the deck.

**Independent Test**: After a turn that exercised the streaming entry point
(and whatever generation paths the turn used), a reload changes none of the
three AI SDK entry-point call counters.

**Acceptance Scenarios**:

1. **Given** a chat with a completed image-reply turn, **When** the chat is
   reloaded, **Then** the streaming entry-point call count is unchanged (the
   existing pin) AND the object-generation and text-generation entry-point call
   counts are unchanged.
2. **Given** the hydration path, **When** any provider request is attempted,
   **Then** the parity assertions fail (the pin is total, not per-entry-point
   optional).

---

### Edge Cases

- Compose project listing returns entries for stacks from a different checkout
  (same file names, different absolute paths) — resolution must key on this
  checkout's absolute compose file paths plus the expected project name, never
  on file name alone.
- A podman engine resolves projects identically (project listing shape is the
  same across engines).
- Mirror sites that mention a fixture value incidentally (e.g. inside an
  adversarial-prompt payload exercising the marker) are not drift mirrors — the
  registry is an explicit allow-list, not a repo-wide scan.
- Empty discovery catalogs and duplicate manual entries in the merge.
- The e2e toast-absence selector must not match non-toast "Dismiss" controls on
  the page (toast dismissal is labeled, not textual).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The mock-log scraping e2e MUST resolve its compose project by the
  project name derived from the runner's target base URL (default dev stack for
  the default port; shard-N stack for shard ports), verified against this
  checkout's compose files, and MUST fail with a actionable error when no such
  project runs.
- **FR-002**: The project-resolution logic MUST be a pure function exercised by
  fast-tier unit tests (no container runtime needed) covering: sibling shards
  running concurrently, base stack only, missing project, and name-collision
  misconfiguration.
- **FR-003**: The drift guard MUST patrol every registered mirror of the shared
  fixture strings: each registry entry asserts the mirror's source contains the
  byte-exact shared constant values it mirrors, so divergence in either
  direction fails the guard with a message naming both files.
- **FR-004**: The mirror registry MUST be a single explicit list (one place to
  add the next mirror), documented at the guard and at the fixture module.
- **FR-005**: Fast-tier assertions MUST prove the declined-propagation turn and
  the latch-refused second propagation emit zero toasts (observing the toast
  collection), and the toast store's suite MUST include negative assertions.
- **FR-006**: The e2e backprop suite MUST include toast-absence sweeps for the
  declined journey and toast hygiene for the approval journey, written to run
  (never skipped) and documented as requiring a dev stack.
- **FR-007**: The discovery-merge rule MUST exist as one shared, unit-tested
  helper; both settings-UI call sites and the connection-test suite MUST
  consume it (no re-implementation anywhere).
- **FR-008**: The e2e CI workflow MUST build the dev images through a
  cache-backed builder that exports and restores layer cache via the runner's
  actions cache, and the workflow edit MUST be validated locally (format/lint)
  with the CI run itself maintainer-verified.
- **FR-009**: The e2e shard split MUST balance to at most 18/15 across the two
  shards (verified by the container-free test listing), and any spec-file
  change MUST keep the e2e inventory ledger complete (one classified row per
  spec file) in the same change.
- **FR-010**: Each feature-031 artifact claiming CI was not edited MUST carry a
  dated addendum cross-referencing this feature's CI change, leaving the
  original text intact.
- **FR-011**: The reload-parity test MUST pin all three AI SDK entry points
  (streaming, object-generation, text-generation) across hydration.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With multiple dev stacks running, the mock-log spec provably
  reads only the targeted stack's logs (unit-proven selection; e2e verified on
  a dev stack by a maintainer).
- **SC-002**: Diverging any registered mirror from its shared constant fails
  exactly one named guard assertion; zero divergences passes.
- **SC-003**: A regression that toasts on a declined or latch-refused
  propagation turns a green suite red (mutation-verified).
- **SC-004**: Exactly one implementation of the discovery merge exists in the
  codebase; the parity test and both UI paths call it.
- **SC-005**: The e2e workflow's image builds are cache-backed and the shard
  split is ≤18/15 by the container-free listing.
- **SC-006**: All three feature-031 artifacts carry the cross-referencing
  addendum.
- **SC-007**: A hydration that fires any of the three AI SDK entry points fails
  the reload-parity test (mutation-verified).

## Assumptions

- "Dismiss click" in the issue maps to the current UI's decline/decision
  controls and the toast layer's own dismissal; the invariant under test is
  "no unearned success toast", asserted at the store level (authoritative,
  container-free) plus e2e sweeps (maintainer-verified). No toast-copy or
  toast-behavior product change is in scope.
- The issue's "no `pnpm` cache in CI" claim is already resolved on the current
  tree (both CI jobs configure dependency caching); this feature's CI scope is
  therefore image-build caching plus shard balancing only.
- Shard balancing is achieved by how spec files are cut (whole files are the
  shard unit), without changing what any test asserts; the container-free
  shard listing is the acceptance oracle.
- Mirrors stay duplicated-at-use-site (house pattern for local readability);
  the guard patrols them rather than forcing imports — converting mirrors to
  imports is a rejected alternative (churn in three suites, different failure
  ergonomics), recorded in research.
- The 031 artifact updates are addenda, not rewrites: the original claims were
  true when made.
- The fleet's implementer tier cannot run Docker/Playwright; every
  Docker-gated assertion ships with a container-free proof path (unit tier) and
  is written to run — never skipped — with the stack requirement documented.
- CI edits cannot be executed by the fleet; validation is local (formatter/
  linter on the workflow) plus reasoning, with the next real CI run as the
  maintainer's verification.
