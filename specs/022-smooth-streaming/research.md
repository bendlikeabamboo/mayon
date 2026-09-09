# Phase 0 Research: Smooth Streaming (022)

**Date**: 2026-09-09 · **Inputs**: spec.md, ideas/010-streaming-text-animation (cards 002/003/005 + decisions.md), four codebase investigations (streaming pipeline, markdown DOM invariants, settings system, testing/perf conventions). No Technical-Context unknowns remained as NEEDS CLARIFICATION; this file records the design decisions the plan and contracts build on.

## D1. Pacing insertion point: store-side, between raw buffer and render copy

**Decision**: The pacing layer lives in `src/lib/chat/streaming/pacer.ts` and is consulted by the store's existing 80 ms rAF flush (`chat.svelte.ts` `startRenderFlush`, `RENDER_INTERVAL_MS = 80`). The flush stops copying `streamBuffer → streamBufferRender` verbatim and instead asks the pacer for a *safe release length*; the store writes `streamBuffer.slice(0, released)` to `streamBufferRender`.

**Rationale**: The raw/render buffer split already exists (`streamBuffer` raw accumulator updated per SSE delta via `AgentTurnDeps.updateStreamBuffer`, loop.ts:366-370; `streamBufferRender` throttled copy). The raw buffer is the persistence contract (`appendAssistantText`, abort persist with `interrupted: true`), so pacing must throttle only the render copy — never the raw accumulator. Keeping the pacer outside the store as a testable module lets unit tests drive it with fake timers (established convention: `toasts.svelte.test.ts`, `probe.test.ts`).

**Alternatives considered**:
- *Pace inside `AgentTurnDeps.updateStreamBuffer` wiring (loop-side)* — rejected: touches the agent loop and its critic-phase buffer resets (loop.ts:225,245); store-side placement keeps `loop.ts` untouched and resets observable as buffer shrinkage.
- *Pace at the markdown component (render less often)* — rejected: only changes frequency, not visible chunk size; doesn't produce word-safe steady growth.
- *New SSE parser / server-side pacing* — rejected: server is transport-only; pacing is presentation.

## D2. Release cadence: word-snapped, adaptive, eased drain

**Decision** (initial constants, tunable at implementation; pinned as test bands per `motion/stagger.test.ts:42-50` convention):
- Release at most every 80 ms flush; each release snaps back to the last safe boundary (end of a word / whitespace / block edge) within a small lookback window (≤ 12 chars) — never mid-word (spec FR-002).
- Rate while streaming: `chars/sec = max(BASE_CPS, backlog × CATCHUP_PER_SEC)` with `BASE_CPS ≈ 90`, `CATCHUP_PER_SEC ≈ 3.0` — keeps arrived-but-hidden lag inside the accepted few-hundred-ms window for fast models (spec FR-003, SC-002, SC-005).
- On stream end: drain mode — rate ramps (≈ doubles every ~120 ms) until the buffer empties, hard-bounded so total drain ≤ ~800 ms–1 s; completion reads as a smooth finish, not a dump (spec FR-004).
- On abort/error: bypass pacing entirely — full flush + immediate persist (existing `interrupted: true` path) (spec FR-005).
- Buffer resets (critic phase calls `updateStreamBuffer('')`): pacer detects `released > raw.length` and resets to 0.

**Rationale**: The existing flush already caps re-render frequency; pacing changes *what fraction* is visible. Adaptive catch-up is where Card 003 put "the real tuning time"; constants are deliberately plan-level initial values with tests asserting bands, not exact curves.

**Alternatives considered**:
- *Markdown-construct-aware release (never cut inside an unclosed fence/link)* — deferred: Mayon already renders partial markdown live today (same partial-construct behavior, just steadier); word-snapping satisfies FR-002. Revisit only if code-heavy replies flicker in practice.
- *Fixed chars-per-tick* — rejected: throttles fast models visibly (SC-005 failure).
- *rAF-per-frame release independent of the 80 ms flush* — rejected: multiplies markdown re-parses (O(full buffer) each, `renderMarkdownLive`); 12.5 Hz is the measured-safe cadence already in place.

