# Quickstart: Validating Branch Back-Propagation

**Feature**: `020-branch-backprop` | **Date**: 2026-09-06

End-to-end validation for the implemented feature. Maps to spec success criteria
SC-001…SC-005 and the contracts in `contracts/`.

## Prerequisites

- Dev stack running: `pnpm dev` (web on :5173, server on :4319, Postgres).
- A working LLM provider configured (for summary mode and steer checks).
- After pulling this branch: deps installed and dev images rebuilt if
  `@mayon/shared` changed (`pnpm dev:build`).

## Automated gates (run before manual scenarios)

```bash
pnpm check                            # svelte-check
pnpm lint                             # ESLint + Prettier
pnpm test                             # Vitest (pglite) — includes new coverage:
                                      #   insertAnchored midpoint math + placement rules
                                      #   projection mapping + framing header
                                      #   raw-delta builder (roles, tool turns, excerpt)
                                      #   anchor resolution (recorded / derived / start)
                                      #   search kind filter includes branch_artifact
                                      #   ord type migration applied on fresh boot
pnpm --filter @mayon/server test      # server package (migration/boot path)
```

Expected: all green. A fresh pglite boot must apply the `ord → double precision`
migration and end with `schemaVersion` stamped.

## Manual scenario 1 — Raw delta lands anchored (US1, SC-003, SC-005)

1. Create a chat; exchange 2–3 turns.
2. Branch from a mid-thread message ("branch from here" on a message).
3. On the branch, produce a fix (e.g., ask for corrected code; confirm the reply).
4. Trigger "Back-propagate to parent" → choose **Raw delta**.
5. **Expect**: lands ~instantly; confirmation links to the parent.
6. Open the parent: the artifact sits **between the branch-point message and the next
   message** — not at the end. Collapsed strip shows source title + "raw"; expanding
   shows the verbatim branch turns and the anchored excerpt.
7. **Expect**: every pre-existing parent/branch message is byte-identical to before
   (verify via the messages list or a pre/post DB snapshot).

## Manual scenario 2 — Summary mode + regenerate + delete (US3, FR-007, FR-013)

1. On a branch with divergence, propagate → **Summary**.
2. **Expect**: in-progress state, then the summary artifact lands at the same anchor.
3. Regenerate it: content replaced in place, position unchanged.
4. Delete it: gone from the thread; a subsequent steer check (scenario 3) shows the
   stale assumption returns.
5. Failure path (optional): revoke the provider key, attempt a summary — expect a clear
   error, nothing landed in the parent, retry still offered.

## Manual scenario 3 — Parent steers correctly after propagation (US2, SC-001)

1. Parent turn asks for code with a deliberate flaw; branch from that reply; fix it on
   the branch; propagate (either mode).
2. Resume the **parent** and ask a question whose correct answer requires the fix
   (e.g., "run that code mentally — what does it output?").
3. **Expect**: the answer reflects the corrected state without restating the fix.
4. Add 2–3 new parent turns; reload the app: the artifact remains anchored at the
   branch point and still steers (subsequent answers stay consistent).

## Manual scenario 4 — Isolation and edge cases (FR-009, edge cases)

- **Sibling isolation**: with a sibling branch created *before* propagation, resume the
  sibling — its answers must NOT reflect the artifact; its thread must not show it.
- **Derived anchor**: create a composer "branch here" (no fork point), diverge,
  propagate — artifact anchors at the parent's state at branch-creation time, labeled
  "derived".
- **No divergence**: fresh composer branch with zero messages — control hidden/disabled
  with a reason.
- **Branch-of-branch**: from a branch, create a child branch and propagate there — it
  targets the immediate parent (the first branch), never the grandparent.
- **Durability**: run a backup → restore cycle from Settings → Data; the artifact
  survives with anchor, labels, and content intact (SC-004).
- **Search**: search for a word inside the artifact's payload — it is findable;
  searches that matched only regular messages return the same results as before the
  artifact existed.

## Perf spot-check (constitution)

With `window.__MAYON_PERF__ = 1`, perform a propagation on a long parent thread
(50+ messages): no long tasks > 50 ms attributable to the insert/render, scroll stays
smooth (single-row insert; collapsed strip render).
