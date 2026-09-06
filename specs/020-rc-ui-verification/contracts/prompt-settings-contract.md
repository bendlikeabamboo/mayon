# Contract: Generation prompt settings (read-only contract + custom instructions)

**Feature**: `020-rc-ui-verification` | **Owner**: product (`src/lib/ai/generate/*`, `QuizPromptConfig.svelte`, `LabPromptConfig.svelte`)

This is the feature's one deliberate product change. It defines how quiz and lab generation prompts are assembled, stored, and surfaced in settings.

## Prompt assembly

```text
effective system prompt = CONTRACT
                        + (instructions ? "\n\n# Custom instructions\n" + instructions : "")
```

- **CONTRACT** is code-owned: the contract sections of `DEFAULT_QUIZ_PROMPT` / `DEFAULT_LAB_PROMPT` (output shape + exact-structure example) and the `json` tool descriptions. It is never read from settings and never rendered editable.
- **instructions** are user-authored free text, always appended AFTER the contract, never prepended, never interposed, never replacing any part of the contract.

## Settings KV keys (`settings` table via `repos.settings`)

| Key | Write path | Read path | Meaning |
|-----|-----------|-----------|---------|
| `quizInstructions` | QuizPromptConfig textarea (save on blur; empty → delete key) | `readQuizPrompt` assembly | quiz custom instructions |
| `labInstructions` | LabPromptConfig textarea (same) | `readLabPrompt` assembly | lab custom instructions |
| `quizPrompt`, `labPrompt` | *(no write path remains)* | one-time migration | LEGACY whole-prompt overrides |

### Legacy migration (one-time, idempotent, on read)

When assembling, if the legacy key (`quizPrompt`/`labPrompt`) has a non-empty value and the corresponding instructions key is absent: write the legacy value to the instructions key, delete the legacy key, and use the instructions key thereafter. Embedded old contract text inside migrated instructions is inert (the contract comes from code and precedence in assembly is fixed).

## Settings UI behavior (`/settings` → quiz / lab prompt config)

1. **View**: a settings affordance shows the full **effective** prompt — contract (read-only rendering) plus any custom instructions — regardless of whether instructions exist (replacing today's default-only `<details>` block).
2. **Edit**: only the instructions textarea is editable. The contract section is not editable through any UI path (no textarea bound to it, no override key that can carry it).
3. **Attach instructions**: instructions save on blur to `quizInstructions`/`labInstructions`; clearing the field deletes the key (falls back to contract-only).
4. **Reset**: "Reset instructions" clears the instructions key only; there is no control that alters the contract.

## Invariants (assertable)

- I1: For any instructions value (including adversarial text that embeds contract-like content), the contract section of the assembled prompt is byte-identical to the shipped constant, and instructions appear only in the trailing `# Custom instructions` block.
- I2: With no instructions, the assembled prompt equals the contract exactly.
- I3: After migration, the legacy keys no longer exist and re-reading is stable (no re-migration churn).
- I4: The mock's classification markers (see [mock-llm-protocol.md](./mock-llm-protocol.md)) are present in every assembled generation prompt regardless of instructions.