## D3. Completion finalization: persist after drain (bounded), abort stays immediate

**Decision**: On normal finish, the store defers `appendAssistantText(rawBuffer)` (and buffer teardown) until the pacer's drain completes (≤ ~1 s). The live row keeps rendering the draining text; the durable row then appears exactly as today. Abort/error keeps today's behavior: instant full flush + persist.

**Rationale**: Today completion already "pops" (live row swaps to a full durable row mid-drain). Deferring finalize by ≤ ~1 s preserves SC-002/SC-005 (all text visible within ~1 s of model finish) and keeps one code path for finalization. Durability exposure is bounded at ~1 s and only on the success path; a reload during that window loses the turn exactly as the accepted status quo does mid-stream (`chat.svelte.ts:9-11`).

**Alternatives considered**:
- *Persist immediately, keep live row until drain done* — rejected: the durable row would already be in `messages`/timeline while the live row drains → duplicate rendering or special-case hiding; more state for zero user-visible gain.
- *No easing (finalize immediately, as today)* — rejected: violates FR-004/edge-lift-together requirement; the end of stream would read as a burst.

## D4. Growth-edge effect: live-branch-only overlay, backdrop blur + fade gradient

**Decision**: A `GrowthEdge.svelte` overlay rendered **only** in the live branch of `AssistantMessage.svelte` (which today renders plain `<Markdown live>` with no `Highlighter`, no post-processing, no alignment). Mechanism: absolutely-positioned element over the measured rect of the trailing text of the last block, using `backdrop-filter: blur()` softened by a linear-gradient mask (fade), pinned to the growth edge; recomputed on each render flush; `pointer-events-none`, `z-10`, `motion-reduce:transition-none`; lifts with a short transition synchronized with drain completion. A `caret` variant (thin blinking caret) serves the Calm preset from the same component; Standard renders no overlay.

**Rationale**: The live/durable split is the load-bearing invariant: durable rows get `Highlighter` + alignment + post-processing; live rows get none. Keeping the effect in the live branch means the durable DOM is byte-identical by construction (expound/sourcemap/search/copy untouched — FR-010), and the overlay disappears naturally at finalization with no shape-flip handling. The overlay contains zero text nodes and lives outside any alignment container, so `EXCLUDED_CHROME_SELECTORS` needs no change. Follows the in-content overlay ladder (`z-10` + `pointer-events-none`, edge-fade/section-strip precedent) and reduced-motion gating at the source (`motion/stagger.ts`).

