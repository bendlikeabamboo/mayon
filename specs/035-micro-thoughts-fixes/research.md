# Research: Micro-Thoughts Follow-Up Fixes (035)

**Feature**: 035-micro-thoughts-fixes | **Date**: 2026-11-10

Phase 0 forensics. Every claim re-anchored against the current tree (post-#70/feature-033);
the issue's original line numbers had drifted as expected.

## D1 — Where reasoning rows are written today, and the critic hole

- **Decision**: In `src/lib/agent/loop.ts` (current), `walkPersist` (lines 474–542) is the
  ONLY writer of reasoning rows: block `kind === 'reasoning'` → `deps.appendReasoning?.(b.text, iteration)`
  (line 507; whitespace-only dropped by the `b.text.trim()` guard). `blocks` (a
  `PersistBlock[]`, line 462/97) is reset per iteration (line 633) and consumed by
  `walkPersist` (cleared at line 540).
- **Rationale**: The finalize branch (lines 729–767) chooses: `finalBuf !== buf` (critic
  changed the text) → direct `deps.appendAssistantText(finalBuf, …)` (lines 743–750) and
  `walkPersist` never runs → the original iteration's reasoning blocks are silently
  dropped. Else → `walkPersist(i, finalBuf, turnImages, true)` (line 751). Pre-029 the
  iteration's reasoning persisted unconditionally before the critic; 029 moved the write
  into `walkPersist` and 033 kept the corrected bypass — that is the regression.
- **Alternatives considered**: (a) Route the corrected path through `walkPersist` with a
  "replace text" mode — rejected: the walk would slice the corrected text at stale block
  offsets (033 finalize-composition §2 already declares the corrected reply is one fresh
  stretch). (b) Persist reasoning inside `runCriticPhase` before re-streaming — rejected:
  the no-issue case never enters the correction loop, and the abort-before-critic cases
  have empty `blocks`. Chosen: a small "flush reasoning blocks" step (loop over `blocks`,
  `appendReasoning` per non-empty reasoning block, then clear) executed in the corrected
  branch immediately before the corrected append — reuses the same trim/ordering rules as
  the walk.
- **Verified facts**: the tool-budget-exhaustion path (lines 972–990) always follows a final
  interim `walkPersist` (line 775) which cleared `blocks`, so it has nothing to drop — no
  change needed there. `persistAbortedTurn` (554–566) only runs with `blocks === []` (top-of-
  loop abort 570–573; streamText-throw abort 620–623 — both after the previous walk cleared,
  before the new iteration fills). The abort catch (686) and aborted-mid-stream check (721)
  already persist reasoning via `walkPersist`. Existing test
  `loop.test.ts:2139` ("critic correction re-stream discards reasoning deltas") is
  compatible: its ORIGINAL stream has no reasoning — it keeps passing (asserts
  `appendReasoning` not called), and stays the guard for D6 (correction's own reasoning
  discarded).

## D2 — Why `liveBlocks` duplicates across iterations, and the boundary design

- **Decision**: Add optional dep `onIterationBoundary?: () => void` to `AgentTurnDeps`;
  the loop fires it (a) after the interim persist in the tool-calls path (after
  `walkPersist` + trace at lines 775–783), (b) after the finalize persist completes — both
  corrected-append and walk branches, right before `return { aborted: false }` (line 766;
  also before the budget-path return at 990 for consistency), and (c) inside
  `runCriticPhase` when a correction re-emit is about to start (after `initialIssues`
  proves non-empty, before the first re-stream; `runCriticPhase` already receives `deps`).
  The store implements it as `this.liveBlocks = []`.
- **Rationale**: `liveBlocks` clears only at send start (chat.svelte.ts:576), load (455),
  and turn teardown (995). The loop's post-iteration `deps.updateReasoningBuffer('')`
  (loop.ts:705–706) is a no-op once the last block is text (store handler 715–718 only
  updates a trailing reasoning block) — so iteration 1's blocks stay live next to the rows
  `walkPersist` just persisted: `liveItems` (341–420) emits the reasoning again beside its
  durable row and the live text block slices an already-cleared `streamBufferRender`
  (emptied by `appendAssistantText`, 785–786) → duplicate thought + empty stale bubble.
  Firing AFTER the persist (never before) means durable rows replace the live view with no
  gap; firing at correction start (c) also lets the corrected re-emit stream into a FRESH
  text block at offset 0 (the old open text block is gone, so `updateStreamBuffer`'s
  push-guard at 706–708 creates one) instead of mis-slicing against the old block's offset.
- **Alternatives considered**: (a) Clear `liveBlocks` inside `appendReasoning`/
  `appendAssistantText` — rejected: within one walk, several rows persist; clearing mid-walk
  drops the still-unpersisted later blocks' live view. (b) Fire the boundary at stream end
  (before the critic/walk) — rejected: on paced presets the finalize append intentionally
  waits for the eased drain (022 D3); clearing the live view first would blank the paced
  text the user is watching finish. (c) Filter `liveItems` against persisted rows — rejected:
  content-matching heuristic, fragile with equal texts.

## D3 — Regenerate on multi-row turns

- **Decision**: Two-part. (1) Extract the gate into a pure exported helper
  `lastRegeneratableAssistantId(timeline: TimelineItem[]): string | null` in
  `src/lib/chat/entries.ts`; semantics: scan from the end while items are durable
  `reasoning` rows with `anchored === true` (skip them), then the first item reached must be
  a durable `assistant_message` (with the usual streaming/live-tail guards staying in
  `MessageList`); return that row's id. `MessageList.svelte:79–83` (`lastAssistantId`)
  delegates to it. (2) Add store method
  `deleteLastAssistantTurn(assistantRowId): Promise<{userText; attachments} | null>` in
  `chat.svelte.ts`: find the row, walk back to the previous `user` row (capturing its text +
  `attachmentsOf` like `+page.svelte:585–592`), delete EVERY message after that user row
  (loop of `repos.messages.delete`), update `this.messages`, return the resend payload;
  `onRegenerate` (`+page.svelte:579–597`) calls it and re-sends.
- **Rationale**: The current gate (MessageList.svelte:79–83, unchanged line numbers from the
  issue) requires the LAST timeline item to be `assistant_message`; an interleaved turn can
  end on a trailing anchored reasoning row (029 mock's trailing " done thinking." burst) so
  the button disappears; and the handler deletes only `interruptedId` (594–595), orphaning
  the turn's earlier reasoning/text rows ahead of the regenerated reply. `assembleTimeline`'s
  `reorderTurn` (entries.ts:280–301) only splices UNanchored reasoning before the assistant
  row — anchored rows are positional and legitimately trail. Deleting all rows after the
  previous user message is the issue's stated scope and matches the reveal gate's intent
  (US5: "deletes a reply row … chronology-safe only for the latest turn").
- **Alternatives considered**: (a) Delete only reasoning+text rows, keep tool rows —
  rejected: half-deleted tool groups produce orphan tool results in the timeline. (b) Keep
  logic in the route — rejected: untestable without mounting the route; no route tests exist.
- **Verified facts**: hidden user rows are skipped by display but are real prompt rows in
  `chatStore.messages`; walking raw messages finds them correctly (same behavior as today's
  text capture). `attachmentsOf` is already imported by the page from `#lib/chat/kinds.js`
  (the store already imports from kinds too).

## D4 — Paced-preset per-block drain stall

- **Decision**: In `appendAssistantText` (chat.svelte.ts:728–796), replace the drain gate
  (currently `pacer && this.streamPreset !== 'standard' && content && !aborted`, lines
  740–744) with: `pacer && this.streamPreset !== 'standard' && opts?.final === true &&
  this.streamBuffer !== '' && content && !aborted`.
- **Rationale**: every `appendAssistantText` call runs `pacer.onStreamEnd()` +
  `await waitForDrain(pacer)`; after the first block's append the store cleared
  `streamBuffer`/`streamBufferRender` and called `pacer.reset()` (785–790), so the next
  append's `onStreamEnd()` lands in `draining` with nothing to release — `waitForDrain`
  (301–309) polls `pacer.mode !== 'flushed'` until `DRAIN_DEADLINE_MS` (1200 ms) burns.
  N text blocks ⇒ (N−1)×1.2 s. The 033 `final: true` marker (already carried by every
  finalize append: loop walk 525–537, corrected 746–750, budget 980–983, image-only
  fallbacks) distinguishes finalize appends from interim ones; `this.streamBuffer !== ''`
  covers the multi-block finalize walk (block 2+ appends after block 1 emptied the buffer).
  Abort paths already skip via `!aborted`; image-only skips via `content`.
- **Alternatives considered**: (a) "Treat an empty buffer as flushed" alone (`streamBuffer !== ''`
  without the `final` gate) — rejected: keeps a per-iteration drain wait on every interim
  tool-boundary append (each iteration's buffer is non-empty), still serializing mid-turn
  pacing stalls. (b) A turn-scoped `drainedOnce` flag — rejected: two cheap idempotent
  conditions beat more state. (c) Fix the pacer to reach `flushed` on empty — rejected:
  022's pacer API is contract-frozen; the bug is the store calling it pointlessly.
- **Amendment (binding)**: 022's deferred-finalize (research D3) now applies to the turn's
  FINALIZE appends only; interim tool-boundary persists never wait. Accepted UX trade-off:
  interim text on paced presets is cut at persist (the buffer is cleared then anyway).

## D5 — Finished thoughts keep pulsing

- **Decision**: (a) Store: `onReasoningSegmentStart` (719–721) closes ALL currently open
  blocks before pushing the new one; `onTextSegmentStart` (722–727) extends its existing
  close-loop from text-only to all open blocks (reasoning included). (b) `liveItems`
  reasoning push (356–359) gains `streaming: b.open`. (c) `LiveReasoningEntry`
  (entries.ts:72–76) gains `streaming: boolean`. (d) `ReasoningEntry.svelte` live props
  gain `streaming?: boolean`; the pulsing dot (34–36) renders only when `streaming` is not
  `false`. (e) `MessageList.svelte:164` passes `streaming={item.streaming}`.
- **Rationale**: nothing sets a reasoning block's `open` to false until turn teardown
  (973), and `liveItems` ignored `open` for reasoning — earlier completed bursts of an
  interleaved iteration look still-streaming. Closing on the next segment/text start
  matches the loop's own segment-close rules (029 stream-segments state machine). With D2's
  boundary clearing whole iterations, this fixes the within-iteration case.
- **Alternatives considered**: derive "completed" in `ReasoningEntry` by watching buffer
  growth — rejected: heuristics in a view; the flag is authoritative.

## D6 — Trace's phantom whitespace tail

- **Decision**: In `src/lib/agent/trace.ts`, extract the pop-if-whitespace step
  (currently inline at 186–188, fired only on the next `reasoning-start`) into a small
  private prune helper on the current iteration; call it on `reasoning-start` (existing
  behavior), on `reasoning-end` (new branch — event currently unhandled), and at `finish`
  (alongside 198–199 finishReason capture). Prune condition unchanged: last segment exists
  and `!last.trim()`.
- **Rationale**: the loop defers opening a segment until non-whitespace content
  (loop.ts:272–276), so a whitespace-only final burst persists no row and opens no live
  block — but `TraceBuilder` opens a segment on every `reasoning-start` and only prunes
  lazily, so a whitespace-only tail survives into `reasoningSegments` and the diagnostics
  panel (`DiagnosticsPanel.svelte:482–483`) renders a phantom segment when
  `segments.length > 1`.
- **Verified fact**: a real trailing thought (mock's " done thinking.") is non-whitespace
  and MUST survive — prune condition is strictly whitespace-only. `iter.reasoning` (raw
  accumulation) is out of scope: the panel's single-block fallback renders it verbatim
  either way.
- **Alternatives considered**: prune in `toJSON()` — rejected: `toJSON` is a pure
  serialization of already-emitted state; closing events are the honest boundary.

## D7 — Test seams (verified against current test files)

- `src/lib/agent/loop.test.ts`: `runAgentTurn` with `mockedStreamText` scripted
  `fullStream`s (two `.mockReturnValueOnce` for two iterations), `mockedValidateTurn`
  scripted issue lists, `makeDeps` captures `appendReasoning`/`appendAssistantText`/
  `onReasoningSegmentStart` ordering (`orderOf` helper exists). Home of the US1 fail-first
  test (original-stream reasoning + correction → `appendReasoning` called before the
  corrected append; `finalBuf===buf` → exactly-once) and the boundary-dep unit test.
- `src/lib/stores/chat.svelte.test.ts`: drives the REAL loop via the module mock wrapper
  (76–85) with `mockedStreamText` scripts; `useFileTestDb()` gives durable rows;
  `vi.useFakeTimers` paced-streaming describe (3327+) exists for US4; liveBlocks describe
  (1117+) exists for US2. Home of the two-iteration live test, the paced multi-block test,
  the whole-turn-delete test, and the interleaved-mock-shape test (frame order mirroring
  `streamInterleavedReply`, tests/fixtures/mock-llm/server.mjs:187–205).
- `src/lib/chat/entries.test.ts`: `assembleTimeline` fixtures — home of the gate-helper
  tests (build `Message[]`, call the helper on `assembleTimeline(...)` output; no component
  mount needed).
- `src/lib/agent/trace.test.ts` (NEW): direct `TraceBuilder.emit` sequences for D6.
- e2e: Playwright (`tests/e2e/`) requires the Docker dev stack — implementer tier cannot
  run it; include ONE optional, clearly-marked maintainer task only.

## Needs-clarification resolution

None remained after forensics: every issue item resolved to a concrete mechanism (D1–D6)
with defaults documented in the spec's Assumptions. The `[NEEDS CLARIFICATION]` budget
was spent on nothing — no question blocks implementation.
