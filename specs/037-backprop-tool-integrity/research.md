# Research: Back-propagation tool integrity fixes (037, issue #73)

Phase 0 output. Every file:line claim below was re-verified against the current tree on
branch `fix/issue-73-backprop-tool` (features 033/035/036 drifted several of the
issue's original anchors — the anchors here are the current ones).

## D1 — US1: shared chrome filter for propagation payloads

**Verified anchors (current tree)**

- `src/lib/chat/propagation.ts:98-107` — `buildRawPayload` renders **every** row of the
  branch (`renderRawDelta(rows, …)`, line 104) and collects images from every row
  (line 105). Used by BOTH paths: the tool (`deterministic-tools.ts:314`) and the manual
  store path (`chat.svelte.ts:1820`).
- The tool's own rows exist in the timeline before the payload is built:
  - `tool_call` row: `chat.svelte.ts:852-878` (`appendAssistantToolCall`, content `''`,
    `toolCallId`/`toolName` set), persisted by the loop at `loop.ts:822-828` **before**
    execution.
  - approval row: `chat.svelte.ts:1469-1507` (`requestApprovalImpl`), `kind:
    'approval'`, `toolName` set, content `"<toolName> — <description>"`.
  - declined/earlier result rows: `role: 'tool'`, `kind: 'tool_result'`, `toolName`
    set (`messages.ts:93-109` `appendToolResult`; persisted at `loop.ts:975-981`).

**Decision**: add one predicate in `src/lib/chat/propagation.ts` — a row is
*propagation chrome* iff its `toolName === 'propagate_to_parent'` (covers the
`tool_call` row, the `approval` row, and the `tool_result` row, since all three carry
`toolName`). Apply it inside `buildRawPayload` (both the rendered rows and the image
collection) and inside `collectPropagatedImages`, so both the tool path and the manual
path exclude chrome by construction.

**Rationale**: a single shared filter restores the 027 "byte-identical" guarantee by
construction (both paths already share these builders); keying on `toolName` needs no
kind-switching because all three chrome row shapes set it; excluding earlier
propagation attempts (including declined ones) is required for parity — a manual run
after a declined tool attempt must produce the same payload as a tool run.

**Alternatives considered**
- Exclude only the in-flight call's rows (by `toolCallId`): breaks parity whenever an
  earlier propagation attempt exists; also can't know the result row's id up front.
- Tool-side filtering only (manual path unchanged): the manual payload would still
  embed earlier tool chrome, violating parity from the other direction.
- Match on row `kind` triples: equivalent but more code; `toolName` alone is exact
  because non-propagation tools never carry that name.

## D2 — US2: clear the stale success record on latch refusal

**Verified anchors**

- `chat.svelte.ts:1783-1851` — `propagateToParent`: latch refusal returns at **:1787**
  (`if (!acquirePropagationLatch()) return;`), which is **before** the run path clears
  the record at **:1801** (`this.lastPropagation = null;`) and sets it on success at
  **:1836**.
- `src/routes/chat/[id]/+page.svelte:328-337` — `runPropagation` awaits the store call,
  then reads `chatStore.lastPropagation` (:331) and toasts success when set (:332-337).
  A refused call therefore re-reads the PREVIOUS run's record and toasts success for a
  run that never happened. (`canPropagate` is at :313-315.)

**Decision**: on the latch-refusal early return in `propagateToParent`, set
`this.lastPropagation = null` before returning (leaving `propagationStatus`/`propagationError`
untouched, preserving the 027 design note that a foreign path's run must not corrupt
UI state — clearing the stale record is exactly what keeps this path's own UI honest).

**Rationale**: minimal, root-cause fix — the page logic ("toast iff the record was set
by THIS call") becomes true because every propagateToParent entry now either owns the
latch and manages the record, or refuses and clears it.

**Alternatives considered**
- Fix in `runPropagation` (return a status from the store and gate the toast): larger
  signature change; every future caller would have to remember the gate.
- Clear on a timer/derived flag: strictly worse; introduces time-based UI state.

## D3 — US3: split the root vs provider-without-tools fallback line

**Verified anchors**

- `src/lib/chat/brief.ts:260` — `'If the propagate_to_parent tool is not available (root
  chat, or a provider without tool support), point the learner to the manual
  back-propagate control instead — never imitate propagation in prose.'`
- The preamble is only injected when tools are live: `loop.ts:594-596`
  (`if (toolsEnabled) sysParts.push(buildCapabilitiesPreamble())`).
- The manual control is hidden on roots: `+page.svelte:313-315`
  (`canPropagate = chatStore.chat !== null && chatStore.chat.parentId !== null && …`).
- On a root chat, tools ARE enabled and `propagate_to_parent` is excluded per-turn via
  `disabledToolIds` (`chat.svelte.ts:727`).

**Decision**: replace brief.ts:260 with two lines: (a) root-chat case — say this chat
is a root: propagation moves a **branch's** outcome to its parent, so it needs a child
context; offer to branch (`branch_chat`) if the learner wants that, and never imitate
propagation in prose; (b) branch-chat-but-provider-without-tools case — keep pointing
at the manual back-propagate control (visible there). Amend
`specs/027-backprop-tool/contracts/propagate-tool.md` preamble item 5 in place with a
037 cross-reference.

**Rationale**: each case now points at the only real path for that case; the branch
case keeps the 027 contract's intent verbatim where it is actually true.

**Alternatives considered**
- Delete the fallback line entirely: leaves the model with no guidance for a legitimate
  learner request; the split costs one line.
- Reveal the manual control on roots: contradicts 020 FR-010 gating (roots have no
  parent to propagate into) — a product regression, not a fix.

## D4 — US4: re-check abort after generation, before the write

**Verified anchors**

- `src/lib/agent/deterministic-tools.ts:270-344` — `propagate_to_parent.run`:
  - entry abort check **:283** (`if (ctx.signal?.aborted) return { ok: false, summary:
    'aborted' };`) — the ONLY abort check;
  - summary generation **:296-311** (abort during generation already handled);
  - raw payload **:313-317**; `resolveAnchor` **:319**; `insertAnchored` **:321-331**
    with no abort re-check between generation and the write;
  - latch released in `finally` **:341-343**.

**Decision**: add one more `if (ctx.signal?.aborted) return { ok: false, summary:
'aborted' };` immediately before `resolveAnchor` (line 319), covering both modes. On
abort the tool persists nothing further; the turn-level abort path (loop aborts when a
tool result summary === 'aborted', `loop.ts:988-996`) finishes the turn.

**Rationale**: the gap is precisely "generation done, artifact not yet written";
one check closes it for raw and summary alike, and the existing `finally` releases the
latch on every exit.

**Alternatives considered**
- Also re-check between `resolveAnchor` and `insertAnchored`: the anchor read is a
  repository query with no user-visible side effect; one pre-write check is the
  meaningful boundary (and the write itself is a single INSERT).
- Abort-aware `insertAnchored`: pushes abort policy into the repo layer for no gain.

## D5 — US5: dedupe at collection + duplicate-safe grid key

**Verified anchors**

- `src/lib/components/chat/PropagatedArtifact.svelte:119` — `{#each images as image
  (image.data)}`: two identical images ⇒ Svelte duplicate-key error.
- `src/lib/chat/propagation.ts:105` (`buildRawPayload`) and **:119-122**
  (`collectPropagatedImages`) collect images without deduplication (cap 8 only).
- House pattern for duplicate-safe keys: `src/lib/components/chat/Composer.svelte:418`
  — `{#each images as att, i (att.part.data + ':' + i)}`.
- `ImagePart` (`src/lib/chat/kinds.ts:174-181`): `data` is the natural identity;
  `name` may differ for identical data.

**Decision**: (1) dedupe by `part.data` (first occurrence wins, order preserved)
inside both collection paths — implemented as one shared helper in `propagation.ts`
applied **before** the 8-image cap so duplicates cannot crowd out distinct images;
(2) key the artifact grid by `image.data + ':' + i`, matching the Composer pattern, so
legacy artifacts already storing duplicates (pre-fix rows in existing databases) render
without crashing.

**Rationale**: collection-level dedupe fixes the data going forward; the composite key
is defense-in-depth for rows that already exist plus any path that bypasses collection
(future writers). FR-007 ("not solely by image data") is satisfied by the key change.

**Alternatives considered**
- Key-only fix (no dedupe): artifact parts still carry redundant copies against the
  8-part invariant's spirit; rejected.
- Dedupe by whole-part deep equality: two identical images with different `name`s would
  both survive — exactly the crash case; `data` identity is the correct key.

## D6 — US6: update parts in place, atomically with content

**Verified anchors**

- `src/lib/db/repositories/messages.ts:217-239` — `updateArtifactContent` sets only
  `content` + merged `metadata`.
- `chat.svelte.ts:1862-1909` — `regenerateArtifact` calls it at **:1891-1894**; never
  touches `parts`, so a changed source-branch image set leaves stale parts rendering
  (component reads `partsOf(entry)`, `PropagatedArtifact.svelte:65`).
- Parts invariants + validator: `messages.ts:23-38` (`validateParts`); `artifactParts`
  builder: `propagation.ts:130-135`.
- 020 contract note (store docstring, `chat.svelte.ts:1854-1856`): regeneration keeps
  "id, ord and anchor … unchanged".

**Decision**: extend `updateArtifactContent(id, content, metadataPatch, parts?)` —
`parts?: MessagePart[] | null`: an array is validated with the existing `validateParts`
and stored; `null` explicitly clears the column to NULL; `undefined` leaves it
untouched (backwards-compatible for existing callers). The store's `regenerateArtifact`
passes `artifactParts(summary, deduped collected images) ?? null` so regeneration
mirrors fresh propagation (same collection rules, D5 dedupe included, image-less
result clears parts). Content, metadata, and parts update in ONE UPDATE statement —
atomic, all-or-nothing.

**Rationale**: preserves the 020 in-place identity (no id/ord churn, no anchored
delete+reinsert dance, search columns untouched); explicit-clear vs untouched
distinguished so the store can faithfully express "no images now".

**Alternatives considered**
- Delete-and-reinsert atomically: changes row id (breaks external references and the
  documented regeneration contract) for zero benefit.
- A second follow-up UPDATE for parts: two statements can straddle a failure — not
  atomic.

## D7 — US7: declined marker on the loop-synthesized tool result

**Verified anchors**

- The issue's original anchor is stale: 031 already persists a declined tool_result —
  `loop.ts:909-913` synthesizes `{ ok: false, summary: 'user declined' }` (no tool
  execution), persisted via `appendToolResult` at `loop.ts:975-981` →
  `messages.ts:93-109`, producing row content `'user declined'` but metadata
  `{"ok":false}`.
- On reassembly, the model sees `toolResult = metadata ?? content`
  (`src/lib/chat/context.ts:91-93`) ⇒ `{"ok":false}` — the words "user declined" are
  shadowed by metadata; a failure is indistinguishable from a decline. That ambiguity
  is the re-offering bug that remains.
- The projection replays tool rows as tool-result parts with JSON-parsed output
  (`src/lib/chat/projection.ts:250-259`).

**Decision**: the declined synthesis at `loop.ts:913` gains `detail: { declined: true }`
→ persisted metadata becomes `{"declined":true,"ok":false}` → reassembled `toolResult`
parses to exactly that object: machine-checkable and model-legible. Non-decline
failures keep their existing shapes (distinct per D7 test). Update
`docs/reference/tool-map.qmd` (approval/decline flow, line ~77) in the same change to
document the durable declined marker — AGENTS.md tool-map invariant.

**Rationale**: one-line change riding the existing persisted row; no new entity, kind,
or migration (027 invariant "no new persisted entity" respected); survives restarts and
both tool paths; the existing capabilities-preamble etiquette line (brief.ts:253 "Do
not re-request an action the learner has declined") finally has durable signal to
apply.

**Alternatives considered**
- Change `context.ts` fallback order (content over metadata) for declined rows: touches
  the golden-fixture-covered projection for ALL tool rows; risk far exceeds the fix.
- Persist a new explicit metadata row kind surfaced by the prompt builder: violates the
  no-new-entity stance and adds migration surface for information already persisted.

## D8 — Cross-cutting: parity test strategy and docs to touch

**Decision**: parity is proven at three layers: (1) unit — `propagation.test.ts`:
chrome filter excludes exactly the propagation rows and nothing else; dedupe helper
behavior; (2) tool end-to-end — `deterministic-tools.test.ts`: seeded branch with
chrome rows → tool artifact content identical (string equality) to `buildRawDelta` of a
content-only twin branch, and identical to the manual-path payload; (3) store —
`chat.svelte.test.ts`: manual propagation after a declined tool attempt excludes the
chrome. Docs touched in the same change: `docs/reference/tool-map.qmd` (D1 parity
wording line ~54, D7 decline marker line ~77), and
`specs/027-backprop-tool/contracts/propagate-tool.md` amended in place (D1 payload
exclusion, D3 preamble item 5) with 037 cross-references. `agent-map.qmd` is
check-only (no tool inventory change).

**Rationale**: issue acceptance demands byte-identical parity; layered tests catch
regressions at the cheapest failing layer. AGENTS.md requires tool-map updates in the
same change as tool-semantics changes (D1, D7 both qualify).
