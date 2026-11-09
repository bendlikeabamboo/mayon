# Implementation Plan: Micro-Thought Streams (Interleaved Reasoning)

**Branch**: `029-micro-thoughts` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/029-micro-thoughts/spec.md`

## Summary

Preserve and render reasoning segments that arrive interleaved with answer text ("micro
thoughts", "thoughts after thoughts") instead of flattening them into one pre-answer block.
The AI SDK (`ai@7.0.4`) already streams segmented reasoning (`reasoning-start`/`reasoning-delta`/
`reasoning-end`, each with an `id`) and `@ai-sdk/openai-compatible` already re-opens a new
segment when reasoning resumes after text — today's agent loop discards the boundaries
(`loop.ts:179`) and merges everything into one flat buffer per iteration, and the store's
live timeline hard-codes "one reasoning entry, then one text entry" (`chat.svelte.ts:303-313`).

The design: (1) the loop consumes segment boundaries and forwards an ordered **live block
list** (reasoning blocks + text-block offsets) to the store; (2) the store renders live
blocks in arrival order — each reasoning block as its own collapsible "thought process"
entry (existing component), text revealed through the unchanged pacer over the concatenated
buffer and sliced per text block; (3) persistence walks the blocks at iteration end:
reasoning rows (`kind:'reasoning'`, now marked `anchored`) and — only when the reply truly
interleaves — text split into multiple `assistant_message` rows in arrival order; the
single-segment case persists exactly today's two rows (byte-identical behavior, FR-005);
(4) `reorderTurn` learns that `anchored` reasoning rows sit where they were persisted and
only repairs legacy unanchored rows, so history reloads reproduce the interleaved layout;
(5) the mock LLM fixture gains `delta.reasoning_content` frames (incl. an interleaved
script) so the whole flow is testable offline. Projection stays untouched: reasoning is
never sent back to the model (FR-006).

## Technical Context

**Language/Version**: TypeScript on Node 22 (`.nvmrc`), SvelteKit + Svelte 5 runes
(runes-mode components/stores), pnpm 10.

**Primary Dependencies**: `ai@7.0.4` (fullStream `reasoning-start/delta/end` parts with
`id`; `text` payload on TextStreamPart), `@ai-sdk/openai-compatible@3.0.2` (parses
`delta.reasoning_content ?? delta.reasoning`; segments with fixed id `"reasoning-0"`,
closes on content/tool_calls, re-opens on resumed reasoning), `@ai-sdk/anthropic@4.0.1`,
`@ai-sdk/google@4.0.2`, `ollama-ai-provider-v2`. Tailwind v4 + shadcn-svelte UI
vocabulary. **No new dependencies.**

**Storage**: No schema change. Reuses `messages` table as-is: `ord` is already
`doublePrecision` (fractional-capable), `kind:'reasoning'` rows already exist, `metadata`
JSON gains an `anchored` flag inside the existing `ReasoningMeta` shape
(`src/lib/chat/kinds.ts:86-89`). All writes go through `repos.messages` (constitution
layering respected).

**Testing**: Vitest (`pnpm test`), pglite test driver. Existing scripted-stream patterns:
`src/lib/agent/loop.test.ts` (`scriptedFullStream`, `vi.mock('ai')`),
`src/lib/stores/chat.svelte.test.ts` (pglite + mocked `runAgentTurn`),
`src/lib/chat/entries.test.ts` (canonical-order tests). New tests must cover interleaved
segments end-to-end via a scripted fullStream and via the extended mock LLM SSE fixture.

**Target Platform**: Browser SPA (`@sveltejs/adapter-static`, no SSR) + optional Node
server (uninvolved by this feature — streaming is browser-direct or via the dumb byte-pipe
proxy). Progressive-degradation clean: works with or without the server.

**Project Type**: web-app (SPA + optional server).

**Performance Goals**: Answer-text reveal cadence unchanged (SC-004): pacer config and
tick path untouched (`pacer.ts` operates on the concatenated `streamBuffer` exactly as
today); reasoning blocks render un-paced at stream rate as today (`chat.svelte.ts:621`).
No bundle growth. Live block list updates in the same rAF flush cadence
(`RENDER_INTERVAL_MS = 80`).

**Constraints**:
- Single-segment turns (the common case across DeepSeek/Qwen/Groq/Anthropic plain turns)
  must persist and render **identically to today** (FR-005) — the split path activates
  only when a second reasoning/text segment actually occurs.
- `reorderTurn` (`entries.ts:279-300`) currently hoists every reasoning row above its
  turn's assistant_message; it must not destroy anchored interleaved layout (FR-004) and
  must keep repairing legacy rows (US3).
- Reasoning rows stay excluded from context (`projection.ts:12-18`, FR-006) — no
  projection changes.
- Critic correction re-streams keep today's behavior (text only; correction reasoning is
  discarded) — documented, out of scope.
- The critic/usage/self-corrected machinery operates on the concatenated text buffer and
  stays unchanged; usage anchors to the final text row.
- Mock LLM fixture is test-only; no production server changes.

**Scale/Scope**: single-owner local deployment; unbounded history (no migration; new
metadata is additive and legacy rows remain valid).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How |
|---|---|---|
| I. Layering (app code → repositories only; no `db` imports) | PASS | All persistence via existing `repos.messages.append`/`recordUsage`; store/loop changes add no imports. |
| I. `StorageDriver` stays a dumb SQL executor | PASS | No driver or schema change; `ord` doublePrecision already supports any needed ordering. |
| I. `pnpm check` + `pnpm lint` gates | PASS | Standard gates; quickstart lists them. |
| I. No secrets in settings | PASS | No settings changes; provider reasoning params already flow through existing dialects. |
| II. Tests (`pnpm test`; server changes ⇒ server tests) | PASS | Loop/store/entries/mocks covered by new Vitest cases (see quickstart); no server package changes ⇒ no server test scope. |
| II. Bug fix ⇒ regression test | PASS | Flattening loss is the defect; interleaved scripted-stream test fails pre-fix (segments merged) and passes post-fix. |
| II. No writes to `search_vec` / no reindex paths | N/A | No search surface touched. |
| III. UI from Tailwind v4 + shadcn-svelte vocabulary | PASS | Reuses existing `ReasoningEntry.svelte` collapsible ("Thought process", pulse, live auto-expand); no new primitives. |
| III. Progressive degradation (no server assumption) | PASS | Feature is entirely client-side over the provider stream; works browser-direct without the server, as streaming does today. |
| III. No downtime operations | PASS | Additive metadata; no migration, no server restart. |
| III. Expound raw-offset discipline | PASS | No markdown post-processing injection: reasoning entries already render inside the established collapsible; stored `assistant_message` content is only split, never mutated — offsets of any single row stay internally consistent (each row's source map is per-row). |
| IV. Perf-sensitive changes measured | PASS | SC-004 pins pacing parity; perf probe (`__MAYON_PERF__`) spot-check on interleaved mock stream during verification (plan quickstart). |
| IV. Bundle growth justified | PASS | Zero new dependencies. |
| IV. `@mayon/shared` build order | N/A | Shared package untouched. |
| Seam deviation ⇒ amendment | PASS | No seam changes; `docs/reference/tool-map.qmd` unaffected (no agent/MCP tool changes). |

Post-design re-check: no violations introduced — data model adds zero columns/tables and
reuses existing rows; the only ordering-semantics change is scoped to the display
canonicalizer, which is presentation-layer. **Complexity Tracking table not needed.**

## Project Structure

### Documentation (this feature)

```text
specs/029-micro-thoughts/
├── plan.md                        # This file
├── research.md                    # Phase 0 output
├── data-model.md                  # Phase 1 output
├── quickstart.md                  # Phase 1 output
├── contracts/                     # Phase 1 output
│   ├── stream-segments.md         # fullStream → segment/block contract
│   ├── persistence-and-display.md # row contract, anchored rule, reorderTurn v2, live blocks
│   └── mock-llm-reasoning.md      # mock SSE extension for reasoning frames
└── tasks.md                       # Phase 2 output ($speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/lib/
├── agent/
│   ├── loop.ts                    # consumeStream: segment-aware callbacks; inner(): block-walk persistence
│   ├── loop.test.ts               # interleaved scripted-stream tests
│   └── trace.ts                   # per-iteration reasoningSegments (minor)
├── stores/
│   ├── chat.svelte.ts             # liveBlocks state; update callbacks; anchored appendReasoning; multi-row persistence; liveItems
│   └── chat.svelte.test.ts        # interleaved turn persistence/live tests
├── chat/
│   ├── entries.ts                 # reorderTurn v2 (anchored rule); live entry types unchanged
│   ├── entries.test.ts            # anchored-vs-legacy ordering tests
│   └── kinds.ts                   # ReasoningMeta + anchored?: true
├── components/
│   └── chat/
│       ├── MessageList.svelte     # render ordered live block entries
│       └── rows/ReasoningEntry.svelte  # per-segment props (already block-shaped; keys per segment)
tests/fixtures/mock-llm/
├── server.mjs                     # reasoning_content frames + interleaved script trigger
├── README.md                      # protocol notes
docs/history/appendices/
└── 020-mock-llm-protocol.md       # protocol doc update
```

**Structure Decision**: existing single-project layout; all changes live in the established
chat/agent/store seams. No new modules beyond what tests and the mock fixture need.

## Complexity Tracking

> Not needed — Constitution Check passes with no violations (pre- and post-design).
