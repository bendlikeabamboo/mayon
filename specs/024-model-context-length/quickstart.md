# Quickstart: Automatic Model Context Lengths — Validation Guide

**Branch**: `024-model-context-length` | **Date**: 2026-10-07 | **Plan**: [plan.md](./plan.md)

Runnable proofs that the feature works end-to-end. Prerequisites: dev stack up
(`pnpm dev` → web on http://localhost:5173), plus gates green:

```bash
pnpm check && pnpm lint && pnpm test
```

All new behavior has unit/contract coverage; the scenarios below are the human-verifiable
layer on top.

## Scenario 1 — Capture & zero-config gauge (spec Story 1)

Proves FR-001/FR-002: OpenRouter reports `context_length`; the gauge uses it with no manual
entry.

1. Settings → add the **OpenRouter** provider template, save an API key (or rely on the
   public listing).
2. Wait for/strike the ⟳ refresh on the provider card; pick any model with a known window
   (e.g. a 128K model) as default.
3. Open any chat and send one message.

**Expected**: the context gauge (Composer status row) shows `used / limit (pct)` — not
"window unknown" — and the popover Window row attributes the limit to the **provider model
listing**. No value was typed anywhere.

## Scenario 2 — Unknown stays unknown; user override wins (spec Story 2)

Proves FR-003/FR-004/FR-005.

1. Add a provider whose listing carries no context field (e.g. **GitHub Copilot**), pick a
   model not in the static catalog, open a chat.
2. **Expected**: gauge shows consumption with "window unknown" — no invented limit.
3. On that provider's settings card, set **Context window (tokens)** to e.g. `200000`.
4. **Expected**: the gauge now uses 200000 and the popover attributes it to the provider
   card (user-declared beats provider-listed).
5. Clear the field → the captured/catalog/unknown ladder re-applies.

## Scenario 3 — Freshness (spec Story 3)

Proves FR-006/FR-007.

1. With Scenario 1's provider configured, change the stored report: in DevTools, or by
   pointing the provider at a stub endpoint whose `/models` returns a different
   `context_length` for the same id.
2. Strike ⟳ to re-fetch.
3. **Expected**: the gauge/picker reflect the new number. Breaking the endpoint (stop the
   stub) and striking ⟳ surfaces the usual fetch error and **retains** the previous number.

## Scenario 4 — Picker display (spec Story 4)

Proves FR-009 visibility.

1. Open the model picker on a provider with captured windows.
2. **Expected**: rows show a muted window hint (e.g. `128K`) beside the name; the exact
   token count is available on hover; models without a captured value render without a hint.

## Automated verification map

| Proof | Where |
|---|---|
| Wire-field acceptance/rejection, dedupe determinism | `model-discovery.test.ts` (parser cases) |
| Map normalization (invalid dropped, orphaned pruned) | registry normalization tests |
| Precedence ladder + `'model-listing'` labeling | `context-usage.test.ts` |
| Gauge wiring/copy | `ContextGauge.contract.test.ts` |
| Picker secondary text, presentational | model-select contract test |
| End-to-end persistence via settings KV | `ProviderConfig`-level store test (merge rules) |

Contracts: [model-listing-harvest.md](./contracts/model-listing-harvest.md),
[context-window-resolution.md](./contracts/context-window-resolution.md). Data shapes:
[data-model.md](./data-model.md).
