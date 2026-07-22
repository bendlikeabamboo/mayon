# Gates (tool-based) + Thought Process (double-box fix)

Two independent fixes from `refinement/2026-07-20_user_feedback.md`: the **Gates**
item (replace fence parsing with a tool) and the **Thought Process** item (fix the
double-box / wrong-layout bug during streaming). The "LLM Summary" item is covered
by a separate plan (`1784518999313-expound-provide-summary-toggle.md`) and is out of
scope here.

## Context

### Thought Process
While streaming, `MessageList.svelte:86-96` renders the `Reasoning` component **and**
its own duplicate reasoning box. `Reasoning.svelte` defaults to `inline=false`, so it
emits `[button, box]` as sibling fragments; dropped inside the horizontal row
`<div class="flex w-full items-center">` (`MessageList.svelte:77`), that box lands
**to the right** of the button. `MessageList` then renders a **second** box below the
row (`:90-96`). Result: two boxes, one misplaced — exactly the user's report. The
persisted path (`MessageRow.svelte:98-120`) already uses `inline` correctly.

### Gates
Six strategies (`guided-curriculum`, `deep-dive`, `quick-orientation`, `workshop`,
`tutorial`, `pair-programming`) set `gated: true` and append `GATE_INSTRUCTION` /
`BUILD_GATE_INSTRUCTION` (`strategies.ts:45,47`) telling the model to emit a
```` ```gate ```` fence tail. `stripGateFence` hides it on render
(`MessageList.svelte:99`, `MessageRow.svelte:131`); `extractGateBlock` parses it for
the Composer choice chips (`+page.svelte:210` → `suggestedReplies` `:220`). The
visible `gate\n{"nextUnit":…}` the user saw is the parser failing on a
```` ```\ngate ```` variant (newline between backticks and `gate`) — the regex
`/```gate/` in `generate-gate.ts:17,61,110` does not match it, so the fence renders
as a plain code block whose first line is the literal word `gate`.

Tool-call args are already persisted on the assistant tool-call message's `metadata`
as JSON (`chat.svelte.ts:341-346`), so a gate tool's args are retrievable for the UI.

## Locked decisions (from user)

- **Gate turn architecture**: add a **`terminal` tool** concept to the agent loop —
  `present_choices` is marked terminal, and the loop returns after running it (no
  follow-up model call). Avoids one wasted inference per gated turn and the redundant
  "here are your choices" closing bubble.
- **Old fence data**: **keep `stripGateFence` in the render path** so existing
  ```gate messages stay hidden, **and** extend the parser to handle the
  ```` ```\ngate ```` variant so old data and any stray fences render clean.
- **Thought Process scope**: **fix the double-box / layout bug only**. No open-state
  continuity across the streaming→final transition.
- Primary lever for Gates is **prompt engineering** (rewrite the gate instruction to
  tell the model to call the tool), per the user's "lean towards prompt engineering."

## Scope

**Touches:** `src/lib/components/chat/MessageList.svelte`,
`src/lib/components/chat/Reasoning.svelte` (no change expected),
`src/lib/chat/strategies.ts`, `src/lib/ai/generate/generate-gate.ts`,
`src/lib/ai/generate/generate-gate.test.ts`, `src/lib/agent/registry.ts`,
`src/lib/agent/deterministic-tools.ts`, `src/lib/agent/loop.ts`,
`src/lib/agent/loop.test.ts`, `src/routes/chat/[id]/+page.svelte`,
`src/lib/components/chat/MessageRow.svelte`, `src/lib/components/chat/Composer.svelte`
(no change expected — already has the `progress` prop).

**Does not touch:** schema, migrations, `branch-sources`, the brief/quiz/lab
`extractFencedJson` pipeline (those are separate fenced-JSON parsers that stay), the
critic, MCP, providers, `strategy-lint.ts` body (it already calls `stripGateFence`
and keeps working — a no-op once fences stop, still correct for old data).

**Accepted known limitations (out of scope):**
- Reasoning from a turn that mixes a non-terminal tool with a later terminal
  `present_choices` is attached to the terminal text message (accumulated across
  iterations) — consistent with today's "all reasoning on the final message" design.
- Old gated chats: chips fall back to static `activeStrategy.replies` (the gate is
  no longer parsed from raw text for chips). `stripGateFence` still hides the fence
  in the rendered prose, so old messages look clean.

---

## Part A — Thought Process (double-box fix)

### A1. `src/lib/components/chat/MessageList.svelte`

The streaming block renders the `Reasoning` component in non-inline mode (emitting
its own box into the horizontal row) **plus** a separate duplicate box below. Switch
the streaming usage to `inline` (button only) so the single existing box below the
row is the only one — matching the persisted `MessageRow` pattern.

- Line 87: add `inline` to the props:
  ```svelte
  <Reasoning reasoning={reasoningBuffer} live inline bind:open={liveReasoningOpen} />
  ```
- The existing `{#if reasoningBuffer && liveReasoningOpen}` box block (`:90-96`)
  becomes the **only** box and stays where it is (below the persona/reasoning row,
  above the reply bubble). Do not remove it.
- No change to `Reasoning.svelte` — its `inline` branch already renders only the
  button (`:14-33`), and the non-inline branch (`:34-40`) is now only used by
  callers that place it in a vertical context (there are none after this change, but
  leaving the branch is harmless and lower-risk than removing it).

**Result:** one box, directly below the "Thought process" button, above the reply.

---

## Part B — Gates (tool + prompt engineering + parser fix)

### B1. Parser fix — `src/lib/ai/generate/generate-gate.ts`

Extend the fence regexes to accept whitespace (including a newline) between the
triple backticks and the `gate`/`json` tag, so ```` ```\ngate ```` and
```` ``` gate ```` are recognized the same as ```` ```gate ````.

- `GATE_FENCE_RE` (`:17`): `/```(?:gate|json)\s*\n?/i` → `/```\s*(?:gate|json)\s*\n?/i`.
- `stripGateFence` first branch (`:61`): `raw.indexOf('```gate')` is too literal.
  Replace with a regex test that tolerates whitespace between backticks and `gate`:
  ```ts
  const gateOpen = raw.match(/```\s*gate\b/i);
  if (gateOpen && gateOpen.index !== undefined) {
      return raw.slice(0, gateOpen.index).trimEnd();
  }
  ```
  (Keep the subsequent ```json-fence and trailing-bare-JSON fallbacks unchanged —
  they already use `GATE_FENCE_RE` / `TRAILING_GATE_RE`.)
- `extractFencedBlock` `gate` branch openRegex (`:110`):
  `/```gate\s*\n?/i` → `/```\s*gate\s*\n?/i`.
- `extractFencedBlock` default openRegex (`:112`): `/```(?:json)?\s*\n?/i` → leave
  as-is (it has no tag, already lenient).

### B2. Parser tests — `src/lib/ai/generate/generate-gate.test.ts`

Add cases (mirror existing ones with the ```` ```\ngate ```` shape):
- `extractGateBlock`: parses a trailing ```` ```\ngate\n{...}\n``` ```` block.
- `extractGateBlock`: parses a ```` ``` gate ```` (space-separated) block.
- `stripGateFence`: returns the prose prefix for a ```` ```\ngate ```` block.
- `stripGateFence`: strips a ```` ```\ngate ```` block that has trailing text after
  the close fence (mirrors the existing "strips at the first occurrence only" case).

### B3. `terminal` tool concept — `src/lib/agent/registry.ts`

- Add `terminal?: boolean` to `ToolDefinition` (`:9-15`):
  ```ts
  export interface ToolDefinition {
      id: string;
      description: string;
      parameters: Record<string, unknown>;
      risk: ToolRisk;
      generative: boolean;
      /** When true, the agent loop ends the turn after running this tool (no
       *  follow-up model call). Use for pure-presentation tools whose result is
       *  for the UI, not for the model to act on. */
      terminal?: boolean;
  }
  ```

### B4. The `present_choices` tool — `src/lib/agent/deterministic-tools.ts`

Add a new readonly, terminal tool. Its `run` is a no-op signal: the args are already
persisted on the assistant tool-call message's `metadata` (the UI reads them there),
so `run` just echoes a summary.

```ts
{
    def: {
        id: 'present_choices',
        description:
            'Present pacing choices to the learner as tappable chips (e.g. after a unit or step). ' +
            'Call this instead of emitting the choices as a fenced block or raw JSON. ' +
            'The options appear as reply chips under the composer.',
        parameters: toolSchema({
            nextUnit: { type: 'string', description: 'Title of the next unit or step.' },
            options: {
                type: 'array',
                items: { type: 'string' },
                description: '2–3 short option labels (e.g. ["continue","go deeper"]).'
            },
            progress: {
                type: 'string',
                description: 'A short progress label (e.g. "Unit 2 / 5" or "Step 3 / 8").'
            }
        }),
        risk: 'readonly',
        generative: false,
        terminal: true
    },
    async run(args, _ctx): Promise<ToolResult> {
        const a = args as { nextUnit?: string; options?: string[]; progress?: string };
        const opts = (a.options ?? []).join(', ');
        return {
            ok: true,
            summary: `Next: ${a.nextUnit ?? '—'} (${opts})`,
            detail: { nextUnit: a.nextUnit, options: a.options, progress: a.progress }
        };
    }
}
```

Register it by adding to the `deterministicTools` array (already iterated by
`registry.ts:244`). Risk `readonly` ⇒ auto-runs silently (no approval, no toast —
`loop.ts:408-410` only toasts `low`). `terminal: true` ⇒ the loop returns after it
(B6).

### B5. Prompt engineering — `src/lib/chat/strategies.ts`

Replace the two fence instructions with tool-call instructions. Keep the prose
pacing gate inside each block (the "Ready for Unit N? Reply continue…" line) — it is
human-readable and is the fallback when a provider lacks tool support.

- `GATE_INSTRUCTION` (`:45`) becomes:
  ```
  To surface pacing choices to the learner, call the `present_choices` tool with
  { "nextUnit": "<title>", "options": ["continue","go deeper"], "progress": "Unit 2 / 5" }.
  The app renders the options as reply chips; they are never shown as text. If you do
  not have that tool, rely on the prose pacing gate above. Never emit the choices as a
  fenced code block or as raw JSON.
  ```
- `BUILD_GATE_INSTRUCTION` (`:47`) becomes the same shape with the build-mode option
  hints (`["next","paste the error"]`, `"Step 2 / 8"`).
- Both keep the `${FENCE3}` constant only if still referenced elsewhere in the file;
  otherwise the `BT`/`FENCE3` helpers (`:42-43`) can stay (harmless) to avoid
  touching unrelated lines.

### B6. Loop: end turn after terminal tools — `src/lib/agent/loop.ts`

Two coordinated changes inside `inner()`:

1. **Persist reasoning on terminal turns.** Compute `allTerminal` *before* the text
   is persisted (`:348`) so the text message can carry this turn's reasoning. Today
   the text at `:349` is persisted without reasoning (reasoning is attached only to
   the final no-tool message at `:334-336`). For terminal turns there is no later
   "final" message, so reasoning would be lost — attach it here instead. Because the
   loop returns immediately after a terminal turn, there is no duplication risk and
   the existing reasoning test (`loop.test.ts:974-1010`, which uses non-terminal
   `read_checklist`) stays green.

   ```ts
   // around :346, after hasGenerative is computed
   const allTerminal =
       toolCalls.length > 0 &&
       toolCalls.every((tc) => getToolDefinition(tc.toolName)?.terminal === true);

   if (buf && !hasGenerative) {
       const msg = await deps.appendAssistantText(buf, allTerminal ? { reasoning: reasoningBuf || undefined } : undefined);
       deps.onTrace?.({ kind: 'persisted', messageId: msg.id, finalText: buf, empty: false });
   }
   ```

2. **Break after terminal tools.** After tool results are appended and the aborted
   check (`:525-528`), return instead of continuing:

   ```ts
   // after :528 (the `if (aborted) { ... }` block), before `buf = '';` at :530
   if (allTerminal) {
       return { aborted: false };
   }
   ```

   The text was already persisted at step 1; tool calls (`:357-363`) and results
   (`:504-523`) are already appended. Return cleanly with no follow-up `streamText`.

   Note: the markdown critic (`runCriticPhase`) is intentionally **not** run on
   terminal turns (it only runs in the no-tool branch `:333` and the
   `MAX_ITERATIONS` fallback `:535`). Consistent with "render the prose as-is."

### B7. Loop test fixture — `src/lib/agent/loop.test.ts`

- Add a `present_choices` entry to the mocked `toolDefs` array (`:42-71`) with
  `risk: 'readonly'`, `generative: false`, `terminal: true`.
- New test in the `(t) reasoning` describe block (or a new `(u) terminal tools`
  block):
  - **Terminal tool ends the turn with no second `streamText` call.** Script one
    `fullStream` yielding `text-delta("prose")` + `tool-call(present_choices)` +
    `finish(tool-calls)`. Assert `mockedStreamText` called once,
    `deps.appendAssistantText` called once with `'prose'` and
    `opts.reasoning` populated (script a `reasoning-delta` before the text),
    `deps.appendAssistantToolCall` called once, `mockedToolsRun` called once.
  - **Mixed terminal + non-terminal does not short-circuit.** Script
    `tool-call(read_checklist)` + `tool-call(present_choices)` in one stream; assert
    the loop continues (`mockedStreamText` called again).
  - **Existing `(t) reasoning` test stays green** (non-terminal `read_checklist` →
    interim text has no reasoning, final reply carries all reasoning).

### B8. Gate derivation from tool call — `src/lib/ai/generate/generate-gate.ts` + `src/routes/chat/[id]/+page.svelte`

Add a helper that scans the last assistant turn (messages after the last user
message) for a `present_choices` tool-call assistant row and parses its `metadata`:

```ts
// in generate-gate.ts
export function findGateFromMessages<
    T extends { role: string; toolName?: string | null; metadata?: string | null }
>(messages: readonly T[]): GateBlock | null {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role === 'user') break;
        if (m.role === 'assistant' && m.toolName === 'present_choices' && m.metadata) {
            try {
                const result = GateBlockSchema.safeParse(JSON.parse(m.metadata));
                if (result.success) return result.data;
            } catch {
                /* ignore malformed */
            }
        }
    }
    return null;
}
```

- Add unit tests in `generate-gate.test.ts`: finds the gate from a
  `present_choices` tool-call row; returns null when the only such row is before the
  last user message; returns null on malformed metadata; returns null when absent.
- In `+page.svelte:210`, replace `extractGateBlock(lastAssistantRaw())`:
  ```ts
  const gate = $derived(
      activeStrategy?.gated ? findGateFromMessages(chatStore.messages) : null
  );
  ```
  Drop the now-unused `lastAssistantRaw` derived (`:203-208`) and the
  `extractGateBlock` import (`:35`) if nothing else uses them (grep confirms
  `lastAssistantRaw` is only used by the gate line). Keep the `findGateFromMessages`
  import. `suggestedReplies` (`:220`) is unchanged and now pulls from the tool.
- `extractGateBlock` and its tests stay (harmless; not on the live path). Do **not**
  remove — avoids churn and keeps `stripGateFence`'s sibling available if needed.

### B9. Wire `progress` to the Composer — `src/routes/chat/[id]/+page.svelte`

The Composer already accepts a `progress?: string | null` prop (`Composer.svelte:52`,
rendered at `:256-267`) but `+page.svelte` never passes it (dead today). Thread it:

```svelte
<Composer
    ...
    {suggestedReplies}
    progress={gate?.progress ?? null}
    ...
/>
```

### B10. Hide the `present_choices` tool-result row — `src/lib/components/chat/MessageRow.svelte`

The tool **call** (assistant, `content=''`, `toolCallId` set) is already hidden
(`:79-80`). The tool **result** (`role='tool'`) renders as a muted label (`:81-90`).
For `present_choices` the result is redundant with the Composer chips, so hide it.
Add an early branch alongside the existing hidden-tool-call branch:

```svelte
{#if message.role === 'assistant' && message.toolCallId != null && message.content === ''}
    <!-- empty tool-call bookkeeping row, hidden -->
{:else if message.role === 'tool' && message.toolName === 'present_choices'}
    <!-- presentation-only tool result; choices surface as composer chips -->
{:else if message.role === 'tool'}
    ...existing tool-row render...
```

---

## Validation

- `pnpm lint && pnpm check && pnpm test` (root) green — covers: parser tests
  (B2), `findGateFromMessages` tests (B8), loop terminal-tool tests (B7),
  existing reasoning test still green.
- `pnpm --filter @mayon/server test` green (no server changes expected; run as a
  regression guard).
- **Manual — Thought Process:** `pnpm dev` → start a reply that emits reasoning
  tokens (reasoning effort on/deep) → click "Thought process" mid-stream → exactly
  **one** box appears, directly **below** the button, above the reply bubble. No box
  to the right of the button.
- **Manual — Gates:** `pnpm dev` → a gated strategy chat (e.g. Guided curriculum)
  with a tool-capable provider → after a unit reply, the model calls
  `present_choices` (visible in Diagnostics) → the reply bubble shows clean prose
  with **no** `gate\n{...}` cruft at the bottom; the Composer shows the choice chips
  and the progress label (e.g. "Unit 2 / 5"); no redundant "here are your choices"
  bubble follows; Diagnostics shows a single `streamText` call for the turn.
- **Manual — Gates (non-tool provider):** repeat with a provider whose
  `toolCapability` is false → the model emits the prose pacing gate ("Ready for Unit
  N? …") and **no** fence; chips fall back to the strategy's static `replies`.
- **Manual — Gates (old data):** open an existing chat whose assistant messages
  contain a legacy ```gate fence → the fence stays hidden in the rendered prose
  (parser fix covers the ```` ```\ngate ```` variant too).

## Risks / notes

- **Terminal-tool loop change** is the highest-risk edit. The `allTerminal` gate is
  computed once before text persist and re-used after tool results; both references
  must agree. If a turn has any non-terminal tool call, `every` is false and behavior
  is unchanged. Covered by B7 tests.
- **Reasoning persistence on terminal turns** (B6 step 1) attaches the accumulated
  `reasoningBuf` to the terminal turn's text message. This is correct (matches the
  "all reasoning on the final message" intent) and does not affect non-terminal turns
  (existing test `loop.test.ts:974-1010` asserts interim text has no reasoning;
  `read_checklist` is non-terminal so `allTerminal` is false there).
- **`present_choices` is provider-gated**: only tool-capable providers see it. The
  prompt explicitly tells the model to fall back to the prose gate when the tool is
  absent, so non-tool providers degrade to text pacing + static chips.
- The markdown critic is skipped on terminal turns (B6 note). If a gate turn's prose
  has broken markdown (e.g. an unclosed Mermaid block), it renders as-is. Acceptable
  per the user's "render as-is" philosophy; the critic still runs on ordinary
  (non-tool) turns.
- `extractGateBlock` is now off the live path but retained with its tests to avoid
  churn and keep `stripGateFence`'s sibling available. Old gated chats' chips fall
  back to static `activeStrategy.replies` (same default labels the model would emit).
