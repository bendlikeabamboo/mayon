# Research: Micro-Thought Streams (Interleaved Reasoning)

**Feature**: 029-micro-thoughts | **Date**: 2026-11-09

Research ran as three parallel tracks: (A) codebase extraction of the streaming/persistence
APIs (file:line verified), (B) provider wire-format research (web, doc-cited), (C) AI SDK
capability research (installed package types + upstream docs). All NEEDS CLARIFICATION
slots resolved; none remained open.

## Findings

### F1. The installed AI SDK already streams segmented reasoning (key surprise)

- Repo uses **`ai@7.0.4`** (`package.json:54-70`) — not v5. Its `fullStream`
  (`TextStreamPart`, `node_modules/ai/dist/index.d.ts:3064`) includes
  `{type:'reasoning-start', id}` (:2960), `{type:'reasoning-delta', id, text}` (:2975,
  payload field is **`text`** on TextStreamPart, `delta` on UIMessageChunk), and
  `{type:'reasoning-end', id}` — plus id'd `text-start`/`text-delta`/`text-end` siblings.
- The SDK's stream-text implementation pushes a **new reasoning part on every
  `reasoning-start`** and records parts in arrival order — multiple sequential reasoning
  blocks per response are first-class (upstream `stream-text.ts`, vercel/ai).
- The upstream docs confirm the same semantics for v5+ ("Open text and reasoning parts are
  ended before recovered output begins"; UIMessage parts store reasoning interleaved
  positionally): https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text

### F2. The openai-compatible provider already emits re-opened segments mid-response

- `@ai-sdk/openai-compatible@3.0.2` (`dist/index.js:834-884`) parses
  `choice.delta.reasoning_content ?? choice.delta.reasoning`; emits `reasoning-start`
  (fixed id `"reasoning-0"`), closes it on the first `content`/`tool_calls` delta
  (:850-874), and **re-opens a new `reasoning-start` if reasoning deltas resume after
  text** — i.e., reasoning→text→reasoning within one response already surfaces as
  segmented parts. Ids are NOT distinguishing on this provider (always `"reasoning-0"`):
  segment boundaries are positional. ⇒ The loop must treat every `reasoning-start` as a
  new segment and ignore id collisions.

### F3. Mayon today flattens segments (the defect)

- `consumeStream` (`src/lib/agent/loop.ts:153-210`) maps `reasoning-delta` →
  `onReasoningDelta(p.text)` (:179-180), dropping the id/boundaries.
- `inner()` keeps one flat `reasoningBuf` per iteration (`loop.ts:307-308, 403-406`) →
  store's single `reasoningBuffer` (`chat.svelte.ts:152`, set at `:621`, bypassing the
  pacer) → `liveItems` hard-codes `[live_reasoning, live_text]` (`chat.svelte.ts:303-313`).
- Persistence: one `kind:'reasoning'` row per iteration before the text row
  (`loop.ts:430-436`; `chat.svelte.ts:711-718`, `metadata:{iteration}`); abort persists
  reasoning-then-residual-text (`loop.ts:409-428`).
- Display canonicalizer: `reorderTurn`/`canonicalizeOrder` (`entries.ts:279-319`) splices
  every `reasoning` row directly before its turn's `assistant_message`, stopping at tool
  rows — this would destroy any persisted interleaved layout on reload.
- Critic correction re-stream handles `text-delta` only; correction-phase reasoning is
  silently discarded (`loop.ts:262-271`).
- `AgentTurnDeps.appendAssistantText` already declares an unused `opts.reasoning`
  (`loop.ts:36`) — vestigial; the store ignores it (`chat.svelte.ts:622-652`).

### F4. Provider reality: who can actually interleave

| Provider | Reasoning interleaved with text? | Granularity | Source |
|---|---|---|---|
| OpenAI Responses API (GPT-5.5+/GPT-6 incl. gpt-6-luna) | **Yes** — docs: "visible output tokens before and in between thinking" | item/segment level (multiple `rs_` items; message `phase:"commentary"` vs `"final_answer"`); token-level intra-message UNCERTAIN | https://developers.openai.com/api/docs/guides/reasoning |
| OpenAI Chat Completions (GPT-6) | **No reasoning surfaced at all** (FC only with `reasoning_effort:"none"`; no summary fields) | — | https://developers.openai.com/api/docs/models/gpt-6-luna |
| OpenRouter | Wire-level yes (`delta.reasoning_details` interleaved with `delta.content`); segment fidelity across upstreams UNCERTAIN | `index`/`id` the only boundary signal | https://openrouter.ai/docs/guides/reasoning-tokens |
| Anthropic (adaptive thinking) | Yes around tool calls / multi-segment turns; plain text answer still thinking-first; a turn may have **zero** thinking blocks | block level (`index`-ordered thinking/text blocks) | https://docs.anthropic.com/en/docs/build-with-claude/adaptive-thinking |
| Gemini 3 | Chronological thought steps alongside function calls/text | part/step level; `thoughtSignature` must round-trip | https://ai.google.dev/gemini-api/docs/thought-signatures |
| DeepSeek / Qwen3 / Groq qwen3 | **No** — strictly reasoning-then-content per sub-request | single `reasoning_content`/`reasoning` field | https://api-docs.deepseek.com/guides/thinking_mode |

