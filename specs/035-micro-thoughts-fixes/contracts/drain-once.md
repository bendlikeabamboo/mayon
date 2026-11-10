# Contract: Drain Once (paced presets, finalize appends only)

**Feature**: 035-micro-thoughts-fixes | **Amends**: 022 deferred-finalize (research D3 of
`specs/022-smooth-streaming/`) as realized in `chat.svelte.ts` `appendAssistantText`; the
022 pacer API contract (`specs/022-smooth-streaming/contracts/pacer-api.md`) is UNTOUCHED.

## Amendment statement

The deferred finalize drain (wait for the eased pacer drain before persisting) applies to
a turn's **finalize appends only**, at most **once per turn**. Concretely, the gate in
`appendAssistantText` (`src/lib/stores/chat.svelte.ts`, current anchors 736–744) becomes:

```ts
if (
    pacer &&
    this.streamPreset !== 'standard' &&
    opts?.final === true &&      // 033 finalize marker (interim appends never wait)
    this.streamBuffer !== '' &&  // nothing unflushed ⇒ treat as flushed
    content &&                   // unchanged (image-only append skips)
    !aborted                     // unchanged (abort persists immediately)
) {
    pacer.onStreamEnd();
    this.streamPhase = pacer.mode;
    await this.waitForDrain(pacer);
}
```

Rationale: after any append the store clears `streamBuffer`/`streamBufferRender` and calls
`pacer.reset()` — a subsequent append's `onStreamEnd()` parks the pacer in `draining` with
nothing to release and `waitForDrain` burns the full `DRAIN_DEADLINE_MS` (1200 ms). With
the gate above: interim (tool-boundary) appends never wait; a multi-block finalize walk
drains on its first block only (later blocks see an empty buffer); a correction's single
finalize append drains once when the correction text is unflushed.

## Behavior table

| Scenario (paced preset) | Before | After |
|---|---|---|
| Single-block turn | 1 drain (eased reveal kept) | 1 drain — unchanged |
| Multi-block interleaved turn (N text blocks) | 1 healthy drain + (N−1)×1200 ms deadline stalls | ≤1 drain total |
| Tool-iteration interim append | drain wait each iteration | no wait (persist immediately) |
| Abort / error | immediate persist | unchanged |
| Standard preset | verbatim, no drain | unchanged |

## Invariants / acceptance hooks

1. A paced two-text-block turn's second durable row persists without advancing fake timers
   past the drain deadline (fail-first, `vi.useFakeTimers` in the paced-streaming
   describe).
2. The eased single-block reveal still happens: no durable assistant row exists while
   `streamPhase === 'draining'` (existing 022 test stays green).
3. `pacer` API surface (`onArrived`/`onStreamEnd`/`tick`/`reset`/`onAbort`/`mode`) is
   called no differently from today except that `onStreamEnd` is no longer invoked from
   appends that cannot drain.

## Trade-off (accepted, documented)

On paced presets, interim text blocks (and finalize blocks after the first) persist
without waiting for their eased tail reveal — the live buffer is cleared at persist time
regardless, so the alternative would re-introduce per-block stalls. Recorded as a residual
in the spec's Open Questions.
