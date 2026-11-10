# Contract: Corrected-Persist (critic path keeps original reasoning)

**Feature**: 035-micro-thoughts-fixes | **Amends**: `specs/033-image-output-finalize-paths/contracts/finalize-composition.md` §2
("a critic correction re-emits the reply as one fresh stretch … persists as a single row")
and `specs/029-micro-thoughts/contracts/persistence-and-display.md` rules 1–6 (writer
discipline).

## Amendment statement

When `runCriticPhase` changes the text (`finalBuf !== buf`, `src/lib/agent/loop.ts`
finalize branch, current anchors loop.ts:729–767), the turn persists, in order:

1. **Original-stream reasoning rows** — one `appendReasoning(text, iteration)` per
   non-whitespace reasoning block of the ORIGINAL iteration, in arrival order
   (`metadata {iteration, anchored: true}` — byte-identical row shape to the walk path);
   then the loop clears its `blocks` array.
2. **The corrected text row** — exactly one `appendAssistantText(finalBuf, …)` call, with
   the 033 finalize markers unchanged: images (offset-stripped via `appendAfterText`)
   append after the corrected text; `final: true` rides the call.

The correction re-stream's OWN reasoning deltas remain discarded (029 research D6 — the
correction is one fresh stretch; unchanged, still guarded by the existing
`loop.test.ts:2139` test). The no-correction path (`finalBuf === buf`) keeps
`walkPersist` as the single writer — reasoning persists exactly once; the corrected branch
and the walk are mutually exclusive, which is the no-double-persist guarantee.

## Ordering invariants

- Every `appendReasoning` of the corrected branch precedes the corrected
  `appendAssistantText` call (fail-first `orderOf` assertion).
- `appendSelfCorrected` (self-corrected label row) still lands after the critic decision
  and before the reasoning/text persists of this block (its call site,
  loop.ts:731–733, is unchanged and sits before the branch — pre-existing behavior kept).
- The tool-budget-exhaustion path and `persistAbortedTurn` are untouched: both run with an
  already-consumed `blocks` array (verified in research D1), so nothing to persist there.

## Acceptance hooks

1. Original stream `[reasoning A, text(broken)]` + correction → persisted rows:
   `[reasoning(A, iter 0, anchored), assistant(corrected)]`; reload shows both (fail-first).
2. Valid turn with reasoning → exactly one `appendReasoning` (unchanged count — the fix
   adds no second writer).
3. Correction re-stream emitting reasoning deltas → no extra reasoning rows (D6 guard).
