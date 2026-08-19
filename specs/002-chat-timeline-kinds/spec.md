# Feature Specification: Chat Timeline Kind Model

**Feature Branch**: `002-chat-timeline-kinds`

**Created**: 2026-08-19

**Status**: Draft

**Input**: User description: "Replace the chat timeline's implied content model (nullable `role`/`toolCallId`/`toolName`/`metadata` column combos) with an explicit model: one durable `kind` per timeline event, three presentation lanes (user / internal / external) derived from kind, a single kind→presentation registry for all rendering (live and persisted), durable permission/sampling/elicitation/choice outcomes that survive reload, per-iteration reasoning attribution, an explicit entries→provider-context projection with golden tests, and a single-table evolution of `messages` with a backfill migration. Open questions to resolve: final kind enumeration (incl. `self_corrected`), naming (`kind` vs `event`, `entries` vs `timeline_items`), tool_call/tool_result visual pairing, fate of the `role` column, collapse-state persistence, approval write-back semantics under truncate-based restore, and migration edge cases."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Uniform, readable tool activity in the timeline (Priority: P1)

As a learner using Mayon, when the assistant uses tools during a turn, I want each tool activity to appear as a compact, quiet internal line whose structured detail I can optionally expand, and I want every timeline item to look and behave consistently, so a tool-heavy turn is no longer an unreadable wall of text and the timeline feels like one system instead of twelve special cases.

**Why this priority**: This is the foundation slice. It establishes the entry-kind model and the single kind→presentation registry that every later story builds on, and it delivers the most visible user-facing fix (the tool-result wall of text). It is independently shippable: kinds can initially be derived on the fly from the existing stored columns, so old chats render through the new presentation without any data change.

**Independent Test**: Open a pre-existing chat containing tool calls and tool results (including ones with structured detail already stored). Every item renders through the new presentation; tool results show a compact header (tool name, ok/fail) plus a one-line summary with detail collapsed by default and expandable on demand.

**Acceptance Scenarios**:

1. **Given** a past chat whose stored rows encode a tool call and its tool result (including structured result detail), **When** the chat is opened, **Then** the pair renders as one grouped internal-lane unit — tool name and ok/fail status in a header, a one-line summary, and structured detail that is collapsed by default and expands on request.
2. **Given** any timeline item, **When** it is rendered, **Then** its lane (which side, bubble styling, quiet vs foreground), collapsibility, and default collapse state come solely from its kind via the presentation registry — presentation is never stored per row.
3. **Given** an old chat containing rows that previously rendered as blank or hidden special cases (empty tool-call bookkeeping rows, presentation-only choice rows, hidden rows), **When** rendered after this story, **Then** each maps to a well-defined kind or a deliberate registry-level hide rule — no blank rows, no broken rows, no special-case branches outside the registry.

---

### User Story 2 - Honest history that survives reload (Priority: P2)

As a learner who approved or denied a permission request, answered an MCP server's question, or picked a choice chip, when I reload the page or come back a month later, I want the conversation to show exactly what was asked and what I decided — including the options I was offered and which one I took, and the assistant's per-iteration thinking attributed to the right iteration — so the history is a trustworthy, auditable record of what actually happened.

**Why this priority**: Durability of decisions is the biggest honesty gap after the wall of text: today permission prompts, sampling asks, elicitations, and chip selections vanish on reload, and reasoning from all iterations is glued onto the final reply. This story depends on Story 1's kind model but delivers value on its own as soon as new turns are recorded with the new kinds.

**Independent Test**: Run a turn that triggers a permission ask (approve it), a choice offer (tap a chip), and multi-iteration reasoning; reload the page. All three remain visible with their outcomes/attribution intact.

**Acceptance Scenarios**:

1. **Given** a permission ask that the user approved or declined, **When** the page is reloaded, **Then** the timeline shows the ask and its resolved outcome on the same entry (internal lane, quiet, collapsed by default).
2. **Given** a choice offer the model presented, **When** reloaded, **Then** the timeline shows the options that were offered and which one was taken, with the taken choice visible as the user's reply linked back to the offer.
3. **Given** a turn with multiple reasoning iterations (text → tool call → more reasoning → final text), **When** reloaded, **Then** reasoning appears as its own internal entries — one per iteration, attributed to that iteration — and the final assistant text contains no glued-in reasoning from earlier iterations.
4. **Given** a permission/sampling/elicitation ask that was still pending when the page was closed, **When** reloaded, **Then** the entry renders as an ask with no decision recorded (clearly marked as undecided/expired) — it does not render as an interactive live card and does not claim an outcome.

---

### User Story 3 - Provider context as a faithful projection of the same entries (Priority: P3)

