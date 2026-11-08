# Contract: In-Conversation "Fix This Diagram" Action

**Feature**: 028-mermaid-error-repair | **Surfaces**: `Markdown.svelte` (error block) → `AssistantMessage.svelte` → `chatStore.send`

The user-triggered recovery path for diagrams that survived automatic repair
(spec Story 3, FR-009). No new message kinds, endpoints, or server surface — it is
an ordinary follow-up user message.

## Availability

- The error block renders a "fix this diagram" action **iff** `<Markdown>` was
  given the optional fix-action callback prop. Only durable assistant rows wire
  it (`AssistantMessage.svelte` → `chatStore.send`). Labs, quizzes, user
  messages, and tool results render the same error block without the action.
- With no provider configured the conversation cannot send at all (existing
  composer behavior); the action is therefore unavailable exactly when sending
  is (spec Story 3 scenario 3).

## Trigger payload

Activating the action sends **one visible** canned user message via the existing
`chatStore.send(text)` path (no `hidden` flag — the fix is part of the visible
record; research D4). The message contains:

1. A short instruction to re-emit a corrected version of the diagram as a valid
   mermaid fence (and nothing else),
2. the **original broken source**, fenced verbatim,
3. the failure reason (the same string the error block reveals on demand).

The failed message is never edited or annotated; linkage is by prompt content
alone (no metadata coupling — see [data-model.md](../data-model.md)).

## Expected outcome

- The assistant's reply contains a corrected fence, which flows through the
  standard render pipeline
  ([render-pipeline.md](./render-pipeline.md)) and renders as a diagram.
- Cost bound: exactly one send per activation; no automatic re-sends or loops
  (spec SC-004). If the reply's diagram is still broken, the user sees the
  contained error block again and may act again — each action is an explicit,
  user-visible spend.
