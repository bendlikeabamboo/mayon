# Feature Specification: Release hygiene for 0.10.0 (changelog, authoritative docs, fixtures, tombstones)

**Feature Branch**: `034-release-hygiene`

**Created**: 2026-11-10

**Status**: Draft

**Input**: User description: "Issue #74 (P2) — release hygiene: 0.10.0 changelog/version missing; authoritative docs and fixtures are stale. Six sub-items: (1) no 0.10.0 changelog section or version bump after four merged features; (2) authoritative architecture/seams docs are now false (projection vision gate, per-segment reasoning, mermaid render contract); (3) ideas/history-map.md tombstone deleted with two ideas vanished; (4) mock-llm README omits the 030 image kind and Google streaming route; (5) langfuse stub swallows all process faults; (6) image e2e engine-seam and e2e ledger completeness."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The 0.10.0 release contract is satisfiable (Priority: P1)

A maintainer wants to tag `v0.10.0` (through the RC cycle) the moment the release train is accepted. Today the tag cannot exist: the release pipeline rejects it because all three version manifests still read `0.9.0` and the changelog has no `## [0.10.0]` section. The four merged feature trains (027 back-propagation tool, 028 mermaid error repair, 029 micro-thoughts, 030 image generation), the test-suite split (031), the engine-aware e2e fix (PR #77), and the two already-changelogged security/finalize fixes (#69, #70) have no consolidated release record. The user (maintainer) prepares everything the pipeline checks — version manifests at the tag base, a complete dated `## [0.10.0]` section folding in the two `## [Unreleased]` entries, and a fresh empty `## [Unreleased]` above it — while the actual tagging stays a human action. Later fleet fixes that merge before the tag accumulate inside the still-open `## [0.10.0]` section instead of a second staging area.

**Why this priority**: Everything else in this issue is documentation of shipped work; this story unblocks shipping it. Without it the release pipeline fails at the `verify-version` gate no matter what else is fixed.

**Independent Test**: Run the same checks the release workflow runs (all three manifests equal `0.10.0`; `CHANGELOG.md` contains a `## [0.10.0]` section; an empty `## [Unreleased]` header sits above it). No tag exists at any point.

**Acceptance Scenarios**:

1. **Given** the three version manifests read `0.9.0` and the changelog's latest section is `[0.9.0]`, **When** the 0.10.0 preparation lands, **Then** every manifest reads `0.10.0` and `CHANGELOG.md` contains `## [0.10.0] - 2026-11-10` covering 027–031, PR #77, and the folded #69/#70 entries.
2. **Given** two fixes already carry `## [Unreleased]` → `### Fixed` entries (#69 credential/SSRF hardening, #70 assistant image replies), **When** the section is written, **Then** both entries appear under `## [0.10.0]` (Added/Fixed as appropriate) and `## [Unreleased]` remains as a fresh empty header above it.
3. **Given** further fixes (#71–#75) may merge before the human tags, **When** their branches write changelog entries, **Then** the convention documented here directs them into the still-unreleased `## [0.10.0]` section until `vX.Y.Z` is tagged, after which new work lands under `## [Unreleased]` again.
4. **Given** the release pipeline's contract job (`verify-version`), **When** its manifest-equality and changelog-section checks are replicated locally, **Then** both pass against the base version `0.10.0`.

### User Story 2 - The authoritative docs describe the shipped system (Priority: P2)

A contributor reads `docs/reference/seams.qmd` and `docs/explanation/architecture.qmd` as the authority on the system as it is today (AGENTS.md says so). Three things there are now false: the projection rules claim `assistant_message` projects as plain `assistant` text with no vision gate and no image parts (030/#70 shipped vision-gated projection where assistant images ride the wire as provider file parts, and user rows may carry image parts); the per-kind semantics claim `reasoning` is "one entry per agent-loop iteration" (029 shipped per-segment, arrival-ordered, anchored reasoning rows); and the mermaid render seam's contract result shape (`{ svg, theme, repaired }` with one deterministic repair pass) appears in neither document.

**Why this priority**: These two files are the named system-of-record; false authority misleads every future agent and contributor, and the staleness is already causing issue reports. It is the largest accuracy gap in the issue.

**Independent Test**: Every claim named above is checkable by reading the two documents against the shipped code (`src/lib/chat/projection.ts`, `src/lib/chat/kinds.ts`, `src/lib/markdown/mermaid.ts`) — each stale sentence has a replacement that names the vision gate, the part shapes, the per-segment reasoning rows, and the render contract.

**Acceptance Scenarios**:

1. **Given** `seams.qmd`'s projection rules line, **When** updated, **Then** it states that `user_message` rows may carry image parts (user image part shape), that `assistant_message` rows may carry image parts projected as provider file parts only for vision-capable targets (text-only otherwise, silently), and that this is gated by the projection options — with the excluded-kinds list unchanged.
2. **Given** `architecture.qmd`'s per-kind semantics, **When** updated, **Then** `assistant_message` documents ordered text+image parts (including image-only rows) and `reasoning` documents one row per reasoning segment, arrival-ordered with an anchored flag, with legacy per-iteration rows still readable.
3. **Given** the mermaid render seam, **When** documented, **Then** `seams.qmd` carries the render-seam contract (serialized renders; success returns `{ svg, theme, repaired: false }`; a failed render attempts exactly one deterministic repair pass returning `repaired: true`; persistent failure rejects with the underlying error; callers contain failures instead of rendering raw errors) and `architecture.qmd` references it from its markdown/UI section.
4. **Given** the #69 proxy-paragraph rewrite already merged, **When** this story completes, **Then** no other paragraph in either file contradicts shipped behavior (the already-accurate relay/proxy text is left alone).

### User Story 3 - The idea tombstone exists and no idea silently vanished (Priority: P3)

A contributor browsing `ideas/` after commit `84389bf` finds no sentinel: the "last used idea number" tombstone and two idea files (`llm-mocks.md`, `security-scan.md`) were deleted without a record, contradicting both the project convention (uncommittable idea churn goes to ignore/tombstone, never silent deletion) and the 0.9.0 changelog's own citation of the tombstone. The user restores the tombstone with the sentinel advanced to the current highest idea number, records both retirements with their dispositions (the mock-LLM idea is delivered by the shipped mock-llm fixture; the security-scan idea's open remainder lives on in the still-present vulnerability-backlog idea), and confirms no still-open idea was dropped.

**Why this priority**: It is bookkeeping with real future cost (number reuse, lost provenance) but no runtime effect; it cannot block anything.

**Independent Test**: `ideas/history-map.md` exists again, its sentinel reads the current maximum idea number, both retired ideas appear with pointers to where their content now lives, and every remaining `ideas/` entry is accounted for.

**Acceptance Scenarios**:

1. **Given** `ideas/history-map.md` was deleted, **When** restored, **Then** it again carries the "last used idea number — do not reuse" sentinel, updated to the highest idea number present (013).
2. **Given** `llm-mocks.md` and `security-scan.md` vanished, **When** their retirements are recorded, **Then** the tombstone (or its equivalent record) names each with its disposition: mock-llm delivered by the mock-llm fixture work; security-scan partially delivered with its open remainder explicitly re-homed to the surviving backlog idea.
3. **Given** the project rule that idea churn is recorded rather than silent, **When** a future idea is retired, **Then** the restored tombstone is the place the retirement is written.

### User Story 4 - The mock-LLM README documents every dispatch mode (Priority: P3)

An engineer extending the e2e suite reads `tests/fixtures/mock-llm/README.md` as the fixture's source of truth (it is also the guardrail document named by the 030 research). The 030 image-reply dispatch exists there only as a one-liner: the README does not say the request classifier learned the `image_reply` kind, that Google-dialect requests never hit the OpenAI completions route (they stream via the `:streamGenerateContent` route), what the two wire shapes are (OpenAI-style `delta.images[]` data-URL frames vs Google-style `inlineData` candidate parts), or that image frames are deliberately paced slower than the standard cadence so the live caption is observable in CI.

**Why this priority**: The gap misleads the next fixture consumer, but the fixture itself works and is fully specified in the feature specs; only the README summary lags.

**Independent Test**: Reading the README alone is sufficient to know how to trigger an image reply, which route each provider dialect takes, what bytes come back on each, and why the pacing differs — without opening `server.mjs`.

**Acceptance Scenarios**:

1. **Given** the 030 dispatch bullet exists but names neither the classification kind nor the routes, **When** extended, **Then** it documents the `image_reply` request-kind classification and that Google requests are served on the streaming generate-content route (never the OpenAI completions path).
2. **Given** the two dialects return different shapes, **When** documented, **Then** the README names both wire shapes (the `delta.images[]` data-URL frame shape and the `inlineData` candidate-part shape) and notes the SDK-compat reason the OpenAI shape is chosen.
3. **Given** image frames are paced slower than the standard 150 ms cadence, **When** documented, **Then** the README states the pacing and its purpose (live-caption observability in CI).

### User Story 5 - The telemetry stub fails loudly on genuine faults (Priority: P3)

An engineer debugging telemetry e2e flakes finds the langfuse stub has process-wide `uncaughtException`/`unhandledRejection` handlers that only log. A fault mid-handler can leave the stub serving with partially-mutated state, so later specs assert stale data instead of surfacing the defect. The user moves fault handling to where faults occur (aborted or malformed bodies are answered 400 at the route, writes to dead sockets are guarded) and removes the process-level handlers, so genuine defects crash loudly while aborted client bodies stay non-fatal for the deck.

**Why this priority**: It hardens a test fixture; nothing in production depends on it, but a silently-swallowing stub can invalidate future e2e results.

**Independent Test**: With the process handlers removed, a malformed JSON body is answered 400, an aborted in-flight body neither crashes the stub nor corrupts the received log, the assertion/reset surfaces keep working, and a genuine unhandled fault terminates the process.

**Acceptance Scenarios**:

1. **Given** the stub installs process-wide swallow handlers, **When** the fixture is fixed, **Then** no process-level `uncaughtException`/`unhandledRejection` handler remains in the fixture.
2. **Given** a client aborts mid-request-body, **When** the abort lands, **Then** the request path settles the body read locally (400 answer when the socket is still writable, no write to a dead socket) and the stub process survives — the original flake does not return.
3. **Given** a genuine unexpected fault, **When** nothing swallows it, **Then** the stub process exits loudly (visible in deck output) instead of continuing with mutated state.

### User Story 6 - The image e2e and its ledger are engine-agnostic and complete (Priority: P3)

A contributor running the e2e suite with Podman (or Docker) wants the image round-trip spec to work through the shared engine seam and wants the e2e README's parity ledger to account for every spec file. On current main both are already true: the spec resolves the container engine through the shared dev-compose seam, and the ledger carries a row for every spec including the back-propagation one. This story verifies that state (rather than re-fixing it) so the issue's acceptance bullet can be closed with evidence, and ensures the engine-seam fix is represented in the 0.10.0 changelog (via User Story 1).

**Why this priority**: The work appears already done on main; the remaining value is verification and the changelog record, both cheap.

**Independent Test**: The spec file contains no hardcoded `docker` binary invocation (engine resolved from the shared seam), and the ledger table has exactly one row per spec file in `tests/e2e/`.

**Acceptance Scenarios**:

1. **Given** `image-round-trip.spec.ts` historically hardcoded `docker compose`, **When** verified, **Then** it invokes the container engine through the shared resolver (honoring the dev-engine environment variable) with no remaining hardcoded engine binary.
2. **Given** the ledger historically omitted the back-propagation spec, **When** verified, **Then** the README inventory table contains a row for every `tests/e2e/*.spec.ts` file (count matches), including `backprop-tool.spec.ts`.

### Edge Cases

- **A fleet fix merges after this change but before the tag**: its changelog entry lands inside the still-open `## [0.10.0]` section (Assumption 2); nothing here is invalidated.
- **An `## [Unreleased]` entry appears between this change and the RC tag**: it belongs to 0.10.0 by definition and must be folded before tagging; the documented convention says so.
- **Verification (US6) uncovers real drift** (e.g., a new spec file without a ledger row): the drift is corrected in-scope as a minimal fix, not deferred.
- **An idea directory is retired concurrently**: the restored tombstone is updated in the same change that removes the directory — no silent deletions.
- **The stub change regresses the original telemetry e2e flake**: the abort path must keep the stub alive without process handlers; if standalone probes cannot prove it, the e2e evidence is gathered by the maintainer on the dev stack (not by this effort).

---

## Requirements *(mandatory)*

### Functional Requirements

**FR-001**: All three version manifests (`package.json`, `server/package.json`, `packages/shared/package.json`) read `0.10.0`.

**FR-002**: `CHANGELOG.md` contains a `## [0.10.0] - 2026-11-10` section (RC-preparation date convention) that covers feature trains 027 (back-propagation tool), 028 (mermaid error repair), 029 (micro-thoughts), 030 (image generation), 031 (test-suite split / per-shard e2e), the engine-aware e2e fix (PR #77), and folds the existing `## [Unreleased]` entries for #69 and #70 into it.

**FR-003**: A fresh, empty `## [Unreleased]` header remains directly above `## [0.10.0]`.

**FR-004**: No git tag is created, pushed, or otherwise prepared by this work; tagging remains a maintainer action (documented in the plan/tasks).

**FR-005**: `docs/reference/seams.qmd`'s context-projection rules describe user image parts, the assistant vision gate, and assistant provider-file-part projection accurately per the shipped `projection.ts`.

**FR-006**: `docs/explanation/architecture.qmd`'s per-kind semantics describe `assistant_message` (ordered text+image parts, image-only rows, segmented rendering) and `reasoning` (per-segment, arrival-ordered, anchored; legacy per-iteration rows still readable) accurately, and its projection table rows match.

**FR-007**: The mermaid render-seam contract — serialized rendering, the `{ svg, theme, repaired }` result shape, exactly one deterministic repair pass, rejection with the underlying error on persistent failure, and failure containment at the caller — is documented in `docs/reference/seams.qmd` and referenced from the markdown pipeline discussion in `docs/explanation/architecture.qmd`.

**FR-008**: `ideas/history-map.md` is restored as the idea tombstone with the sentinel set to the highest used idea number (013) and records the retirements of the mock-LLM idea (delivered) and the security-scan idea (open remainder re-homed to the surviving backlog idea).

**FR-009**: No still-open idea file is deleted; every remaining `ideas/` entry is accounted for.

**FR-010**: `tests/fixtures/mock-llm/README.md` documents the 030 image dispatch fully: the `image_reply` classification, the route split (OpenAI completions vs Google `:streamGenerateContent`), both wire shapes (`delta.images[]` data URL; `inlineData`), and the deliberate slower image-frame pacing with its CI rationale.

**FR-011**: `tests/fixtures/langfuse-stub/server.mjs` contains no process-wide swallow handlers; aborted/malformed bodies are handled at the request path (400 when writable, never writing to a dead socket), and the abort-resilience behavior that motivated the original handlers is preserved.

**FR-012**: The engine-resolved image e2e and the complete ledger state are verified with evidence (no code change expected); any drift found is corrected.

## Success Criteria *(mandatory)*

### Measurable Outcomes

1. The release workflow's `verify-version` checks (manifest equality + changelog section presence) pass when replicated locally against base `0.10.0`.
2. Every sentence flagged stale in issue #74 item 2 has a verified replacement in the authoritative docs; no new inaccuracy is introduced.
3. `git status` shows no deleted file under `ideas/` after the change, and the tombstone's sentinel equals the highest idea directory number.
4. A reader of the mock-LLM README can trigger and parse an image reply without reading the server source.
5. The langfuse stub, run standalone, answers malformed JSON with 400, survives an aborted body without process handlers, and exits on a genuine fault.
6. The e2e ledger row count equals the spec file count.

### Key Entities

- Release artifacts: version manifests (×3), `CHANGELOG.md` (`## [Unreleased]`, `## [0.10.0]`).
- Authoritative docs: `docs/reference/seams.qmd` (projection rules, presentation seams), `docs/explanation/architecture.qmd` (entry-kind model, per-kind semantics, context projection, UI/markdown pipeline).
- Idea registry: `ideas/history-map.md` sentinel + retirement records; surviving idea files.
- Test fixtures: `tests/fixtures/mock-llm/` (README, server, strings), `tests/fixtures/langfuse-stub/server.mjs`.
- E2e artifacts: `tests/e2e/image-round-trip.spec.ts`, `tests/e2e/README.md` ledger.

## Assumptions

1. **Changelog date convention**: the section date is the RC-preparation date (the day the section is authored), matching the 0.9.0 precedent (section authored 2026-11-03 with the RC; stable tag followed on 2026-11-08). Concrete date chosen: **2026-11-10**.
2. **Where #71–#75 land**: until `v0.10.0` (stable) is tagged, further fleet fixes append entries directly inside the still-unreleased `## [0.10.0]` section; `## [Unreleased]` stays empty above it. After tagging, new work returns to `## [Unreleased]`. This is documented in the plan and tasks.
3. **Version bumps happen now** (this change is the RC preparation, minus tagging): all three manifests go to `0.10.0`, so the later RC tag needs no further file edits, consistent with the RC iterate step in AGENTS.md.
4. **No vite/rolldown entry**: no dependency or toolchain change touching vite/rolldown exists in the `v0.9.0..HEAD` delta (vite has been `^8.1.6` since before 0.8.2, zero manifest/lockfile churn since v0.9.0); the issue's parenthetical is treated as stale and no such entry is written. Residual noted in Open Questions.
5. **Tombstone mechanism**: restore `ideas/history-map.md` (the mechanism the project already used) rather than inventing a new `docs/history/` record; the retirement records live in the restored file.
6. **security-scan disposition**: delivered in part by the shipped security-posture detection history and the relay hardening; its open remainder (vulnerability backlog triage) already lives in `ideas/dependency-vulnerability-backlog.md`, so the retirement record points there rather than resurrecting the file.
7. **Item 6 is verify-only**: both halves (engine seam, ledger row) are already fixed on main; this feature verifies and evidences them, and covers the engine fix in the changelog, but expects no code/doc edit beyond what verification uncovers.
8. **Prettier scope**: `CHANGELOG.md`, `ideas/`, and `tests/e2e/README.md` are Prettier-covered (must pass `prettier --check`); `docs/`, `specs/`, `tests/fixtures/` are ignored (style-match only).
9. **Stub verification is manual/standalone** (the fixture has no unit harness and e2e requires the Docker/Podman stack, which this effort does not start): the stub is exercised standalone with curl-style probes.

## Open Questions

1. The issue's "(and the vite/rolldown change)" changelog item has no corresponding change in `v0.9.0..HEAD`. If the maintainer knows of one outside this branch's view, the `## [0.10.0]` section should gain that entry before the RC tag — flagged for the maintainer, not blocking.
2. Should the restored idea tombstone also note the numbering gap (no idea 011 ever existed)? Assumed yes as a one-line aside; harmless to drop.

## Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-11-10 | Draft | Initial specification from issue #74 | Leader agent (issue #74) |