As the product owner of Mayon, I want the context sent to the model to be derived by one explicit, heavily-tested projection from the same entry kinds the user sees, so that what the user sees and what the model receives can't silently diverge, and so changes to the timeline model are caught by tests instead of by users.

**Why this priority**: Context assembly currently re-guesses provider intent from the same ambiguous column combinations the UI guesses from; unifying removes a whole class of divergence bugs. It depends on Story 2's durable kinds and is the riskiest change to existing behavior, so it ships behind golden-equivalence tests.

**Independent Test**: For a corpus of pre-existing chats, capture the provider-visible context before the rewrite; after the rewrite, the projection reproduces it exactly.

**Acceptance Scenarios**:

1. **Given** pre-existing chats with tool calls, tool results, choices, and hidden rows, **When** context is assembled through the new projection, **Then** the provider-visible message sequence is identical (golden-test equivalence) to what the current assembly produced for those same chats.
2. **Given** an entry kind that must not reach the provider (e.g., an approval record or a self-correction note), **When** context is assembled, **Then** it is excluded or represented per its projection rule — never silently leaked as an extra turn.

---

### User Story 4 - Live and persisted output share one presentation (Priority: P4)

As a learner watching a reply stream in, I want the live reasoning and live text to appear exactly where and how their persisted versions will, so nothing jumps, restyles, or re-flows when the turn finishes and the entries are saved.

**Why this priority**: The duplicated live-streaming presentation is a maintainability and consistency liability, but it is a pure unification once Stories 1–2 exist; deferring it costs nothing user-facing beyond transient restyle on completion.

**Independent Test**: Watch a streaming turn that includes reasoning and text; when the turn completes, the entries replace the live counterparts in place without visual discontinuity, and the duplicated streaming markup no longer exists.

**Acceptance Scenarios**:

1. **Given** a turn currently streaming reasoning and text, **When** rendered, **Then** each live element (streaming reasoning, streaming text, pending interactive ask) flows through the same lane/renderer registry as its durable counterpart.
2. **Given** the completed turn, **When** its durable entries are persisted and the live elements are removed, **Then** position, styling, and content are continuous — the user perceives no swap.

---

### User Story 5 - Auditable self-correction (Priority: P5)

As a learner reviewing (or auditing) a completed reply, when the assistant's internal critic found issues and corrected the draft before showing it to me, I want a quiet internal entry recording that a correction pass occurred and what it fixed, so the final text's provenance is honest.

**Why this priority**: The critic phase exists today but silently rewrites the draft in memory; recording it is honest-history polish. It is fully independent — a single additional internal kind — and may be deferred without affecting any other story.

**Independent Test**: Trigger a turn whose draft fails validation and gets corrected; after completion and reload, an internal entry records the correction pass (issues found, attempt count), and the final text is unchanged in appearance.

**Acceptance Scenarios**:

1. **Given** a turn where the critic detected issues and re-generated the draft, **When** the turn completes and the page is reloaded, **Then** an internal-lane entry records that a self-correction pass occurred, with the issues found and the number of correction attempts.
2. **Given** a turn with no critic issues, **When** completed, **Then** no self-correction entry is recorded.

---

### Edge Cases

- **Unresolved asks at reload**: a permission/sampling/elicitation entry persisted without an outcome renders as undecided/expired — never as a live interactive card, never claiming approval (Story 2, scenario 4).
- **Interrupted turns**: a tool-call entry with no matching tool-result entry (turn aborted mid-flight) renders as an incomplete pair visibly marked "no result recorded"; the interrupted flag remains decoration on the affected assistant entry.
- **Migration edge cases** (backfill must classify all of these, none may be dropped or left unclassified): hidden rows (stored hidden flag); legacy choice-offer rows (assistant tool-call rows and their presentation-only tool-result rows); empty tool-call bookkeeping rows (tool-call rows with no text); assistant rows carrying reasoning inside their stored metadata (pre-split legacy format); tool rows with missing tool names.
- **Old backups on the new schema**: restoring a backup stamped with an older schema version must run the same backfill path during restore's migration step; restoring a backup stamped newer than the running server continues to be refused (existing behavior, unchanged).
- **Referential integrity across migration**: branch points, branch sources, and highlight/expound offsets reference existing user/assistant entry IDs — all IDs must be preserved unchanged by the migration, and pre-migration chats must render and branch identically afterwards.
- **Search pollution**: new internal entries (reasoning, approvals, offers, corrections) are conversational bookkeeping, not content — full-text search results must continue to surface only user and assistant message content, without any write to the self-maintaining search columns.
- **Concurrency with restore**: while a restore is in progress, new-turn writes already fail against the maintenance flag; no additional kind-specific downtime or server restart may be introduced by this feature.

## Requirements _(mandatory)_

### Functional Requirements

**Model & durability**

