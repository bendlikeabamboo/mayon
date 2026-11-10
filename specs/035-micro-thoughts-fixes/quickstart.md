# Quickstart: Micro-Thoughts Follow-Up Fixes (035)

**Feature**: 035-micro-thoughts-fixes | **Date**: 2026-11-10

Runnable validation scenarios. **All vitest invocations MUST use the fleet-capped wrapper**
(one process at a time; never plain `pnpm test`/watch):

```bash
systemd-run --user --scope -p MemoryMax=500M \
  --setenv=NODE_OPTIONS=--max-old-space-size=384 \
  pnpm test:low-spec <files>
```

Prerequisites: `pnpm install` + `pnpm --filter @mayon/shared build` already done (fleet
worktree). No Docker needed for any required scenario.

## V1 — Corrected replies keep reasoning (US1, fail-first)

`src/lib/agent/loop.test.ts` + `src/lib/stores/chat.svelte.test.ts`

1. Loop unit: original stream `[reasoning-start/delta "thinking", text-delta "```mermaid\nbad", finish]`,
   mocked `validateTurn` returns one issue then none; second stream emits corrected text.
   Expect `appendReasoning('thinking', 0)` ordered BEFORE the corrected
   `appendAssistantText(corrected, {final:true})`; no-correction variant calls
   `appendReasoning` exactly once.
2. Store round-trip: same script through the real loop; `repos.messages.listByChat` shows
   `[reasoning(anchored), assistant(corrected)]`; `load()` again → same order.

## V2 — Two-iteration live timeline shows each thought once (US2, fail-first)

`src/lib/stores/chat.svelte.test.ts` + `src/lib/agent/loop.test.ts`

1. Loop unit: `onIterationBoundary` fired once after the interim persist of a
   tool-calls iteration and once at finalize (two-iteration script).
2. Store: iteration 1 (reasoning+text+tool-call) persists; while iteration 2's reasoning
   streams, `liveItems` contains exactly ONE `live_reasoning` entry (iteration 2's), and
   no `live_text` entry with empty buffer pointing at cleared state.
3. Within one iteration: after text starts, the earlier reasoning block is
   `open === false` and its `liveItems` entry carries `streaming: false`
   (ReasoningEntry pulse gated — component-level assertion optional; flag presence is the
   unit bar).

## V3 — Regenerate on multi-row turns (US3, fail-first)

`src/lib/chat/entries.test.ts` + `src/lib/stores/chat.svelte.test.ts`

1. Gate: timeline of `[user, reasoning(anchored), assistant_message, reasoning(anchored)]`
   → helper returns the assistant id; unanchored trailing reasoning → `null`; text-last →
   id (unchanged).
2. Store: seed the same rows durably; `deleteLastAssistantTurn(textRowId)` removes all
   three non-user rows, keeps the user row, returns its text/attachments. Route delegation
   asserted by the store-level contract (no route mount).

## V4 — Paced presets drain once per turn (US4, fail-first)

`src/lib/stores/chat.svelte.test.ts` (paced-streaming describe, fake timers)

Script an interleaved stream with two text blocks (`text-start/delta/end` × 2, with
reasoning between) on a paced preset; after the first durable row lands, the second row
must persist WITHOUT advancing timers toward `DRAIN_DEADLINE_MS`; single-block paced turn
still defers until `draining` completes (existing 022 assertions stay green).

## V5 — Trace prunes the phantom tail (US5, fail-first)

`src/lib/agent/trace.test.ts` (new)

`TraceBuilder` fed `[request, reasoning-start, reasoning-delta "  ", reasoning-end, finish]`
→ `reasoningSegments` is `[]`; same sequence without `reasoning-end` (closed by finish) →
`[]`; a real trailing thought (" done thinking.") survives.

## V6 — Interleaved mock shape, fast tier (US1–US3 integration, fail-first)

`src/lib/stores/chat.svelte.test.ts`

Replay the mock's `chat_interleaved` frame order (mirroring
`tests/fixtures/mock-llm/server.mjs:187–205`: reasoning×2 → content×2 → reasoning×2 →
content×2 → trailing reasoning) as a scripted `fullStream` through the REAL loop+store.
Expect durable rows `[reasoning, text, reasoning, text, reasoning(trailing, anchored)]`,
each live thought emitted once while streaming, and the regenerate gate (V3 helper)
resolving on the turn. No browser, no dev stack.

## V7 — Optional, maintainer-only (dev stack)

Playwright e2e driving `[[interleaved-thoughts]]` against the Docker dev stack
(`pnpm dev`): live interleaved blocks render once each, reload preserves order, regenerate
replaces the whole turn. Implementers MUST NOT attempt to run this (no Docker in the
implementer tier); the fast-tier V6 is the required coverage bar.

## Static gates

```bash
pnpm check   # svelte-check
pnpm lint    # ESLint + Prettier --check (CHANGELOG.md included)
```
