# UX2 — Per-node delete, cascading

**Epic:** `refinement/ui-ux-phased.md` → UX2 (#1).
**Status:** Execution-ready. No DB migration; repo refactor + new method + `/tree` UI.
**Source decisions:** all resolved in the phased plan (incl. the spec **correction**
below — the recursive-CTE is *not* visible across batch statements, so the descendant
set is materialized into a session-scoped `TEMP` table).
**Independent of UX1** — can land in either order.

## Goal

Delete an arbitrary **non-root** node and its entire sub-tree from the conversation
tree: the node, all `parent_id`-reachable descendants, and every artifact attached to
that set (messages, labs, quizzes + questions/attempts/answers, agent_traces,
branch_sources, cross_links). The parent, ancestors, and siblings — including a sibling
branched from the same parent message — remain intact.

- **`deleteSubtree(rootId)`** (today's root-delete cascade) is **refactored**, not
  behaviorally changed — it now shares one cascade builder with the new
  `deleteBranch`. A baseline regression test is added (none exists today).
- **Per-node Delete lives on `/tree` only.** Root delete on `/chat` is unchanged.

---

## Mechanism (verified against the code)

### Why a `TEMP` table, and why `deleteSubtree` keeps `root_id`

The refinement doc (#1, line 33) suggested computing the descendant set with a
recursive CTE "in the first batch statement" and referencing it in later deletes. **That
does not work**: in SQLite a CTE is scoped to the single statement that declares it.
Later statements in the same batch/transaction cannot see `desc`.

**Decided:** materialize the descendant set into a **session-scoped `TEMP` table** as
the first statement(s) of the batch, reference it in every cascade delete, drop it last.
TEMP tables are connection-scoped and survive across statements on one connection in
**both** drivers — the OPFS worker keeps one `db` handle for its lifetime
(`opfs-worker.ts:36`), the Tauri driver keeps one `plugin-sql` connection (`tauri.ts`),
and the in-memory test driver keeps one `db` handle (`memory.ts:27`). Every `batch` runs
as one `BEGIN…COMMIT` transaction on that one connection (`opfs-worker.ts:73`,
`tauri.ts:49`, `memory.ts:43`).

`deleteSubtree` does **not** need recursion — its target set is exactly
`WHERE root_id = ?`, so it keeps that inline predicate (regression-safe) and **only**
`deleteBranch` materializes the `TEMP` table. Both share one cascade builder.

### The cascade builder

The existing `deleteSubtree` (`src/lib/db/repositories/chats.ts:141-202`) issues 12
statements in a single `driver.batch([...])`, every one keyed on `root_id = ?`. The
refactor extracts their shape into a pure builder parameterized by the **chat-selection
predicate** (`cs`):

- `deleteSubtree(rootId)` → `cs = { sql: 'root_id = ?', params: [rootId] }` → identical
  output to today (byte-for-byte semantics, regression-safe).
- `deleteBranch(id)` → wraps `cascadeStatements({ sql: 'id IN (SELECT id FROM
  _delete_set)', params: [] })` between the `TEMP`-table create/populate and drop.

Every clause's chat-id selection is rewritten to use `cs`:

| Today (root case)                            | Generalized                                                |
| -------------------------------------------- | ---------------------------------------------------------- |
| `… WHERE root_id = ?` (on `chats`)           | `… WHERE ${cs}`                                            |
| `… JOIN chats c … WHERE c.root_id = ?`       | `… JOIN chats c … WHERE c.${cs}`                           |
| `… IN (SELECT id FROM chats WHERE root_id=?)`| `… IN (SELECT id FROM chats WHERE ${cs})`                  |

For the temp case `cs = "id IN (SELECT id FROM _delete_set)"`:
- `WHERE ${cs}` → `WHERE id IN (SELECT id FROM _delete_set)` ✓
- `WHERE c.${cs}` → `WHERE c.id IN (SELECT id FROM _delete_set)` ✓

### `branch_sources` correctness (verified — no special-case needed)

- The deleted branch's **own** `branch_source` row has `branch_chat_id = <deleted
  node>` → it is in the set → removed by the `branch_chat_id IN (…)` clause.
- A **sibling** branched from the same parent message has a different
  `branch_chat_id` (not in the set) and its `source_message_id` points at the **parent
  message**, whose parent chat is **not** in the set → neither `branch_source` clause
  touches it → sibling + its `branch_source` survive. ✓
- `branch_sources` whose `source_message_id` lives inside the deleted subtree are
  removed by the `source_message_id IN (… JOIN chats c … WHERE c.${cs})` clause. ✓

### Hardening surfaced while planning — leak-safe TEMP table name

TEMP tables are connection-scoped. If a prior `deleteBranch` batch **failed** midway
(driver rolled back the transaction), a leftover `_delete_set` table could persist on
the connection (SQLite does not reliably roll back temp-table DDL) and the next call's
`CREATE TEMP TABLE _delete_set` would throw "table already exists". Mitigation: lead
the batch with `DROP TABLE IF EXISTS _delete_set` before create. Batches are
non-reentrant on a single connection (each awaited before the next), so a fixed table
name is otherwise safe; the leading `DROP IF EXISTS` makes the call **idempotent**
regardless of any prior failure. (Not in the refinement spec — added here.)

---

## Changes

### 1. `src/lib/db/repositories/chats.ts` (edit + add)

#### 1a. New private helper `cascadeStatements(cs)` (module-level)

Returns `BatchStatement[]` — the 12 cascade deletes in leaf→root dependency order, each
using the chat-selection predicate `cs` (a `{ sql: string; params?: unknown[] }`). This
is the existing statement list (`:144-200`) with every `root_id = ?` / `c.root_id = ?`
replaced by `${cs.sql}` (interpolated; `cs.sql` is a **trusted, internally-authored**
fragment — never user input — so interpolation is safe) and params threaded through.
The one clause that uses the predicate twice (`cross_links … OR …`) spreads params
twice: `params: [...p, ...p]`.

```ts
import type { BatchStatement } from '$lib/db/driver/types';

/**
 * The shared cascade: delete every artifact attached to a set of chats, then the
 * chats themselves, in leaf→root order so `ON DELETE NO ACTION` FKs never trip.
 * `cs` selects the target chat ids — `root_id = ?` (root delete) or
 * `id IN (SELECT id FROM _delete_set)` (per-node delete). Trusted/internal fragment.
 */
function cascadeStatements(cs: { sql: string; params?: unknown[] }): BatchStatement[] {
	const p = cs.params ?? [];
	return [
		// agent_traces has quiz_id → quizzes.id FK; delete before quizzes.
		{ sql: `DELETE FROM agent_traces WHERE chat_id IN (SELECT id FROM chats WHERE ${cs.sql})`, params: p },
		// Quizzes: answers → attempts → questions → quizzes.
		{ sql: `DELETE FROM quiz_answers WHERE question_id IN (SELECT qq.id FROM quiz_questions qq JOIN quizzes qz ON qz.id = qq.quiz_id JOIN chats c ON c.id = qz.chat_id WHERE c.${cs.sql})`, params: p },
		{ sql: `DELETE FROM quiz_attempts WHERE quiz_id IN (SELECT qz.id FROM quizzes qz JOIN chats c ON c.id = qz.chat_id WHERE c.${cs.sql})`, params: p },
		{ sql: `DELETE FROM quiz_questions WHERE quiz_id IN (SELECT qz.id FROM quizzes qz JOIN chats c ON c.id = qz.chat_id WHERE c.${cs.sql})`, params: p },
		{ sql: `DELETE FROM quizzes WHERE chat_id IN (SELECT id FROM chats WHERE ${cs.sql})`, params: p },
		{ sql: `DELETE FROM labs WHERE chat_id IN (SELECT id FROM chats WHERE ${cs.sql})`, params: p },
		// branch_sources reference both a message and a chat in the target set.
		{ sql: `DELETE FROM branch_sources WHERE branch_chat_id IN (SELECT id FROM chats WHERE ${cs.sql})`, params: p },
		{ sql: `DELETE FROM branch_sources WHERE source_message_id IN (SELECT m.id FROM messages m JOIN chats c ON c.id = m.chat_id WHERE c.${cs.sql})`, params: p },
		// chats.branch_point_message_id → messages cycles with messages.chat_id → chats;
		// clear the (nullable) branch-point ref before deleting messages.
		{ sql: `UPDATE chats SET branch_point_message_id = NULL WHERE ${cs.sql}`, params: p },
		{ sql: `DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE ${cs.sql})`, params: p },
		{ sql: `DELETE FROM cross_links WHERE from_chat_id IN (SELECT id FROM chats WHERE ${cs.sql}) OR to_chat_id IN (SELECT id FROM chats WHERE ${cs.sql})`, params: [...p, ...p] },
		// Chats last (after every FK that points at them is gone).
		{ sql: `DELETE FROM chats WHERE ${cs.sql}`, params: p }
	];
}
```

> The `UPDATE chats … WHERE ${cs.sql}` clause is the one behavioral subtlety to keep:
  it nulls `branch_point_message_id` on the **target** chats (rows about to be deleted)
  before messages are removed, so a target chat's branch-point FK can't block the
  message delete. For the root case this matches today exactly. For the per-node case
  it only touches chats in `_delete_set` (all being deleted anyway), so it is harmless
  and correct.

#### 1b. Refactor `deleteSubtree(rootId)` (regression-safe)

Replace the inlined 12-statement array (`:143-201`) with:

```ts
async deleteSubtree(rootId: string): Promise<void> {
	await getDriver().batch(
		cascadeStatements({ sql: 'root_id = ?', params: [rootId] })
	);
}
```

Output is semantically identical to today — the regression test (below) pins it.

#### 1c. New `deleteBranch(id)` (per-node cascade via TEMP table)

```ts
/**
 * Delete an arbitrary non-root node and its entire sub-tree (the node + all
 * `parent_id`-reachable descendants) plus every attached artifact. The parent,
 * ancestors, and siblings — incl. a sibling branched from the same parent
 * message — survive. One batched transaction.
 *
 * The descendant set is materialized into a session-scoped TEMP table because a
 * recursive CTE is statement-local in SQLite and cannot be referenced by later
 * batch statements. The leading `DROP IF EXISTS` makes the call idempotent if a
 * prior call left the table behind on a rolled-back batch.
 */
async deleteBranch(id: string): Promise<void> {
	await getDriver().batch([
		{ sql: 'DROP TABLE IF EXISTS _delete_set' },
		{
			sql: `CREATE TEMP TABLE _delete_set(id TEXT PRIMARY KEY) AS
				WITH RECURSIVE desc(id) AS (
					SELECT id FROM chats WHERE id = ?
					UNION ALL
					SELECT c.id FROM chats c JOIN desc ON c.parent_id = desc.id
				)
				SELECT id FROM desc`,
			params: [id]
		},
		...cascadeStatements({ sql: 'id IN (SELECT id FROM _delete_set)' }),
		{ sql: 'DROP TABLE _delete_set' }
	]);
}
```

> `CREATE TEMP TABLE … AS WITH RECURSIVE …` creates and populates the table in one
  statement (no separate `INSERT`). `PRIMARY KEY` dedups the `UNION ALL` tails safely
  (the recursive walk is already `UNION ALL`, but a node could only appear once in a
  tree since `parent_id` is single-valued; the PK is belt-and-braces).

### 2. `src/lib/stores/chat.svelte.ts` (edit + add)

#### 2a. New private `clearActiveView()` helper

The reset block currently inlined in `deleteChat` (`:367-380`) is needed verbatim by
`deleteBranch`. Extract it to a private method and call it from both, removing
duplication (and the bug surface of two copies drifting):

```ts
/** Abort in-flight work and drop the active-conversation view from the store. */
private clearActiveView(): void {
	this.stop();
	this.titleController?.abort();
	this.inferController?.abort();
	this.inferredBrief = null;
	this.inferDismissed = false;
	this.inferring = false;
	this.chat = null;
	this.chatId = null;
	this.messages = [];
	this.error = null;
	this.streamBuffer = '';
	this.streaming = false;
}
```

Then `deleteChat` (`:364-381`) becomes:

```ts
async deleteChat(chatId: string): Promise<void> {
	await repos.chats.deleteSubtree(chatId);
	if (this.chat && (this.chat.id === chatId || this.chat.rootId === chatId)) {
		this.clearActiveView();
	}
}
```

#### 2b. New `deleteBranch(id)` store method

```ts
/**
 * Delete a non-root node and its sub-tree. If the active chat was inside the
 * deleted set (it no longer exists afterward), drop the active view so the
 * route can navigate away. The descendant set is computed in SQL — the store
 * just checks existence of the active id post-delete.
 */
async deleteBranch(id: string): Promise<void> {
	await repos.chats.deleteBranch(id);
	if (this.chatId) {
		const stillThere = await repos.chats.getById(this.chatId);
		if (!stillThere) this.clearActiveView();
	}
}
```

> One extra `getById` per delete (a rare, destructive action) avoids re-deriving the
  descendant set in JS. If `this.chatId` is `null` (no active conversation), the check
  is skipped entirely.

### 3. `src/routes/tree/+page.svelte` (edit)

Add a per-node **Delete** affordance for **non-root** nodes only (root delete stays on
`/chat`). Mirror the `/chat` list pattern: native `confirm()` + hover `Trash2` button
(`src/routes/chat/+page.svelte:65-78,140-150`).

- **Imports:** add `goto` from `$app/navigation`, `Trash2` from `@lucide/svelte`,
  `chatStore` from `$lib/stores/chat.svelte`. (Re-add `onMount` is already present.)
- **State:** `let deletingId = $state<string | null>(null);`
- **Extract `reloadForests()`** from the current `onMount` body (`:24-30`) so both
  `onMount` and the delete handler reuse it:
  ```ts
  async function reloadForests() {
  	roots = await repos.chats.listRoots();
  	const subtrees = await Promise.all(roots.map((r) => repos.chats.listSubtree(r.id)));
  	forests = buildSubtreeModel(subtrees.flat());
  }
  onMount(async () => { await reloadForests(); loading = false; });
  ```
- **Delete handler:**
  ```ts
  async function deleteBranch(node: SubtreeNode) {
  	if (!confirm(`Delete "${node.chat.title}" and all its branches?`)) return;
  	deletingId = node.chat.id;
  	try {
  		await chatStore.deleteBranch(node.chat.id);
  		await reloadForests();
  		// If the active conversation was the deleted sub-tree, leave the tree view.
  		if (chatStore.chatId === null) await goto('/chat');
  	} finally {
  		deletingId = null;
  	}
  }
  ```
- **Markup:** inside the existing `row` snippet (`:80-106`), on the row `<a>`'s line,
  add a hover `Trash2` button **gated to non-root** (`node.chat.parentId !== null`),
  placed after the `<a>` (so the link stays the primary click target), reusing the
  `/chat` list's visibility classes:
  ```svelte
  {#if node.chat.parentId !== null}
  	<button
  		type="button"
  		title="Delete this branch and its sub-branches"
  		aria-label="Delete branch"
  		class="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
  		disabled={deletingId === node.chat.id}
  		onclick={() => deleteBranch(node)}
  	>
  		<Trash2 class="size-4" />
  	</button>
  {/if}
  ```
  The parent row `<div class="flex items-center gap-2 …">` (`:80`) needs `group` added
  to its class list so `group-hover:opacity-100` lights the button on row hover (same
  pattern as `routes/chat/+page.svelte:126`).

> **Pagination:** the page already resets `pageNum = 1` reactively when `forests.length`
  changes (`:32-35`), so a delete that empties the current page is handled — no extra
  clamp code needed.

---

## Tests — `src/lib/db/repositories/repositories.test.ts` (edit)

Add a `describe('delete cascade')` block. **No `deleteSubtree` test exists today**, so
the root-delete case doubles as the new baseline regression for the refactor. Set up
trees with the existing repo factories (`repos.chats.createRoot/createChild`,
`repos.messages.append`, `repos.labs.create`, `repos.quizzes.create` +
`quizQuestionsRepo.add`, `repos.quizAttempts`/`quizAnswers`, `repos.agentTraces.create`,
`repos.branchSources.create`, `repos.crossLinks.create`).

Build this fixture once (a shared helper in the block), then assert per case:

```
root (depth 0)
└─ a (depth 1)            ← branch_point = msgR1
   ├─ b (depth 2)         ← branch_point = msgA1  (sibling of c, same parent message)
   └─ c (depth 2)         ← branch_point = msgA1  (sibling; survives deleting b)
      └─ d (depth 3)
```

Attach to **each** of `a/b/c/d`: ≥1 message, 1 lab, 1 quiz (with 1 question + 1 attempt
+ 1 answer), 1 agent_trace. Add a `branch_source` for `b` and `c` off `msgA1`. Add a
`cross_link` from a **separate root** `other` → `b` (target in a delete set) and one
`other` → `a` (target that survives).

Cases:

1. **`deleteSubtree(rootId)` (regression):** after delete, `listSubtree(rootId)` is
   empty; root is gone from `listRoots()`; messages/labs/quizzes(+children)/traces/
   branch_sources/cross_links for that tree are gone. `other` and its cross_link to `a`
   … — wait, `a` is in root's subtree, so that cross_link is also gone; use `other` ↔
   `other2` for the survives cross-link instead. (Keep one surviving link on `other`.)
   **Purpose:** pin the refactor didn't change root-delete behavior.
2. **`deleteBranch(b)`:** `b` + `d`? no — `d` is under `c`. Deleting `b` removes `b` and
   **its** descendants (none here, or add `b'` under `b` and assert it's gone). `a`,
   `c`, `d`, `root` survive. `c`'s `branch_source` (off `msgA1`) **survives**; `b`'s
   `branch_source` is gone. `b`'s message/lab/quiz(+children)/trace gone; `c`'s intact.
3. **`deleteBranch(c)`:** removes `c` + `d` (+ their artifacts); `a`, `b`, `root`
   survive; `b`'s `branch_source` survives (off `msgA1`, parent chat `a` not in set).
4. **Cross-link target in set:** `other → b` is removed when `b` (or its ancestor) is
   deleted; `other` itself survives and still opens (`getById(other)` ok) with its other
   links intact.
5. **Parent never touched:** after `deleteBranch(b)`, `a` still has its message
   `msgA1` (the branch source parent message) — confirm via `messages.listByChat(a)`.
6. **Ancestor chain intact:** `root → a` reachable; `listChildren(root)` still returns
   `[a]`.

> All cases run on the **in-memory** driver (`createMemoryDriver`, the existing
  `beforeEach`). The TEMP-table path is exercised identically there because the
  in-memory `batch` runs on one sql.js handle with temp-table support. If sql.js
  temp-table behavior ever diverges, gate this block behind a `try { CREATE TEMP TABLE
  … }` capability probe — but it supports them today.

---

## Out of scope

- Persistent "undo" / trash for deleted branches (not in the spec).
- A custom confirm dialog (native `confirm()` reused for parity with `/chat`).
- Root delete from `/tree` (root delete stays on `/chat`; `/tree` node-delete is
  non-root only).
- Bulk/multi-select delete.
- UX1 (independent), UX3–UX5 (separate phases).

## Risks / edge cases

- **Recursive-CTE not visible across batch statements.** Resolved via the `TEMP` table
  (above). The `CREATE TEMP TABLE … AS WITH RECURSIVE …` form does create+populate in
  one statement.
- **Leftover `_delete_set` after a failed batch.** Mitigated by the leading
  `DROP TABLE IF EXISTS _delete_set` (above).
- **Refactor changes root-delete behavior.** Pinned by the `deleteSubtree` regression
  case (none existed before; added here).
- **`branch_sources` for a sibling wrongly deleted.** Excluded by construction
  (sibling's `branch_chat_id` and its `source_message_id`'s parent chat are both
  outside the set) — covered by case 3.
- **Active chat invalidated mid-use.** Store clears the view only if the active id is
  gone post-delete (`getById` → null); the `/tree` route then `goto('/chat')`.
  In-flight streaming on the active chat is aborted by `clearActiveView` → `stop()`.
- **Deleting a node with a branch-point message in a *surviving* ancestor.** Not
  possible: a node's `branch_point_message_id` always lives in an ancestor chat (the
  parent it forked from), which is **outside** the deleted set, so the message is never
  deleted and the (pre-delete) `UPDATE … SET branch_point_message_id = NULL` only
  touches chats in the set (being deleted). No FK violation.
- **SQL injection via `cs.sql`.** Not user input — two hard-coded internal literals
  (`'root_id = ?'` and `'id IN (SELECT id FROM _delete_set)'`). Parameters are always
  bound, never interpolated.

## Verification

- **Automated:** `pnpm test` — new `delete cascade` block in
  `repositories.test.ts` (covers `deleteSubtree` regression + `deleteBranch` cascade +
  sibling/branch_source/cross-link survival). Plus `pnpm check` and `pnpm lint` clean.
- **Manual (OPFS + Tauri):** `/tree` → hover a **non-root** node → **Delete** → confirm
  → that sub-tree disappears; parent/siblings/ancestors stay; page re-renders; other
  roots untouched. Delete the **active** chat from `/tree` → app returns to `/chat`.
  Root delete on `/chat` unchanged. Verify the parent's branch-source message still
  opens. On desktop, confirm the cascade is one transaction (no partial delete on
  error).

## Suggested commit split

1. `chats.ts` — `cascadeStatements` helper + refactor `deleteSubtree` + add
   `deleteBranch` (no behavior change to root delete yet observable → safe alone).
2. `repositories.test.ts` — `delete cascade` block (regression + per-node).
3. `chat.svelte.ts` — `clearActiveView` + `deleteBranch` store method.
4. `routes/tree/+page.svelte` — per-node Delete UI + `reloadForests`.