- **FR-001**: The system MUST assign every timeline event it persists exactly one `kind` from a closed enumeration: `user_message`, `assistant_message`, `reasoning`, `tool_call`, `tool_result`, `approval`, `sampling`, `elicitation`, `choices`, `self_corrected`. Writes outside the enumeration MUST be rejected.
- **FR-002**: The system MUST derive each entry's lane purely from its kind — `user` lane for `user_message`; `external` lane for `assistant_message`; `internal` lane for `reasoning`, `tool_call`, `tool_result`, `approval`, `sampling`, `elicitation`, `choices`, `self_corrected` — and MUST never store lane or any presentation attribute per row.
- **FR-003**: Reasoning MUST be persisted as one `reasoning` entry per agent-loop iteration, attributed to that iteration; the system MUST NOT merge reasoning from multiple iterations into the final assistant entry.
- **FR-004**: `approval`, `sampling`, and `elicitation` entries MUST record the ask and its resolved outcome (`approved`/`declined`, `allowed`/`denied`, response content, or `undecided` when the session ended before resolution) on the same entry, via an in-place update when the user decides.
- **FR-005**: `choices` entries MUST record the options offered; the option the user tapped MUST be persisted as a `user_message` entry linked back to its `choices` entry.
- **FR-006**: Decoration facts — artifact references, sources, interrupted flag, model/token counts — MUST remain metadata on their parent entry and MUST NOT become standalone entries. Transient UI state (spinners, generative-status strip, toasts, error banners) MUST NOT be persisted. Synthetic notes (learning brief, branch excerpts, attachment notes) MUST remain render/assembly-time injections, never stored rows.
- **FR-007**: `self_corrected` entries MUST record the issues found and correction attempt count for a critic pass that modified the draft; turns without critic issues MUST NOT produce one.

**Presentation**

- **FR-008**: The system MUST render every timeline item — persisted and live — through a single kind→presentation registry that defines, per kind: lane, collapsibility, collapsed-by-default, and renderer. Role-based or column-combination-based render branching MUST NOT remain in any timeline presentation path.
- **FR-009**: `tool_call` and `tool_result` MUST remain separate durable entries linked by their tool-call identifier, and MUST render as one grouped internal unit: header (tool name, ok/fail), one-line summary, and structured detail collapsed by default and expandable.
- **FR-010**: Pending/live counterparts (streaming text, streaming reasoning, pending interactive asks) MUST flow through the same registry and renderers as their durable counterparts; the separate duplicated streaming presentation block MUST be removed.
- **FR-011**: Expanded/collapsed state MUST be component state only (not persisted, not session-persisted) for this feature.

**Storage evolution & integrity**

- **FR-012**: The system MUST evolve the existing single messages store in place (add the kind classification; no parallel entries table) and MUST preserve every existing user/assistant entry ID through the migration so branch points, branch sources, and highlight offsets remain valid.
- **FR-013**: A stamped schema-version migration MUST backfill a kind for 100% of existing rows by deriving it from the legacy column combinations, including the edge-case rows listed above; unclassified rows MUST fail the migration loudly rather than silently default.
- **FR-014**: The migration MUST ship through the existing stamped-version `migrate` registry, MUST NOT introduce server downtime or restart, and the restore gate MUST continue to refuse backups stamped newer than the running server while older-stamped backups restore and auto-migrate as they do today.
- **FR-015**: Full-text search results MUST continue to include only user and assistant message content; internal-lane entries MUST NOT appear in search results, and no write path to the self-maintaining search columns may be introduced.

**Context projection**

- **FR-016**: Context assembly MUST be rewritten as an explicit, pure projection from entries to provider messages (with golden tests proving byte-for-byte equivalence of provider-visible context for pre-existing chats before and after), and MUST be the single path through which stored entries reach any provider.
- **FR-017**: The projection MUST include per-kind rules so that kinds that must not reach the provider (approval records, self-correction notes, etc.) are deterministically excluded, and tool call/result pairing is reconstructed from the entries' kinds and linkage rather than guessed from column shapes.

**Quality & documentation**

- **FR-018**: The authoritative architecture and seams documents MUST be updated as part of this feature to describe the entry-kind model, lane derivation, presentation registry, and the entries→provider projection seam.
- **FR-019**: All standard quality gates (type-check, lint, full test suite, and the server test suite where server code changes) MUST pass with no regressions; migration and projection behavior MUST be covered by tests, including regression tests for the wall-of-text fix and reload-honesty scenarios.

_Sequencing note (informative, refines the suggested phasing): Story 1 ships first with kinds temporarily derived from existing columns (no schema change), then the kind column + backfill migration lands and derivation flips off; Story 2's persistence follows; Story 3's projection rewrite lands behind golden tests; Story 4 unifies live rendering; Story 5 is independent throughout._

