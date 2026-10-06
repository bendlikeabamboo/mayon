# Quickstart: LLM Context-Remaining Indicator

**Branch**: `023-llm-context-remaining` | **Date**: 2026-10-07 | **Plan**: [plan.md](./plan.md)

Validation guide proving the feature end-to-end. Contracts: [contracts/context-gauge.md](./contracts/context-gauge.md) · Data model: [data-model.md](./data-model.md).

## Prerequisites

```bash
pnpm install
pnpm --filter @mayon/shared build
pnpm dev          # web on http://localhost:5173, server on :4319
```

Configure a provider. For deterministic usage numbers use the mock LLM from `tests/fixtures/mock-llm/server.mjs` (OpenAI-compatible; reports `usage {1,1,2}` on every reply; model id `mock-sink`). It has no catalog window, so declare one on the provider card ("Context window (tokens)") — this exercises exactly the path a custom endpoint takes.

## Manual scenarios

### A. Reported usage, known window (spec US1, FR-001/002/003)

1. Add the mock as an OpenAI-compatible provider; set **Context window (tokens)** to `2000`; make it active.
2. Open a chat and send a message.
3. **Expect**: after the reply completes, the Composer status row (right of `provider · model`) shows consumed vs window (2 / 2000, ~0%) in muted tone, derived from the reported usage — no `~` marking.
4. Reload the page and reopen the chat. **Expect**: the same value persists (anchor read from the message, not memory).

### B. Warning states + guidance (spec US3, FR-005/006)

The mock reports a constant 2 tokens per turn, so with integer windows only the critical and normal bands are reachable in the UI (low requires ≥75% used with ≤10% headroom — no integer window lands there at used=2). Drive those two live; the low band is pinned by the threshold boundary unit tests.

1. Edit the provider's context window to `2` (usage reports 2 tokens per turn → 100% used).
2. Send another message. **Expect**: the indicator renders in the critical (destructive) tone; its detail shows guidance to start a new chat or branch.
3. Set the window back to a large value → normal tone. Start a new chat → normal state.
4. Low band (`low` at ≤25% remaining): verified by `src/lib/chat/context-usage.test.ts` boundary cases (750/1000 → low, 749/1000 → normal), not drivable with the mock's fixed usage.

### C. Unknown window (spec FR-007)

1. Remove the declared context window on the mock provider (model `mock-sink` is not in the catalog).
2. **Expect**: the indicator shows consumed tokens with a "window unknown" marking and never a made-up denominator; the detail points to declaring a window on the provider card.

### D. Estimates and model mismatch (spec US2, FR-004)

1. Open a brand-new chat (no exchanges). **Expect**: occupancy is approximate (`~`/`est.` marked).
2. Configure a second provider with a different model, make it active mid-chat. **Expect**: the window recomputes against the new model immediately and the occupancy is marked estimated until the next reported exchange, after which reported values take over.

### E. Path semantics (spec FR-010)

1. Regenerate the last reply (hover action on the newest assistant turn). **Expect**: after the new reply the anchor is the new row — no double count.
2. Branch from an earlier message and navigate between branch and parent. **Expect**: each view's indicator reflects that path's latest exchange.

## Automated validation

```bash
pnpm test                                   # includes the new suites below
pnpm --filter @mayon/server test            # untouched, must stay green
pnpm check && pnpm lint
```

New suites added by this feature:

| Suite | Proves |
|---|---|
| `src/lib/chat/context-usage.test.ts` | derivation tables: anchor selection, partial usage, model-mismatch marking, window precedence (declared > catalog > unknown), router-prefixed ids, state thresholds, empty chat |
| `src/lib/ai/model-limits.test.ts` (extended) | router-prefix ids (`z-ai/glm-5.2`, `openai/gpt-4o`) resolve instead of returning null |
| `src/lib/db/repositories/messages` usage test | `recordUsage` writes `tokens` + `metadata.usage`, kind-guarded |
| `src/lib/stores/chat.svelte.test.ts` (extended) | a mock-LLM turn persists usage onto the final assistant row; aborted turn without usage writes nothing |
| `src/lib/components/chat/ContextGauge.contract.test.ts` | source-contract: gauge mounted in the Composer status row, states/tone classes and markings present, no send-path interception |

Expected outcome: all suites green; the manual scenarios A–E behave as stated.
