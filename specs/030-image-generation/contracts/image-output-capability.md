# Contract: Image Output Capability Flag

**Feature**: 030 — Model-Generated Images in Chat · **Status**: Draft
**Pattern**: verbatim sibling of the 018 provider vision flag (`docs/history/appendices/018-provider-vision-flag.md`).

## Field

`ProviderConfig.imageOutput?: 'auto' | 'on' | 'off'` — a non-secret handle field in the settings KV, sibling of `vision`. Absent means `'auto'`.

## Resolver

- `supportsImageOutput(config, modelId)` — pure, synchronous, no I/O, no probing.
- `'on'` → true. `'off'` → false. `'auto'`/absent → static prefix allowlist match on the last `/` segment of the model id, case-insensitive (`IMAGE_OUTPUT_MODEL_PREFIXES`, sibling of `VISION_MODEL_PREFIXES`).
- The allowlist is a static, manually curated list of known image-output model families (updated by release, not at runtime).

## Advisory guarantees (load-bearing)

1. The flag and the allowlist MUST NOT gate, block, strip, or rewrite any request or response payload. A model wrongly believed incapable MUST still have its delivered images rendered.
2. The flag drives UI indication only: a tri-state select in the provider settings, a badge in the model-select rows, and a chat-surface indication derived per active model (following `supportsVisionModel` wiring).
3. When an image turn fails because the model truly cannot produce images, the user receives a typed, plain-language, in-conversation notice — never a raw provider error dump and never silence.

## Failure refinement

Provider 4xx/5xx on an image-bearing turn is refined to a typed error (following the `asImageUnsupported` pattern in `src/lib/ai/errors.ts`) whose message explains that the model did not produce an image and names the capability toggle. Failure presentation is contained to the affected message block.
