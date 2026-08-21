# Contract: Context Projection (entries → ModelMessage[])

The single seam through which stored entries reach any provider. Pure function; replaces `toCoreMessages` (deleted). Consumers: `assembleContext` (turn reassembly) and the critic's in-memory correction context.

## Signature

```ts
projectEntries(entries: readonly Entry[]): ModelMessage[]
```

Pure: no I/O, no repos, no clock. The ancestor-gathering walk (branch cutoffs, brief/excerpt/attachment notes) stays in `assembleContext`, unchanged; only the per-row conversion moves here.

## Per-kind projection rules

| kind                                                       | rule                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_message`                                             | `user` message, single text part (`content`). Hidden rows project identically — the provider sees hidden prompts today and must continue to.                                                                                                                                                                                                                                                                         |
| `assistant_message`                                        | `assistant` message, single text part. `metadata.reasoning` (legacy) is ignored, exactly as today.                                                                                                                                                                                                                                                                                                                   |
| `reasoning`                                                | **excluded** (never provider-visible; matches today, where embedded reasoning was never sent).                                                                                                                                                                                                                                                                                                                       |
| `tool_call`                                                | `assistant` message with a `tool-call` part (`toolCallId`, `toolName`, `input: {}`). **Captured quirk**: the current gather step never populates `toolArgs`, so providers receive empty input on replay today; golden equivalence (SC-004) requires reproducing this exactly. `metadata.args` exists on the row but is NOT replayed — flag, don't fix (fixing would change provider context).                        |
| `tool_result`                                              | `tool` message with a `tool-result` part; `output` from `metadata.detail` via the existing JSON→`json` / text→`text` typing rule.                                                                                                                                                                                                                                                                                    |
| `approval` / `sampling` / `elicitation` / `self_corrected` | **excluded** — audit records only.                                                                                                                                                                                                                                                                                                                                                                                   |
| `choices`                                                  | **synthesized pair** (D4): an `assistant` `tool-call` part (`toolName='present_choices'`, `input: {}` — byte-identical to the legacy pair replay) followed by a `tool` `tool-result` part (text output "options presented"). For legacy chats the stored `tool_result` row (rule 4 of the backfill) projects through the normal `tool_result` rule, so both storage shapes yield the same provider-visible sequence. |

## Merging rule (carried over exactly)

Adjacent output messages of the same role merge their parts (e.g. `tool_call` assistant message + following `assistant_message` text, consecutive tool results). This reproduces `toCoreMessages`'s merge pass byte-for-byte; message boundaries are provider-visible and golden-locked.

## Golden test contract

1. **Fixture corpus** (captured from the _current_ `toCoreMessages` before the rewrite): plain turns; multi-iteration tool turns (call + JSON result, call + text result); legacy `present_choices` pair + tapped chip; hidden prompt turns; branch-walk ordering (ancestor cutoff); adjacent-merge shapes.
2. **Assertion**: `projectEntries(fixtureEntries)` deep-equals the captured `ModelMessage[]` for every fixture — 100% pass, zero diffs (spec SC-004).
3. **New-shape tests**: new-turn `choices` entry (no stored pair) must produce the same provider-visible sequence as the legacy pair; ask/critic/reasoning kinds must produce nothing.
4. The critic path (`loop.ts`) switching to `projectEntries` is covered by existing loop tests asserting provider request shapes.
