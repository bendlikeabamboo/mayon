# Contract: Model Discovery Filtering

**Feature**: specs/008-inference-router-templates
**Date**: 2026-08-22
**Consumers**: model picker / discovery flow (via `discoverModels` → `parseModelIds`), every discoverable provider.

## Parser contract — `parseModelIds` (`src/lib/ai/model-discovery.ts`)

`parseModelIds(body)` extracts chat-selectable model IDs from a `/models` response.
After this feature (spec FR-008 / research D7):

- **Excluded**: any entry carrying `type: "embedding"` (exact string), in both the
  OpenAI `{ data: [{ id, type? }] }` shape and bare arrays of objects. Such entries
  never reach the model picker for **any** discoverable provider.
- **Included**: entries with no `type` field, and entries with any other `type` value
  (e.g. `"chat"`, `"language"`). Untyped catalogs are provably unaffected — this is a
  one-value denylist, not an allowlist.
- **Unchanged**: string-id requirement, de-duplication, alphabetical sort, tolerance
  of bare string arrays, `[]` for unparseable/unrecognized bodies, and all
  transport/auth/error behavior of `discoverModels`.

## Rationale boundary

The exclusion is deliberately conservative: it fixes the observed problem (Vercel AI
Gateway's catalog mixes embedding models into `/v1/models`) without over-filtering
catalogs that don't set `type` (OpenRouter, Kilo Gateway, Zen, LiteLLM, Groq, …).
Wider denylists (`image`, `video`, `audio`, `rerank`, …) or a chat-type allowlist are
explicitly rejected until observed in the wild (spec User Story 5 scenario 2).
