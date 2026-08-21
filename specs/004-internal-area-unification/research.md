# Research: Internal Area Unification

Phase 0 output. Every root cause was verified against source during `/speckit.specify`/`/speckit.plan` of this feature (2026-08-21). Format: Decision → Rationale → Alternatives.

## Verified root causes (from source, not speculation)

- **RC1 — duplicated assistant text during approval wait**: `src/lib/agent/loop.ts:398-405` persists `buf` at the tool-call boundary (`appendAssistantText(buf)`), but only the `hasGenerative` branch clears the live buffer (`deps.updateStreamBuffer('')` at 402-405). The iteration resets (`buf = ''` at 297-298, 584) clear the **local** variable, never the store. `ChatState.liveItems` (`src/lib/stores/chat.svelte.ts:160-222`) keeps emitting `live_text` with the stale `streamBufferRender` while `streaming === true`, and `assembleTimeline` (`src/lib/chat/entries.ts:139-141`) appends live items after durable rows → the persisted row **and** the live copy both render until the `finally` block clears the buffers at turn end (584-587). This is exactly the reported "double message that fixes itself after approval".
- **RC2 — duplicated approval surface**: `requestApprovalImpl` (`chat.svelte.ts:752-790`) persists a `kind: 'approval'` row (rendered by the durable `AskEntry` lane branch, `MessageList.svelte:165-166`) **and** pushes `pendingApprovals`, which `liveItems` turns into a `live_ask` item appended at the timeline tail (rendered by the live `AskEntry` branch, 133-142). Two ask surfaces render simultaneously during every wait.
- **RC3 — pending reads as failed**: `ToolActivity.svelte:43-49,61-63` — an unpaired non-terminal call renders `XCircle` + "No result recorded". No awaiting-decision state exists; the tool call row is persisted (`loop.ts:407-413`) before the approval ask fires, so the whole wait shows failure iconography.
- **RC4 — wall of text**: `src/lib/mcp/mount.ts:74-80` stores the (byte-capped) full result payload as the `ToolResult.summary`, which `appendToolResult` (`src/lib/db/repositories/messages.ts:59-68`) writes to `content`. `ToolActivity.svelte:58-60` renders `content` unclamped as the row body. The structured expander never applies to MCP results because `appendToolResult` stores the detail object directly as metadata while `ToolResultMeta` (`kinds.ts:84-86`) expects it wrapped in `{ detail: … }` — so `resultMeta?.detail` is `undefined` for every MCP row.
- **RC5 — trace shows phantom defects**: `loop.ts:260-269` emits the `request` trace event with `messages: ctx.map(role/content)` — the **raw context rows**. That includes the `role: 'system'` brief note (→ system prompt twice when the viewer concatenates `system` + `messages`) and the choices row (`role: 'assistant'`, `content: "The Three Trees"`, tool identity stripped → the "stray bare assistant message"). The projection (`src/lib/chat/projection.ts:48,77-88`) already excludes system rows and re-shapes choices/tool rows — **the wire payload is correct; only the trace lies**.
- **RC6 — interaction in the compose area**: `+page.svelte:226,236,794` computes `suggestedReplies = gate?.options ?? activeStrategy?.replies` and passes it to `Composer.svelte:293-301` (chip row + `sendChip`), along with `progress={gate?.progress}` into the composer meta line.
- **RC7 — success/failure indistinguishable on paired results**: `appendToolResult` stores no `ok` flag; `ToolActivity` shows the green check for **any** paired result (`hasResult → CheckCircle2`), including `ok: false` errors. FR-003's distinct `failed` state cannot be derived today.
- **Existing machinery to reuse**: `findGateFromMessages` (`generate-gate.ts:134-164`) already scans back to the last user message and returns `entryId`; the durable choices offer already links a taken choice via `UserMessageMeta.choicesEntryId` (`MessageList.svelte:59-79`); approval rows already carry `toolCallId` and an `outcome` (`kinds.ts:88-96`); the registry already classifies `terminal` (`registry.ts`, 003 precedent).

## D1 — Retire the live text the moment it is persisted

**Decision**: In `ChatState.appendAssistantText` (`chat.svelte.ts:418-427`), after appending the row and updating `this.messages`, clear `this.streamBuffer` **and** `this.streamBufferRender`. Invariant: _a persisted text segment is authoritative; the live copy retires in the same update_. The empty-buffer `live_text` item then renders the existing quiet "Thinking…" pending bubble (`AssistantMessage.svelte:103-107`), which is the truthful in-flight indicator (003 US2) while tools run or an approval waits.

**Rationale**: The store's persist callback is the single choke point — it covers the mid-loop boundary persist (`loop.ts:398-401`), the critic final persist (382), and the budget path (593) with one change. The abort path in `send`'s `finally` (574-583) reads `this.streamBuffer` before any clear could have withheld content: if the boundary persist already ran, the content is durably stored and the `.trim()` guard skips the empty re-append.

