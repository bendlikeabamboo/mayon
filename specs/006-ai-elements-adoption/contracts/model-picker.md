# Contract — Model Picker

UI component contract for the P1 surface (replaces `ModelSelect.svelte`).
Consumer-facing API; implementation is Svelte but the contract is framework-agnostic
in behavior terms.

## Public surface

`src/lib/components/ai/model-select/index.ts` exports a composable family:

```ts
ModelSelect; // root: state (open, value), trigger wiring
ModelSelectTrigger; // button showing active model; opens dialog
ModelSelectDialog; // command dialog (bits-ui Command + Dialog)
ModelSelectContent; // layout group
ModelSelectInput; // type-to-filter field (autofocused on open)
ModelSelectList; // scrollable option list (max-height, virtual-free; ≤ hundreds of models)
ModelSelectItem; // option row (model id + provider name)
ModelSelectGroup; // provider grouping
ModelSelectEmpty; // empty states
```

## Behavior contract

| ID   | Contract                                                                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MP-1 | Typing in `ModelSelectInput` filters options on model id, display name, or provider label, case-insensitive; filtering is client-side and synchronous.                          |
| MP-2 | ↑/↓ move an active highlight; Enter selects the highlighted option and closes; Escape closes without changing selection.                                                        |
| MP-3 | The currently active model is always listed (prepended if missing from the discovered set) and marked selected.                                                                 |
| MP-4 | Selection dispatches `onselect(modelId)` exactly once per user confirmation and closes the picker.                                                                              |
| MP-5 | Empty list states: (a) no models configured → guidance toward provider settings (plus refresh affordance when discovery is available); (b) no filter matches → "No matches."    |
| MP-6 | The refresh affordance (`onrefresh`, spinner while `discovering`) is exposed only when the backing capability offers model discovery — parity with today's `discoverable` prop. |
| MP-7 | Works without the server runtime (local configured list); degrades to configuration-only guidance when no models exist.                                                         |
| MP-8 | Dialog traps focus while open and restores focus to the trigger on close.                                                                                                       |

## Consumers

Provider/model configuration screens and any surface currently mounting
`ModelSelect` — the exported root keeps prop compatibility
(`models`, `value`, `discoverable`, `discovering`, `onselect`, `onrefresh`) so callers
are unchanged or minimally changed.
