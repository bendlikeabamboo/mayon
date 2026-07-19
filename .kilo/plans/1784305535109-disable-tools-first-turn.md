# Plan: Disable all tools on the first turn of a fresh chat

## Goal
On the very first user message of a brand-new root chat, the assistant must
orient the learner conversationally — it gets **zero tools** and an explicit
orientation instruction. All subsequent turns behave exactly as today.

## Decisions (confirmed with user)
1. **Scope** — "first turn" = `isFirstRootTurn` (already computed in
   `chat.svelte.ts:220-224`): root chat (`parentId === null`), title still
   `DEFAULT_TITLE`, no prior user/assistant messages. Branched children are
   unaffected (their first message is a mid-lesson continuation).
2. **Enforcement** — hard disable: pass an empty tool set to the LLM for that
   turn. Tool calls become impossible, not merely discouraged.
3. **Guidance** — inject a first-turn-only orientation note into the system
   prompt (the existing `buildCapabilitiesPreamble()` is auto-suppressed when
   tools are off, so no conflict).

## Non-goals / accepted trade-offs
- `save_brief` cannot be invoked on turn 1. This is fine: brief *inference*
  still runs via the separate parallel side-call `inferBriefRoot`
  (`chat.svelte.ts:264-268`), and `save_brief` becomes available on turn 2.
  `disabledToolsForBrief()` already disables `save_brief` once a brief exists,
  so behavior stays consistent.
- A turn-1 request that obviously needs a tool (e.g. "search the web for X")
  will be answered conversationally / with orientation; the tool runs on turn
  2. This is the intended UX per the user's request.
- MCP tools and `mcp_read_resource` are also disabled on turn 1 (they live in
  the same tool set). No special-casing needed.

## Changes

### 1. `src/lib/chat/brief.ts` — add orientation preamble
Add an exported helper next to `buildCapabilitiesPreamble()` (after line 283):

```ts
/**
 * First-turn-only system note. Appended when this is the orientation turn of a
 * fresh root chat (tools are intentionally unavailable this turn). Pure string;
 * the loop joins it into `system`.
 */
export function buildFirstTurnOrientationPreamble(): string {
	return [
		'This is the first turn of a new chat, so you have no tools this turn.',
		'Orient the learner first: acknowledge what they want to learn, set expectations for how you will work together, and briefly outline the path ahead.',
		'Do not jump into producing artifacts, quizzes, labs, or web searches yet — those become available on the next turn.',
		'Keep it short, warm, and conversational; invite them to begin.'
	].join('\n');
}
```

### 2. `src/lib/agent/loop.ts` — accept a `firstTurn` flag and wire it in
- **`AgentTurnDeps`** (interface at line 16): add `firstTurn?: boolean;` (next
  to `disabledToolIds?` at line 50).
- **`runAgentTurn`** (line 183): rename the line-184 capability computation so
  the first-turn override is explicit. Replace
  ```ts
  const toolCapability = deps.config.toolCapability && !isSessionDisabled();
  ```
  with
  ```ts
  const baseCapability = deps.config.toolCapability && !isSessionDisabled();
  const toolCapability = baseCapability && !deps.firstTurn;
  ```
  (This intentionally leaves the pre-existing `deps.config.toolCapability`
  truthiness quirk untouched — out of scope.)
- **`inner()`** (around line 204-206): after the existing
  `if (toolsEnabled) { sysParts.push(buildCapabilitiesPreamble()); }`, add:
  ```ts
  if (deps.firstTurn) {
      sysParts.push(buildFirstTurnOrientationPreamble());
  }
  ```
  Add `buildFirstTurnOrientationPreamble` to the existing `import { buildCapabilitiesPreamble } from '$lib/chat/brief';`
  at line 7.

The `toolCapability` flag is already what gates `inner(true)` vs `inner(false)`
(lines 538-557), so forcing it false on the first turn routes correctly to
`inner(false)` (no tools). The safety-net retry path (`inner(false)` at line
551) is unreachable when `firstTurn` is true and is left unchanged.

### 3. `src/lib/stores/chat.svelte.ts` — pass the flag
In the `runAgentTurn({...})` call (starts line 315), add `firstTurn` alongside
`disabledToolIds` (line 322-326):
```ts
firstTurn: isFirstRootTurn,
disabledToolIds: [ ...same as today... ],
```
`isFirstRootTurn` is computed at line 220-224 before the user row is appended,
so it correctly flags this `send()` as the orientation turn. No other change
needed here — turn 2 has `isFirstRootTurn === false`, so tools re-enable.

## Validation

### Automated
- `src/lib/agent/loop.test.ts`:
  - Extend the `vi.mock('$lib/chat/brief', ...)` (line 87-89) to also export
    `buildFirstTurnOrientationPreamble: vi.fn(() => 'orientation')`.
  - Add a test: with `firstTurn: true` in `AgentTurnDeps`, assert `streamText`
    was called with `tools` being an empty object (`{}`) AND the `system`
    string contains the orientation marker. Confirm it is called exactly once
    with tools disabled (no tool-enabled retry).
  - Add/keep a test: with `firstTurn` absent (or false) and the provider
    tool-capable, `streamText` is called with the non-empty tool set as today
    (regression guard).
- `src/lib/chat/brief.test.ts`: add a tiny test asserting
  `buildFirstTurnOrientationPreamble()` returns a non-empty string mentioning
  orientation/first turn (guards copy regressions).
- Run gates (root): `pnpm lint && pnpm check && pnpm test`.
- Server tests unaffected: `pnpm --filter @mayon/server test` (no server
  changes; run only if touching shared types, which this plan does not).

### Manual acceptance
- `pnpm dev:deps && pnpm dev` → start a **new** chat → send a first message.
  Confirm: the reply is conversational/orienting, no tool chip/toast/approval
  dialog appears, and DevTools (or the diagnostics trace) shows the LLM request
  with an empty `tools` array and a `system` containing the orientation note.
- Send a **second** message in the same chat → confirm tools are available
  again (e.g. the assistant can call `read_checklist`/MCP tools as before, and
  the capabilities preamble is back in the system prompt).
- Open a **branched child** chat → send its first new message → confirm tools
  remain enabled (not treated as an orientation turn).
- Server-down behavior is unchanged (this is a client-side agent-loop change).

## Risks / notes
- The change is localized to one new flag flowing from the chat store through
  the agent loop; no schema, persistence, or server changes.
- The orientation copy is the user-approved wording; tweak freely without
  behavioral impact.
- If a provider returns an error specifically because tools were stripped, the
  existing safety net does not re-enable tools here (and shouldn't on turn 1).
  The first-turn path skips the safety net entirely, so no regression.