**Alternatives**: (a) `loop.ts` calls `updateStreamBuffer('')` next to the boundary persist — rejected: leaves the invariant split across two files and misses the critic/budget paths. (b) Dedupe in `assembleTimeline` by content-matching live vs durable text — rejected: heuristic, O(n²), and hides rather than fixes the stale buffer.

## D2 — Merge the live ask into its durable position; exactly one ask surface

**Decision**: In `assembleTimeline`, when emitting a durable ask row (`approval`/`sampling`/`elicitation`), if `liveItems` contains a `live_ask` whose `payload.rowId === row.id`, emit the **live item at the row's chronological position** instead of the durable entry, and drop that live item from the tail append. Non-merged live items (`live_text`, `live_reasoning`) still append at the tail (they are newer than every durable row).

**Rationale**: Kills the RC2 double-surface and gives asks their chronological position (US4 scenario 4) in one pure-function rule. The interactive card replaces its own durable row for the duration of the wait; when the decision resolves, `pendingApprovals` empties and the durable row (outcome chip) renders in place. Reload mid-wait has no live items — the durable undecided row renders, per 002 US2.

**Alternatives**: (a) Hide the durable row via CSS when a live ask matches — rejected: presentation hack, still two mounted components. (b) Keep tail placement and only dedupe — rejected: violates the chronological-position requirement.

## D3 — Tool activity status: derived vocabulary, single derivation point