**Alternatives considered**:
- *CSS `mask-image` on the markdown container itself* — rejected: masks the whole block edge rather than the text tail; interacts poorly with code blocks/tables at the tail and with the scroll-edge fades already using gradients.
- *Span-wrapping the last N words with a blur class* — rejected: mutates the rendered DOM per flush (mutation churn) and creates a second DOM shape; the explicit loser of the Idea 010 evaluation (card 001's risk).
- *Overlay inside the Highlighter container of durable rows* — rejected: would require `EXCLUDED_CHROME_SELECTORS` changes and risks alignment thrash via MutationObserver (`Highlighter.svelte:400-401`).
- *Suppress list entirely* (`pre`, `table`, and their descendants) per spec FR-008; lists: soften (shorter/weaker blur), since list items are flowing text and the card notes "suppress or soften".

**Known fiddly bits (accepted, spec'd)**: re-wrap tracking (recompute rect per flush, expect cosmetic iteration); selection-under-blur looks odd mid-stream (accepted; overlay never intercepts pointer events — FR-009).

## D5. Preset setting: one settings-KV enum, read-time default, no migration

**Decision**: New key `streamPreset` ∈ `'calm' | 'standard' | 'expressive'`, default `'standard'`, owned by a single-writer accessor module `src/lib/chat/streaming/pref.ts` (pattern: `strip/pref.ts` + enum narrowing from `getAmbientEffort`, `ai/client.ts:43-46`). UI: a labeled `<select>` with optimistic save in `ChatDisplayConfig.svelte` (the `#chat` appearance section, `settings/+page.svelte:179-181`; select markup pattern from `LearnerProfileConfig.svelte`). The chat page loads the preset on mount into `chatStore` (pattern: `stripEnabled`), where both the pacer and the live-row overlay read it.

**Rationale**: Settings table is schema-less JSON KV; defaults resolve defensively at read time — no drizzle migration, no `seedDefaults` entry (rendering-pref precedent skips seeding). Server-synced across devices via the existing `repos.settings` path; no localStorage mirror needed (the pacer reads after DB boot; `theme`'s localStorage dual-persistence exists only for pre-boot paint).

**Alternatives considered**:
- *Card 005 full effect-registry framework (presets × surfaces matrix)* — rejected: spec limits scope to one effect family + FR-014 ("shaped so presets can be added later"); the enum + per-preset behavior map satisfies extensibility without speculative infrastructure.
- *localStorage-only preference* — rejected: breaks cross-device consistency and backup capture; settings KV is the established home for rendering prefs.

## D6. Verification strategy: unit bands + store integration + probe measurement; E2E optional

**Decision**: (1) Pacer unit tests with fake timers asserting timing bands and word-snap invariants; (2) store integration tests extending `chat.svelte.test.ts`'s `mockStreamReply` pattern (streaming, abort fast-flush, deferred finalize, reset handling); (3) pref tests mirroring `strip/pref.test.ts`; (4) perf-mark source-contract test (pattern: `SectionStrip.contract.test.ts`); (5) manual smoke matrix per preset in quickstart.md; (6) perf probe before/after (constitution IV obligation). Playwright E2E extension (mid-stream asserts against a slowed mock-llm) is optional follow-up — the fixture's `CHUNK_INTERVAL_MS`/`BLOCKS_PER_CHUNK` are hardcoded and making them env-tunable is a small fixture change that preserves the "no `page.route` interception" guardrail.

**Rationale**: Constitution II explicitly routes UI-only presentation changes through `pnpm check` + manual smoke; the pacing logic itself is `src/lib/` behavior and therefore unit-tested. E2E today only asserts end-state (`#msg-live-text` count 0); mid-stream visual pacing is not worth CI flakiness at MVP.

**Alternatives considered**:
- *Playwright-first pacing assertions* — deferred (above).
- *Snapshot-testing rendered live HTML* — rejected: live HTML is not the contract; the durable DOM and alignment suites (`selection.test.ts`, `sourcemap.test.ts`, `render.spec.ts`) are the guardrails, and they must pass unchanged.

## D7. Invariants inherited from the codebase (hard constraints, cited)

1. Canonical-text equality for expound alignment (`selection.ts:113-140`): pacing must never alter the *persisted* buffer (`streamBuffer`), only the render copy; durable DOM unchanged.
2. Nothing appended inside `<pre>` except `.md-copy-btn` — copy reads `pre.textContent` (`Markdown.svelte:105`); overlay never mounts inside markdown `{@html}` output.
3. Live branch skips all post-processing (`Markdown.svelte:76`) — overlay lives there, so no chrome-selector changes.
4. `stripGateFence` is applied to whatever string is rendered/persisted (`generate-gate.ts:60-77`) — render copy remains a plain prefix; gate-fence stripping continues to work downstream.
5. z-index ladder: in-content overlays `z-10`, floating UI `z-50` (`AssistantMessage.svelte:157-161`).
6. Full-text search is DB-side generated columns (`packages/shared/src/fts.ts`) — untouched.
7. Store header contract: assistant tokens persist on finish/Stop; reload mid-stream loses the in-flight turn (accepted) — drain-deferred finalize stays within the same acceptance window.