⇒ Single leading reasoning block is the **common case**; true mid-answer interleaving
arrives via OpenAI Responses (GPT-6 family) and OpenRouter passthrough, partially via
Anthropic/Gemini around tool calls. Design must make the common case byte-identical to
today (FR-005) and treat interleaving as a superset.

### F5. Anthropic param shape in Mayon is current and valid

`thinking: {type:"adaptive", display:"summarized"}` appears verbatim in official Anthropic
streaming examples (`display`: `"summarized" | "omitted" | "updates"`; effort is
`output_config.effort`, not inside the thinking object):
https://platform.claude.com/docs/en/build-with-claude/streaming,
https://platform.claude.com/docs/en/build-with-claude/thinking. No request-side change is
required for this feature.

### F6. The mock LLM fixture needs only `reasoning_content` frames

`tests/fixtures/mock-llm/server.mjs` (OpenAI-compatible SSE, `sseFrame` :105-107, 150ms
chunks) emits only `delta.content`/`delta.tool_calls` today — no reasoning frames. Because
the app's provider is `@ai-sdk/openai-compatible`, adding
`choices:[{delta:{reasoning_content:"…"}}]` frames (interleaved among content frames) is
sufficient for the SDK to surface segmented reasoning — **no app-code change needed in the
fixture plumbing**. Protocol doc: `docs/history/appendices/020-mock-llm-protocol.md`.

### F7. Prior art on presentation

