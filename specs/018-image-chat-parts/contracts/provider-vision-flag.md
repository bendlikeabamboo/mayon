# Contract: Provider Vision Capability Flag

**Feature**: `018-image-chat-parts` | **Status**: Draft (Phase 1)

How Mayon learns, stores, and applies "this model accepts images". Advisory by design —
permissive-with-clear-error (spec FR-006/FR-007); the gate is explicitly not omniscient.

## 1. Configuration shape (settings `providers` map)

```jsonc
// ProviderConfig (src/lib/ai/types.ts) — one new optional field
{
  "id": "p1",
  "kind": "openai-compatible",
  "name": "My Gateway",
  "baseUrl": "https://…",
  "defaultModel": "gpt-4o",
  "models": ["gpt-4o", "…"],
  "toolCapability": "auto",   // existing precedent
  "vision": "auto"            // NEW — 'auto' (default when absent) | 'on' | 'off'
}
```

- Non-secret handle field: stored in settings like the rest of `ProviderConfig`; API keys
  remain in IndexedDB (constitution: no secrets in settings — unchanged).
- Provider templates (`src/lib/ai/registry.ts`) MAY seed `vision` per template, exactly as
  they seed `toolCapability`.
- Settings UI (`src/lib/components/ai/ProviderConfig.svelte`): a three-state control next to
  the tool-capability control; absent field renders as `auto`.

## 2. Resolution contract (`src/lib/ai/vision-capability.ts`)

```ts
function supportsVision(config: ProviderConfig, modelId: string): boolean
// 'on'                       → true
// 'off'                      → false
// 'auto' (or absent)         → allowlist(modelId)
```

- `allowlist` = static prefix table of vision-capable families (seed set: `gpt-4o`, `gpt-4.1`,
  `gpt-5`, `o3`/`o4`, `chatgpt-4o`, `claude-3`, `claude-4`, `gemini-1.5`, `gemini-2`,
  `gemini-3`, `llama-3.2-vision`/`llama-4`, `qwen-vl`/`qwen2-vl`/`qvq`, `pixtral`,
  `mistral-small-3`; case-insensitive, prefix match, tuned during implementation against the
  dialects tables' conventions).
- Resolution is pure and synchronous — no network probing (no standard vision-probe endpoint
  exists across providers).

## 3. Consumer behavior

| Consumer | Rule |
|---|---|
| Composer paperclip | Visible iff `supportsVision(activeConfig, activeModel)` (FR-006) |
| Paste-with-image while paperclip hidden | Accepted (permissive): image attaches and sends; if the provider rejects it, the typed error below surfaces (FR-007) |
| Provider rejects image-bearing request (4xx) on a send that carried image parts | `formatProviderError` classifies to a dedicated image-unsupported error: clear title/message/hint ("model doesn't accept images — remove the attachment or switch models") with the existing Retry button (which restores text + attachments) |
| Any other failure on image-bearing sends | Existing error pipeline unchanged |

## 4. Compatibility rules

- Absent `vision` field on existing configs ⇒ `auto` — no migration of settings rows.
- The flag changes UI visibility and error classification only; it MUST NOT strip, block, or
  rewrite message parts on the wire (FR-004 pass-through; hard-blocking would contradict the
  permissive posture and the fuzzy-advertisement assumption).
- Model switching mid-chat is not possible today (active model = `defaultModel`), so the gate
  is evaluated per send from the active config — no per-message capability snapshot needed.
