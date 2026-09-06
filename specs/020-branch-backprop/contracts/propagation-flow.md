# Contract: Propagation user flow

**Feature**: `020-branch-backprop` | **Date**: 2026-09-06

Behavioral contract for the user-facing flow (testable against spec acceptance
scenarios; no implementation detail).

## Control visibility (FR-001, FR-009, FR-010)

| Condition | Behavior |
| --- | --- |
| Viewing a chat with `parentId = null` (root) | No propagate control |
| Viewing a branch with ≥ 1 own message | Control visible |
| Viewing a branch with 0 own messages (no divergence) | Control hidden/disabled with stated reason ("nothing to propagate yet") |

Propagation always targets the immediate parent; the UI names that parent.

## Flow (SC-005: ≤ 5 interactions, < 30 s)

1. **Trigger**: user activates "Back-propagate to parent".
2. **Mode chooser**: exactly two options — "Raw delta" (branch-only turns + anchored
   excerpt, verbatim) and "Summary" (model-written). Raw executes immediately on choice;
   Summary shows an in-progress state.
3. **Landing**: confirmation indicates success with a link to the parent chat.
   - Raw: lands within ~2 s.
   - Summary: lands when generation completes; on failure, an error is shown, the parent
     is unchanged, and both Retry (summary) and Raw remain available (FR-013).

## Artifact behavior in the parent

| Action | Contract |
| --- | --- |
| View | Collapsed labeled strip (source branch title, mode, timestamp); expands to full payload; same collapse pattern as tool calls/reasoning (FR-003) |
| Position | Sits at the branch point between the anchor message and the next message; stays there as new turns arrive (FR-004); labeled "derived anchor" when the branch had no recorded fork point |
| Regenerate | Summary mode only; replaces content in place, anchor and identity unchanged (FR-007) |
| Delete | Removes the artifact only; no other message affected; future answers no longer steered by it (FR-007) |
| Navigation | Present after reload/restore, anchored where created (FR-012) |

## Failure modes

| Failure | Contract |
| --- | --- |
| Summary generation error/timeout | Clear error; nothing lands; retry + raw remain available |
| No anchor resolvable | Anchors at derived position (R1) — never blocks propagation when a delta exists |
| Very large delta | Full verbatim payload stored; rendered collapsed; never truncated |

## Out of scope (documented non-behaviors)

- No live push into an already-open parent view (appears on next load).
- No propagation to grandparents/siblings/future branches (FR-009).
- No editing of parent or branch history — ever (FR-005).
