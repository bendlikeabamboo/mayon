# Quickstart: Micro-Thought Streams (Interleaved Reasoning)

**Feature**: 029-micro-thoughts | **Date**: 2026-11-09

Validation guide proving the feature end-to-end. Design details live in
[research.md](./research.md), [data-model.md](./data-model.md), and
[contracts/](./contracts/).

## Prerequisites

```bash
pnpm install                      # worktree: fast via shared pnpm store
pnpm --filter @mayon/shared build # consumers resolve shared types from dist/
```

- Dev stack: `pnpm dev` (web http://localhost:5173; Docker/Podman via `MAYON_DEV_ENGINE`).
- Mock LLM: `node tests/fixtures/mock-llm/server.mjs` (port 9999, model `mock-sink`) —
  see [contracts/mock-llm-reasoning.md](./contracts/mock-llm-reasoning.md) for the
  `[[interleaved-thoughts]]` trigger.

## Scenario 1 — Interleaved micro-thoughts, live and after reload (SC-001, SC-002, FR-001..004)

1. In Mayon settings, add an OpenAI-compatible endpoint pointing at
   `http://localhost:9999/v1` with model `mock-sink`; keep the Thinking preference ON
   (reasoning enabled).
2. Send: `[[interleaved-thoughts]] What is 2+2?`
3. **Expected (live)**: the reply area shows, in order — a "Thought process" collapsible
   growing live (pulse dot, auto-expanded), then answer text, then a SECOND collapsible
   growing mid-answer, then more answer text, then a third short collapsible at the end.
   Answer text keeps the steady reveal cadence (no stall when thoughts arrive).
4. Reload the page (F5) and reopen the conversation.
5. **Expected (history)**: three collapsible thought entries in the same positions with
   identical text (collapsed by default); the answer text content equals the live total.

## Scenario 2 — Single-block reasoning unchanged (SC-003, FR-005, US3)

1. Same endpoint; send any prompt WITHOUT the marker (e.g. `hello`).
2. **Expected**: exactly one "Thought process"-shaped flow as today — for `mock-sink`
   (no reasoning frames) this means no thought entries and a normal reply; for real
   single-block providers (DeepSeek/Qwen via their dialects) one pre-answer collapsible.
   Persisted rows after reload: `[reasoning?, assistant_message]` — same shape as
   pre-029.

## Scenario 3 — Real GPT-6-family interleaving (SC-001, optional, needs external access)

- Point a Mayon OpenRouter endpoint at `openai/gpt-6-luna` (BYOK key) with reasoning
  enabled, effort medium, and send a prompt that triggers multi-part answers (e.g. "plan
  a two-day Tokyo itinerary, thinking out loud between sections").
- **Expected**: reasoning bursts render between answer stretches live; reload preserves
  the structure. (OpenRouter segment fidelity is best-effort per
  [research.md F4](./research.md) — any single-block fallback still renders correctly by
  Scenario 2 semantics.)

## Scenario 4 — Abort mid-interleave (FR-008)

1. Start Scenario 1's prompt, press Stop while the second thought burst is streaming.
2. **Expected**: received blocks persist in place (partial second burst visible after
   reload); nothing after the stop; no spinner remains; no stuck live entry (lifecycle
   rule).

## Automated gates

```bash
pnpm check        # svelte-check
pnpm lint         # ESLint + Prettier
pnpm test         # Vitest (pglite) — includes new interleaved tests
```

New test coverage to expect (fail pre-fix, pass post-fix):

- `src/lib/agent/loop.test.ts`: scripted fullStream
  `[reasoning-start/delta/end → text-delta → reasoning-start/delta/end → text-delta]`
  persists rows `[reasoning, text, reasoning, text]` in order with
  `metadata.anchored === true`; single-segment stream persists exactly
  `[reasoning?, assistant_message]` (today's shape); abort mid-interleave persists
  received blocks.
- `src/lib/chat/entries.test.ts`: anchored reasoning rows are NOT hoisted by
  `reorderTurn`; legacy (unanchored) rows still are; tool/user boundaries still never
  crossed.
- `src/lib/stores/chat.svelte.test.ts`: interleaved turn via mocked loop persists and
  reloads with identical structure; live block list ordering; no open blocks after
  teardown.
- `tests/fixtures/mock-llm`: marker-gated interleaved stream (manual, Scenario 1) —
  fixture itself is dependency-free `node:http`.

## Perf spot-check (SC-004)

1. Dev stack up; in the browser console: `window.__MAYON_PERF__ = 1` and
   `localStorage.mayon_perf_scenario = 'micro-thoughts'`.
2. Run Scenario 1 twice (before/after comparison if available) and compare the
   `[mayon-perf]` console summaries: frame timing/longtasks during the interleaved
   stream should match the plain-stream baseline within noise; answer-text reveal cadence
   unchanged (pacer untouched by design — `streamBuffer` path identical).