ChatGPT/Codex stream per thinking block with section breaks (codex issues #5339/#8204);
CopilotKit: live auto-expanded reasoning card, collapses to "Thought for X seconds",
**close open reasoning on stream error/early end** (lifecycle rule worth adopting);
Open WebUI bug class: streams whose reasoning arrives after first text break naive
reasoning/answer splitting (open-webui#24697) — precisely the defect this feature avoids
by not splitting on content heuristics at all.

## Decisions

### D1. Segment model: SDK part stream is the source of truth; every `reasoning-start` opens a new segment

**Decision**: `consumeStream` gains segment-aware callbacks — `onReasoningStart()`,
`onReasoningDelta(text)`, `onReasoningEnd()`, `onTextSegmentStart()` — where every
`reasoning-start` (regardless of id) opens a NEW reasoning segment, and `reasoning-end`,
`text-start` (when text resumes), `tool-call`, `finish`, or abort closes the open segment.

**Rationale**: matches upstream `openai-compatible` behavior (F2) and SDK semantics
("new part on every reasoning-start", F1); ids are unreliable on this provider.

**Alternatives considered**: key segments by SDK `id` — rejected: openai-compatible reuses
`"reasoning-0"` so re-opened segments would collapse back into one block.

### D2. Live state: ordered `liveBlocks` (reasoning blocks + text-block offsets), pacer untouched

**Decision**: replace the single `reasoningBuffer` live string with an ordered block list:
`LiveBlock = { kind:'reasoning'; text: string; open: boolean } | { kind:'text'; start: number; open: boolean }`.
Text blocks carry a start **offset into the unchanged concatenated `streamBuffer`** (block
text = `streamBuffer.slice(start, nextTextStart)`). The pacer continues to operate on
`streamBuffer` exactly as today; per-block text display slices the paced visible prefix.

**Rationale**: preserves the entire pacing investment (022) and the single-buffer critic/
usage path; ordering is trivially maintained by list order; per-block slicing is pure.

**Alternatives considered**: store per-block text copies — rejected (duplicate state, drift
risk); pace reasoning too — rejected (out of scope, today's behavior renders reasoning at
stream rate; SC-004 only pins answer-text cadence); pace concatenated visible prefix but
render one live text entry at the end — rejected: breaks "arrival position" display
(FR-001/002) once text resumes after a thought.

### D3. Persistence: arrival-ordered rows; text splits into multiple `assistant_message` rows only when interleaved

**Decision**: at iteration end (and on abort), walk the blocks: reasoning blocks persist as
`kind:'reasoning'` rows (`metadata: {iteration, anchored: true}`), text blocks persist as
`assistant_message` rows in the same arrival order (multi-row only when >1 text block;
single-segment turns persist exactly today's `[reasoning?, assistant_message]` pair).
Usage anchors to the final text row; `builder.assistantMessageId` points at the last
persisted text row.

**Rationale**: reuses every existing mechanism (rows, `ord` ordering, `reorderTurn` stop-at-
tools, projection merging of consecutive assistant rows — `projection.ts:258-272` merges
consecutive same-role parts so the model still sees one assistant turn); no schema change;
the common case stays byte-identical (FR-005, SC-003).

**Alternatives considered**: (a) one assistant row with a new `reasoning` MessagePart type
and inline rendering — rejected: mixes two storage models, touches AssistantMessage
rendering, branching/choices/self-corrected all key off single-row semantics; (b) single
text row + fractional-ord reasoning rows spliced inside it — rejected: a reasoning row
cannot split a text row's content; display would still show reasoning outside the text.

**Risk noted for tasks**: verify branching/backprop/choices consumers that assume one
assistant row per iteration tolerate the multi-row case (last-row anchoring). Multi-row
only occurs on true interleaves, which today's providers rarely emit except GPT-6-family/
OpenRouter — acceptable blast radius, but tasks must include a consumer audit.

### D4. Ordering repair: `anchored` metadata; legacy rows still repaired

**Decision**: `ReasoningMeta` gains `anchored?: true`. `reorderTurn` v2: reasoning rows
**with** `anchored` keep their persisted position (never hoisted); rows **without** it
(legacy) are repaired to the pre-answer slot exactly as today. Repair still never crosses
tool rows or user boundaries.

**Rationale**: preserves 003 US3 canonical-order guarantees for all existing data (US3/
SC-003) with a one-flag discriminator; no migration needed.

**Alternatives considered**: infer by position — rejected: ambiguity between "legacy row
written after text by an old abort bug" and "new anchored row".

### D5. Empty-segment and lifecycle rules

**Decision**: reasoning segments that are empty/whitespace-only are never persisted or
displayed; open segments are closed on abort/finish (CopilotKit lifecycle rule, F7) so no
perpetual "live" entry survives an error; partial segments persist on abort (FR-008,
today's behavior generalized).

**Rationale**: matches spec edge cases; prevents the known "stuck thinking spinner" UI
defect class.

### D6. Critic correction streams keep today's behavior

**Decision**: correction re-streams persist as a single text row; reasoning deltas in
correction streams are discarded (documented), unchanged from today (`loop.ts:262-271`).

**Rationale**: corrections are rare, internal, and already invisible in reasoning display;
supporting interleaved corrections adds surface area with no user-visible payoff yet.

**Alternatives considered**: full segment support in critic phase — deferred; noted in
research for a future iteration.

### D7. Testing strategy: scripted fullStream + mock SSE frames; no new provider deps

**Decision**: (1) unit-test segment assembly via `scriptedFullStream` with interleaved
`reasoning-start/delta/end` parts (loop.test.ts pattern, `vi.mock('ai')`); (2) end-to-end
via the mock LLM fixture emitting interleaved `reasoning_content` frames (F6), triggered by
an explicit marker so existing flows are unaffected; (3) entries tests for anchored vs
legacy ordering; (4) store tests for multi-row persistence and live block list. Server
package untouched ⇒ no server test scope.

**Rationale**: the SDK already does wire parsing (F1/F2) — testing through the SDK's
part stream is both sufficient and stable; the mock fixture keeps tests offline and
deterministic.

### D8. Scope guard: providers that inline reasoning into content are out of scope

**Decision**: no `<think>` tag/content-parsing heuristics (matches spec Assumptions;
avoids the Open WebUI defect class, F7). What the provider sends as content is answer text.

**Rationale**: content-based reasoning extraction is lossy and provider-specific; the
segment channel is the reliable signal.

## Resolved questions (no NEEDS CLARIFICATION remains)

- "Simultaneous" interpretation → sequential interleave in one stream (F4 table; spec
  Assumptions already pinned this).
- Which providers deliver it → F4; single-block case preserved byte-identically (D3).
- Persistence shape → D3 (split rows, anchored flag, no schema change).
- Ordering on reload → D4 (reorderTurn v2).
- Live rendering/pacing → D2 (ordered blocks, pacer untouched).
- Testability → D7 (mock frames + scripted parts).
