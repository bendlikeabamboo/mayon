<!--
  Appendix: preserved from specs/004-internal-area-unification/contracts/interactive-surfaces.md @ commit a937edc24ff3fa71df06cb550f2697e1a1d8a092
  Copied: 2026-08-27 (verbatim, unmodified — load-bearing artifact referenced from living docs/code)
-->

# Contract: Interactive Surfaces

**Seams**: `Composer.svelte` (compose area), `MessageList.svelte` + `rows/ChoicesOffer.svelte` (timeline internal lane), `rows/AskEntry.svelte` (asks). Governs where assistant-initiated interaction may live (FR-006 / FR-007).

## Compose area (input-only)

The compose area contains **only** user-input affordances:

| Allowed                                                                                                           | Forbidden (any chat state: idle, streaming, gate pending, ask pending)                                                                       |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| prompt textarea, send/stop, effort selector, MCP server/resource/prompt pickers, model meta line, attachments row | pacing chips, suggestion chips (gate or strategy defaults), approval/decline controls, choices of any kind, assistant-authored progress text |

Consequences: `Composer` loses `suggestedReplies` and the gate `progress` prop entirely. Artifact link chips for existing labs/quizzes are navigation for user-visible artifacts, not assistant-initiated turn interaction — unchanged and out of scope.

## Choices offer (timeline internal lane)

State machine (inputs: `streaming`, `findGateFromMessages(messages)`, linked taken option):

| State    | Condition                                                         | Rendering                                             | Interaction                                                  |
| -------- | ----------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| inactive | entry is not the active gate                                      | existing read-only offer                              | none                                                         |
| active   | `!streaming ∧ gate.entryId === entry.id ∧ no linked taken option` | options as buttons (chip styling, focus/hover states) | tap → `chatStore.send(option, { choicesEntryId: entry.id })` |
| taken    | user row links `choicesEntryId === entry.id`                      | existing read-only offer with taken option marked     | none (incl. after reload)                                    |

`findGateFromMessages` scans backward and stops at the last user message — any reply (chosen option or free text) deactivates the gate. Prose pacing gates (models without the tool) render as normal text; no synthetic offer is fabricated.

## Asks (approval / sampling / elicitation)

- Placement: internal lane, at the ask row's **chronological** position — via the live-merge rule in [timeline-assembly.md](./timeline-assembly.md) R2 (live card replaces its durable row while pending; durable row with outcome chip renders otherwise).
- Exactly one surface per pending ask; never the compose area, never a modal outside the timeline.
- Interactive affordances (Approve/Decline, sampling approve, elicitation form) exist **only** on the live card; durable rows are records (outcome chip + details), not controls.
- Undecided durable rows (reload mid-wait) render clearly undecided — no interactive control, no claimed outcome (002 US2 rule).

## Regression bars

1. No chat state renders assistant-initiated interactive elements in the compose area (component source contains no chip/suggestion rendering).
2. Active-gate fixture: offer options are tappable; tap sends a user row linked via `choicesEntryId`; offer flips read-only with the taken option marked (store-level assertion).
3. While `streaming`, no offer is tappable (guard).
4. Ask fixture: exactly one ask component instance per pending ask (merge rule), positioned at the durable row's index.
