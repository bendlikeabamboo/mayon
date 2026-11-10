# Contract: Iteration Boundary (liveBlocks lifecycle amendment)

**Feature**: 035-micro-thoughts-fixes | **Amends**: `specs/029-micro-thoughts/contracts/stream-segments.md`
(store contract: "On turn start: `liveBlocks = []`; on teardown/abort: all blocks closed,
then cleared") and `specs/029-micro-thoughts/contracts/persistence-and-display.md`
(live-timeline section).

## Amendment statement

`liveBlocks` is additionally closed-and-cleared at **iteration boundaries**: the moments
when an agent-loop iteration's live content is superseded by durable rows (or by a critic
re-emit). The turn-start and teardown rules are unchanged. This is an amendment of 029's
store contract, adopted by feature 035 (issue #71 item 2); all other 029 store rules
(append-only within an iteration, unique per-block keys, no open block at turn end) stand.

## Signal

```ts
// AgentTurnDeps (src/lib/agent/loop.ts) — new optional callback:
onIterationBoundary?: () => void;
```

The loop MUST fire it exactly at these sites (current `src/lib/agent/loop.ts` anchors):

| # | Site | Anchor | Why |
|---|------|--------|-----|
| 1 | Tool-calls iteration: after the interim `walkPersist` + its `persisted` trace | after loop.ts:775–783 | the iteration's rows just became durable; the next iteration must not re-show them live |
| 2 | Finalize: after the turn's final persist (both corrected-append and walk branches, incl. the image-only fallback), before `return {aborted:false}` | around loop.ts:758–766 | durable finalize replaces the live view with no gap |
| 3 | Budget-exhaustion return (consistency no-op; blocks already consumed) | before loop.ts:990 | cheap idempotence |
| 4 | Critic correction re-emit start: inside `runCriticPhase`, once `initialIssues` is non-empty, before the first re-stream | runCriticPhase, loop.ts:366–453 | the re-emit is a fresh stretch; the old blocks' offsets no longer apply, and the store must open a fresh text block at offset 0 |

The loop MUST NOT fire the signal before an iteration's blocks are persisted (doing so
blanks the paced live text during the deferred drain — see
[drain-once.md](./drain-once.md)).

## Store behavior

```ts
onIterationBoundary: () => {
    this.liveBlocks = [];
};
```

(`chat.svelte.ts` `runAgentTurn` deps). Clearing the list subsumes closing. Teardown's
close-then-clear (`finally`) is unchanged and remains the safety net for abort/error paths.

## Invariants / acceptance hooks

1. A two-iteration turn (reasoning→text→tool-call, then reasoning→text) never emits the
   same reasoning text twice in `liveItems` at any observation point (fail-first store
   test).
2. No stale empty live text bubble remains after an iteration's text row persists (the
   live text block is gone, not zero-sliced).
3. A critic re-emit streams into a fresh text block at offset 0 (no slicing against the
   pre-correction block's `start`).
4. Within a single iteration, blocks are still append-only with stable keys (029 FR-011
   unchanged); the boundary only ever truncates the whole list between iterations.
5. Abort/error turns keep the 029 terminal-closure guarantee (no open live block at turn
   end) — the boundary signal does not replace teardown.
