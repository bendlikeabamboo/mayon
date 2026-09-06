# Phase 0 Research: Branch Back-Propagation

**Feature**: `020-branch-backprop` | **Date**: 2026-09-06

All findings grounded in the current codebase (worktree `young-hippopotamus`). Every
NEEDS CLARIFICATION slot from the plan's Technical Context resolved; none remain.

## R1. Where does the branch point live, and is it persisted?

**Decision**: Reuse `chats.branch_point_message_id` (persisted on the child, pointing at a
row in the parent's `messages`) plus `chats.parent_id`. Anchor position in the parent =
`ord` of that message, resolved at propagation time.

**Rationale**: It is the exact fork marker the composition engine already honors
(`cutoffForChild`, `src/lib/chat/context.ts:102-106`). No new linkage data is needed.

**Alternatives considered**: deriving the anchor from `branch_sources` spans (expound-only,
not set for manual branches); a new marker table (rejected with Card 005's separate-store
ruling in `ideas/008-branch-context-sync/decisions.md`).

**Caveat (resolved)**: composer "branch here" paths (`src/routes/chat/[id]/+page.svelte:556-577`,
`src/routes/+page.svelte:142-151`) persist `branch_point_message_id: null`. For those
branches the anchor is **derived**: the last parent message with `created_at ≤` the branch
chat's `created_at`; if none exists, the artifact anchors at the very start of the parent
(`ord` below the current minimum). Labeled in the artifact metadata as `anchor: "derived"`
vs `"recorded"`.

## R2. What are "branch-only turns"?

**Decision**: Every row in `messages WHERE chat_id = branch.id` — the transcript prefix is
never copied (shared by reference; `src/lib/chat/context.ts:1-18` header). Raw delta =
those rows rendered verbatim + the anchored excerpt.

**Rationale**: `chats.createChild` copies zero messages; the prefix is re-read from
ancestors at every composition. So "delta" needs no diffing.

**Policy (FR-006)**:
- Turns render in `ord` order, prefixed with their role (`[user]`, `[assistant]`,
  `[tool: <toolName>]`); tool-call and tool-result rows are included as stored.
- Mid-turn edits: rows are append-only and immutable after write (except interrupted
  metadata), so whatever is persisted at propagation time **is** the final state — no
  extra policy machinery needed.
- Anchored excerpt: `branch_sources.excerpt` when a row exists for the branch
  (`branchSourcesRepo.getByBranchChat`); otherwise the content of the parent message at
  `branch_point_message_id`; otherwise (derived anchor, no excerpt) omitted.

## R3. How does a new message kind become real? (touchpoint inventory)

**Decision**: Follow the established kind-adoption checklist. Adding `branch_artifact`
requires: TS unions in `src/lib/db/schema.ts:73-86` + `src/lib/chat/kinds.ts`
(`EntryKind`, `ALL_KINDS`), a `laneOf` case + exhaustive test row
(`kinds.ts:17-21`, `kinds.test.ts:109-133`), a timeline/render case
(`MessageList.svelte:168-200` — an unhandled kind currently renders an empty gap div),
a **projection case** (`projection.ts:99-232` — an unhandled non-excluded kind is
silently dropped from LLM context), and the raw-SQL search kind filter
(`src/lib/db/repositories/search.ts:97`). **No DB CHECK constraint exists on `kind`**
(drizzle `enum` is TS-only), so no migration for the union itself.

## R4. How does the artifact steer future compositions? (projection)

**Decision**: Do NOT add the kind to `PROVIDER_EXCLUDED_KINDS` (`context.ts:26-32`) or
`EXCLUDED_KINDS` (`projection.ts:10-16`). Add an explicit projection branch: the artifact
becomes a single `user`-role message whose text is a deterministic framing header
(built from metadata: source branch title, mode, timestamp) followed by the stored payload
content. Store the row with `role: 'user'` so the default emission path in
`context.ts:80-91` also carries it.

**Rationale**: The artifact must steer answers (FR-008); the two exclusion sets are the
only gates. A user-role message is accepted by every provider; a system-role row would be
pulled out by the agent loop's `sysParts` split (`loop.ts:301`) — also viable, but
user-role keeps the artifact visible as conversational history in all consumer paths
(including `splitContextForGeneration`, which keeps user/assistant turns only).

**Alternatives considered**: root-scoped system-note injection like the brief
(`brief.ts:198-233` via `context.ts:141-147`) — rejected: the brief is not a message row,
which would violate the spec's core decision (a real, persisted, collapsible entry) and
Card 001's ruling.

**Sibling isolation (verified, no work needed)**: a parent-side artifact has
`ord > ord(branchPointMessageId)` of every pre-existing sibling branch, and the ancestor
walk is cutoff-inclusive (`ord <= cutoff`), so existing branches and their compositions
are untouched — matching FR-009. Branches created *after* propagation from a point below
the artifact naturally include it.

## R5. How does the artifact land mid-thread when `append` only writes to the end?

**Decision**: Change `messages.ord` from `integer` to `double precision` (drizzle schema
change → generated migration `drizzle/0004_*.sql` via `pnpm db:generate`) and add
`messagesRepo.insertAnchored(chatId, afterOrd, beforeOrd | null, entry)` computing
`ord = (afterOrd + beforeOrd) / 2` (or `afterOrd + 1` when the anchor is the last
message; `minOrd − 1` for start-of-thread). Propagation writes exactly **one** row.

**Rationale**: Ordering sites are few but load-bearing (3 SQL `ORDER BY` in
`repositories/messages.ts:55,107,120` + 1 in-memory sort in `context.ts:70`, plus the
`lte` cutoff at `:119` and its derivation at `context.ts:102-106`). A tie-break column
(option B) would touch all of those *and* tax every future consumer to remember the
composite key; a fractional `ord` keeps the single-column ordering invariant everywhere —
including the cutoff contract `ord <= ord(branchPointMessageId)`. `double precision`
gives ~2^53 resolution: even thousands of anchored inserts per chat never exhaust the
gap between adjacent messages, so no rebalancing path is needed (and none may be added —
rows are never rewritten at propagation time, preserving SC-003).

**Alternatives considered**: composite `(ord, tiebreak)` sort key (rejected above);
shifting subsequent ords by +1 at insert (rejected: rewrites existing rows, violating
FR-005/SC-003); `numeric` type (unnecessary cost over `double precision`).

**Migration precedent**: first `ALTER COLUMN TYPE` in `drizzle/` (prior migrations are
only CREATE TABLE / ADD COLUMN / indexes), but it is a lossless int→double cast requiring
no data transform, hence no `schema-migrations.ts` entry. Old-dump restore coerces
integer values into the double column under `pg_restore --data-only`
(`server/src/pg-backup.ts` path is otherwise untouched).

## R6. How is the summary generated?

**Decision**: Reuse the one-shot generation precedent (`generateTitle`,
`src/lib/ai/generate/generate-title.ts:33-63`): a `generateBranchArtifactSummary` in
`src/lib/ai/generate/` that runs `generateText` over
`splitContextForGeneration(assembleContext(branchChatId), SUMMARY_PROMPT)`
(`context-split.ts:36-50` — keeps user/assistant turns, joins system notes into the
system prompt; Z.AI/GLM rejects system-in-messages). Model = the chat's active provider
via `getActiveSdkProvider`. `maxRetries: 0` like the title path; trace persisted to
`agent_traces` with a new trace kind (`buildObjectTrace` precedent,
`src/lib/agent/trace.ts`). The row is inserted **only after** successful generation
(FR-013 atomicity).

**Rationale**: `assembleContext(branchChatId)` already composes parent prefix + branch
turns — exactly the material "what happened on this branch" needs. No server changes:
the chat turn path is entirely client-side (`runAgentTurn` → `streamText`), and the
one-shot helpers live client-side too.

## R7. Does anything else need per-kind work?

**Decision**: three small explicit extensions, everything else rides generically.

1. **Search**: extend the raw-SQL filter at `search.ts:97`
   (`kind IN ('user_message','assistant_message')`) with `'branch_artifact'` so artifact
   text is findable. `search_vec` itself needs nothing: the generated column is
   kind-agnostic over `content` (`packages/shared/src/fts.ts`), kind exclusions happen at
   query time only. No index writes, no rebuild paths (constitution-gated).
2. **Backup/restore/export**: zero work — dump/restore are whole-table and generic; there
   is no per-kind export feature in the app.
3. **Expound/selection**: no interplay — the artifact is its own message wrapper
   (`msg-<id>` div); selection mapping is per-message. Keep the artifact's chrome
   (labels/buttons) out of selectable text per the existing injected-DOM conventions.

## R8. Where does the propagate control live, and what happens after landing?

**Decision**: A "Back-propagate to parent" control in the branch chat's composer/header
area, shown only when `chat.parentId` is non-null and the branch has ≥ 1 own message
(FR-010 gating). Click → mode chooser (Raw delta / Summary) → execute. After landing:
confirmation with a link to the parent. The artifact component offers regenerate
(summary mode only) and delete in place. Users on the parent see the artifact on next
`load(chatId)` (`listByChat` with fractional `ord` ordering); no cross-chat live push
exists today and none is added.

## R9. Constitution compliance notes discovered during research

- All writes go through `messagesRepo`/`chatsRepo` — app code never touches `db`
  directly (Principle I).
- The `kind` union has no DB constraint, so `pnpm db:generate` emits only the `ord`
  type change; the change is code-first elsewhere (matches the documented drift
  pattern at `schema.ts:66-72` — generated DDL additive, NOT NULL/backfill logic never
  hand-edited).
- Tests: pglite driver covers repo/insert/projection logic; UI-only collapse rendering
  verified via `pnpm check` + manual smoke (Principle II).
- No new dependencies; bundle untouched (Principle IV).