**Decision**: Add a pure derivation (in `entries.ts`, surfaced as additive optional fields on `ToolGroup`, e.g. `awaitingDecision`, `declined`, computed during `assembleTimeline`'s existing pre-scans):

- Pre-scan messages for ask rows by `toolCallId`: an `approval` row with `outcome == null` or `decision: 'undecided'` → **awaiting**; `decision: 'declined'` (with `aborted: true` → **aborted**) → **declined/aborted**.
- Union with live `pendingApprovals` `toolCallId`s → **awaiting**.
- Unpaired call, no awaiting signal, non-terminal, chat streaming → **running** (neutral).
- Unpaired, non-terminal, not streaming, no ask → existing genuine-gap ("No result recorded") — unchanged (003 contract).
- Unpaired terminal → existing neutral presentation — unchanged.
- Paired results: persist `ok` additively into tool_result metadata (`appendToolResult` opts + `loop.ts:558-563` passes `entry.result.ok`); `ok === false` and not declined-linked → **failed**; `ok !== false` (or legacy row without the flag) → **succeeded**. Declined-linked groups render **declined** regardless of the stub result row.

**Rationale**: RC3+RC7. Declined is derivable for legacy **and** new rows from the approval-row link (only high-risk tools can be declined, and they always have an approval row — `loop.ts:474-484`). `ok` cannot be derived for legacy rows, so legacy failed results keep today's success mark (documented fallback); new rows are honest. Everything is a pure function of stored rows + live state + registry — testable, no UI-side tool list.

**Alternatives**: (a) Store `outcome: 'declined'` on the result row too — rejected: duplicates the approval row's authority. (b) Heuristic summary-text matching ("user declined") for legacy — rejected: fragile string coupling. (c) Full migration backfilling `ok` — rejected by spec FR-009 (no stored-row rewrites).

## D4 — Status-driven ToolActivity presentation

**Decision**: `ToolActivity` renders from the derived status: `awaiting` → amber hourglass/pulse icon + "Waiting for your approval" cue, **no** "No result recorded"; `running` → muted pulsing icon, no gap marker; `declined`/`aborted` → struck/muted icon + label; `failed` → red X; `succeeded` → green check; genuine-gap and terminal keep the 003 presentation exactly. Icons from lucide (existing dependency), styling from the existing quiet-row vocabulary.

**Rationale**: FR-003's distinct-outcomes table maps 1:1 onto the derivation; the 003 terminal/genuine-gap contract is preserved verbatim.

**Alternatives**: Reusing the red X for declined — rejected: spec requires declined visually distinct from errored.

## D5 — Results collapsed by default, one bounded line

**Decision**: In `ToolActivity`, the summary line gets Tailwind `truncate` (single line, ellipsis) — CSS-only clamping, no content mutation. A "Show result" expander appears when the stored `content` exceeds a small threshold (≈160 chars) or structured detail exists; expanded view renders the full content (and detail JSON when present) inside the existing bounded container pattern (`max-h-60 overflow-y-auto rounded-lg border …`), collapsible again. Short summaries (deterministic tools) render exactly as today.

**Rationale**: RC4. The payload stays stored and provider-visible verbatim (FR-005/FR-009); only presentation changes. CSS truncation avoids slicing logic and re-render cost on multi-KB payloads. Legacy chats get the fix with zero data change.

**Alternatives**: (a) Store a separate display summary at write time — rejected: new stored state, no legacy coverage, violates presentation-only. (b) Render payload as markdown — rejected: raw JSON/markdown soup; monospace `<pre>` matches the existing detail pattern.

## D6 — Compose area is user-input-only

**Decision**: Remove `suggestedReplies` (prop, chip row, `sendChip`) and the gate `progress` meta line from `Composer.svelte`; remove the `gate`/`suggestedReplies` derivations and prop wiring from `+page.svelte`. The offer itself already displays `progress` (`ChoicesOffer.svelte:24-30`). Artifact link chips for existing labs/quizzes under the composer are navigation, not assistant-initiated turn interaction — out of scope, unchanged.

**Rationale**: RC6 + US4 scenario 3. With gate chips gone, `activeStrategy?.replies` (static defaults) also disappear — per the spec assumption, when no pacing point is active the learner types freely; the model's prose pacing gate still guides tool-less models.

**Alternatives**: Moving static strategy replies into the timeline as a persistent offer — rejected: spec decided no suggestion surface when no pacing point is active; inventing a synthetic offer entry would fabricate history.

## D7 — The active choices offer is tappable, in place

**Decision**: `MessageList` derives `activeGate = !streaming ? findGateFromMessages(messages) : null` (the scan already stops at the last user message, so a taken choice deactivates it) and passes an `onSelect` callback to `ChoicesOffer` when `item.entry.id === activeGate.entryId`. `ChoicesOffer` renders its options as tappable buttons in that mode; selecting one calls `chatStore.send(option, { choicesEntryId: entry.id })` — the exact call the composer chips made (`+page.svelte:380-383`), preserving the user-row link and post-selection read-only rendering (`linkedTakenOption`, `MessageList.svelte:59-79`).

**Rationale**: US4 scenarios 1-2 reuse every existing mechanism (gate scan, entry linking, durable offer); the only new behavior is where the tap target lives. `MessageList` already imports and calls `chatStore` for asks, so no new coupling.

**Alternatives**: (a) Page-level prop plumbing of the gate into `MessageList` — rejected: `MessageList` already receives `messages`; self-containment avoids prop creep. (b) Making all offers always-tappable — rejected: stale offers must never re-fire; only the active gate is live.

## D8 — Trace the wire payload, not the context rows

**Decision**: In `loop.ts`, the `request` trace event carries the **projected** `messages` (the `projectEntries(ctx)` result already computed at line 244), mapped to `{ role, content, toolCallId?, toolName?, kind? }` annotations — not the raw `ctx` rows. The `system` field remains the single system-prompt source (projected messages contain no system rows — `projection.ts:48`). Widen `TraceEvent`/`IterationState` message types additively (`trace.ts`); the diagnostics consumer renders `{role, content}` today and ignores extra fields, so old traces stay readable and new ones are honest.

**Rationale**: RC5. The user-visible "assembled request" (double system prompt, stray "The Three Trees") is a trace artifact; the fix is to log what is sent. Projection is frozen by golden tests, so trace fidelity is inherited for free.

**Alternatives**: (a) Also fix the viewer to post-filter system rows — rejected: patches the symptom at the wrong layer. (b) Trace the SDK-serialized wire body verbatim — rejected: provider-specific shapes, unstable across SDK bumps, huge payloads.

## D9 — Regressions (constitution II: failing-first per user story)

**Decision**: (1) `entries.test.ts`: boundary-persisted text renders exactly once with live items present (fails today — stale buffer duplicates); live ask merges at its durable position exactly once; awaiting/declined derivation from approval rows; running vs genuine-gap split. (2) `chat.svelte.test.ts`: `appendAssistantText` clears both buffers. (3) `ToolActivity` test: status table per D4 + clamped collapsed rendering (fails on wall-of-text fixture). (4) `loop.test.ts`: request trace messages contain no system rows, carry tool identity, and match the projected sequence; `appendToolResult` receives `ok`. (5) `repositories.test.ts`: `ok` persisted into metadata. (6) Offer interactivity: gate-active offer tappable → send with `choicesEntryId` (component/store level). Golden tests run unmodified.

**Rationale**: One failing-first regression per fixed defect; the 003 lesson (fixture key bias masking production breakage) applies — fixtures use distinct ids and production-shaped metadata.

**Alternatives**: None — required.

## D10 — Performance verification

**Decision**: Measure with the perf probe (`window.__MAYON_PERF__ = 1`, scenario tag `mcp-approval`) before/after on the reported brave-search chat: frame timing, longtasks, and TimelineRow render counts during the approval wait and result render. Expectation: flat or better (clamped single-line text does less layout than a multi-KB unclamped span; one ask component instead of two). No claim lands without the numbers (constitution IV).

**Rationale**: Constitution IV; the timeline is the app's hottest render path.

**Alternatives**: None — required for the perf-adjacent claims.
