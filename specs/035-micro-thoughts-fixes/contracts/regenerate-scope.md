# Contract: Regenerate Scope (multi-row assistant turns)

**Feature**: 035-micro-thoughts-fixes | **Extends**: 029
`persistence-and-display.md` display contract (anchored rows) and the US5 regenerate
reveal gate (`MessageList.svelte:72–83` comment). No 029 contract text is contradicted;
this contract defines the gate + delete semantics for multi-row turns.

## Gate: `lastRegeneratableAssistantId`

New pure export in `src/lib/chat/entries.ts`:

```ts
export function lastRegeneratableAssistantId(timeline: TimelineItem[]): string | null;
```

Rules (evaluated on the assembled timeline, generation idle — `MessageList` keeps its
`streaming`/empty guards and delegates the tail walk to this helper):

1. Scan from the timeline end backwards while items are durable `reasoning` entries whose
   metadata `anchored === true` — skip them (a trailing anchored thought is part of the
   last assistant turn).
2. The first non-skipped item must be a durable `assistant_message` → return its `entry.id`.
3. Anything else (trailing unanchored/legacy reasoning, tool group, choices, live tail,
   user message, empty timeline) → `null` (no regenerate — matches today's behavior
   outside the new case).

`MessageList.svelte` `lastAssistantId` (lines 79–83) becomes a thin delegation; the
`canRegenerate` prop plumbing to `AssistantMessage` is unchanged.

## Delete: `deleteLastAssistantTurn`

New method on `ChatState` (`src/lib/stores/chat.svelte.ts`):

```ts
async deleteLastAssistantTurn(
    assistantRowId: string
): Promise<{ userText: string; attachments: ComposerAttachment[] } | null;
```

Rules:

1. Locate `assistantRowId` in `this.messages`; unknown id → `null` (no-op).
2. Walk back to the nearest `role === 'user'` row; capture its `content` as `userText` and
   `attachmentsOf(row)` as `attachments` (018 US1 image re-send, unchanged).
3. Delete EVERY message strictly after that user row (all kinds: reasoning,
   assistant_message, self_corrected, tool_call, tool_result, approval/sampling/
   elicitation, choices) via `repos.messages.delete`, then update `this.messages`.
4. No previous user row → delete everything from the row's position onward (top-of-chat
   assistant turn; degenerate, kept for totality).

The route handler `onRegenerate` (`src/routes/chat/[id]/+page.svelte:579–597`) delegates
to this method and re-sends when it returns a payload. Deleting tool rows whole avoids
orphan tool-result timeline entries (research D3).

## Acceptance hooks

1. `[user, reasoning(anchored), text, reasoning(anchored, trailing)]` → gate returns the
   text row's id (fail-first via `assembleTimeline` fixtures in `entries.test.ts`).
2. Regenerate on that turn → all three assistant-side rows deleted, user row kept, turn
   re-sent (fail-first store test).
3. `[user, text, reasoning(UNanchored, trailing)]` → gate returns `null` (legacy repair
   semantics unchanged — `reorderTurn` already splices unanchored rows pre-answer).
4. Single-row turn (text last) → identical behavior to today (gate + delete-one ≡
   delete-whole-turn).