### Key Entities _(include if feature involves data)_

- **Timeline Entry (durable)**: One persisted conversational event in the existing messages store — identity (stable ID, preserved for existing rows), kind, content, ordering, creation time, optional tool-call linkage (pairs `tool_call`↔`tool_result`), optional ask payload + resolved outcome (`approval`/`sampling`/`elicitation`), optional offered-options payload (`choices`), optional iteration attribution (`reasoning`), and decoration metadata (artifact refs, sources, interrupted flag, model/token counts).
- **Lane**: A presentation classification derived from kind — user (right, foreground bubble), internal (left, quiet, no bounding box, collapsible), external (left, bordered bubble). Derived, never stored.
- **Live Entry**: The in-flight counterpart of a durable entry (streaming text, streaming reasoning, pending interactive ask) carrying a lifecycle state (streaming/pending → persisted or discarded); renders through the same registry.
- **Presentation Registry**: The single kind→presentation mapping (lane, collapsible, collapsed-by-default, renderer). Pure function of kind; the only place presentation is decided.
- **Context Projection**: The pure entries→provider-messages function that replaces intent-guessing in context assembly; owns per-kind provider-visibility rules.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of rendered timeline items dispatch through the single kind→renderer registry, with zero role-based or column-combination-based render branches remaining in any timeline presentation path (verifiable by inspection and by test).
- **SC-002**: Tool results render collapsed by default in 100% of cases, with structured detail reachable in exactly one user interaction (one click/tap).
- **SC-003**: For 100% of recorded turns, reloading the page shows: every permission/sampling/elicitation ask with its resolved outcome (or explicit undecided state), every choice offer with its options and the taken selection, and reasoning as per-iteration entries correctly attributed — fixture-driven verification across legacy and new-format chats.
- **SC-004**: Provider-visible context for pre-existing chats is identical before and after the projection rewrite — 100% of golden-test fixtures pass with zero diffs.
- **SC-005**: The migration backfills 100% of existing rows with a kind; zero user/assistant entry IDs change; 100% of branch points, branch sources, and highlight offsets in the fixture corpus remain valid and old chats render correctly.
- **SC-006**: Streaming and persisted assistant output render through the same renderer path, and the duplicated live-streaming presentation block is fully removed (verifiable by inspection).
- **SC-007**: All mandated quality gates (type-check, lint, test suites) pass with zero regressions.

## Assumptions

- **Naming (resolves open question 2)**: The classification column is named `kind` (not `event`); persisted rows are called **entries** (not `timeline_items`); the store remains the existing messages table with no parallel table.
- **`self_corrected` scope (resolves open question 1)**: In scope, as the lowest-priority slice (Story 5); it may be deferred in delivery without invalidating the rest of the enumeration.
- **Tool pairing (resolves open question 3)**: `tool_call` and `tool_result` stay separate durable entries linked by tool-call identifier and render as one grouped internal unit under a single collapsible.
- **Fate of the role column (resolves open question 4)**: The existing role column is retained during and after this feature (the projection and backfill consult it); removing or deprecating it is explicitly out of scope and may be revisited later.
- **Collapse-state persistence (resolves open question 5)**: Expanded/collapsed state is component state only; no session persistence in this feature.
- **Approval write-back (resolves open question 6)**: Outcomes are written back to the same entry via in-place update (`undecided` → resolved). This is safe under the existing truncate-and-reload restore semantics because a restored backup consistently re-creates whichever state was captured, and an ask restored without an outcome simply renders as undecided (Story 2, scenario 4).
- **Migration edge-case mapping (resolves open question 7)**: Hidden rows keep their hidden flag and gain their derived kind; legacy choice rows map to `choices` (offer) with their presentation-only result rows classified and hidden by the registry; empty tool-call bookkeeping rows map to `tool_call` and render hidden-by-registry within their grouped unit; assistant rows with reasoning embedded in metadata classify as `assistant_message` and their legacy reasoning remains readable as decoration until such rows age out (no retroactive split of historical reasoning — only new turns get per-iteration entries).
- **Search behavior**: Internal-lane entries are excluded from full-text search results by query-level filtering of kinds; the generated search columns themselves are untouched and self-maintaining, and no reindex path is added.
- **Reasoning visibility defaults**: Reasoning entries follow the current persona/practice defaults (collapsed, quiet) — this feature changes attribution and durability, not the reveal policy.
- **Live pending asks after completion or abort**: When a turn is aborted or the session ends, asks without decisions are persisted as undecided rather than deleted (honest record) or left dangling as live state.
- **Dependencies**: The existing stamped schema-version/restore machinery, repository-only data access layering, and progressive server-capability detection are reused as-is; this feature adds no new external dependencies and no new runtime server requirements.
