# Contract: Request Trace Fidelity

**Seam**: `src/lib/agent/loop.ts` (emission site) + `src/lib/agent/trace.ts` (types/storage). Consumer: diagnostics views reading `agent_traces.trace`. Governs FR-008.

## Rules

1. **Mirror the wire**: the `request` trace event's `messages` are the **projected** payload (`projectEntries(ctx)` result actually passed to `streamText`) — never the raw context rows. One-to-one: same order, same roles, same content parts.
2. **System exactly once**: no `role: 'system'` rows in `messages` (projection excludes them); the system prompt lives solely in the `system` field. A viewer concatenating `system` + `messages` reproduces the wire request with no duplication.
3. **Tool identity preserved**: each traced message may carry `toolCallId?`, `toolName?`, `kind?` annotations (additive; source-row kind for assistant rows). A choices or tool interaction must be identifiable as such — never a bare text turn.
4. **Backward compatible**: annotations are optional; previously stored traces (without them) remain valid and renderable.
5. **Projection untouched**: this contract changes only what is _logged_, never what is _sent_ — golden equivalence tests pass unmodified.

## Shape

```ts
// trace.ts — widened additively
interface TracedRequestMessage {
	role: string; // 'user' | 'assistant' | 'tool' (post-projection)
	content: string; // text content of the projected message
	toolCallId?: string; // tool-call / tool-result messages
	toolName?: string;
	kind?: string; // source row kind ('choices' | 'tool_call' | 'tool_result' | …)
}
```

## Regression bars

1. Captured trace for a turn containing a choices offer + tool call: zero `role: 'system'` entries in `messages`; system string appears exactly once in the event; the choices row carries `kind: 'choices'`/tool identity (not a bare assistant text) — fails on current code, which logs raw ctx rows.
2. Traced message sequence equals `projectEntries(ctx)` for the same fixture (order and roles).
3. Critic/budget iterations trace their own projected requests (each iteration logs its actual payload).
