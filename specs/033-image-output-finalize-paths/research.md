# Research — Image Output Finalize & Follow-Up Paths (Feature 033)

Phase 0 output. Every file:line claim below was re-verified against the worktree on
2026-11-10; drift found in the issue text is called out explicitly.

## Verified facts (with corrections to the issue's line references)

- **F1** `src/lib/chat/projection.ts:85-98` — `wireContent` emits `{ type: 'image', image: p.data }`
  for every image part; used by both the `user_message` branch (:256-273) and, gated on
  `opts.visionCapable`, the `assistant_message` branch (:275-291). Confirmed the issue's
  projection.ts:91/278-289 claims (minor drift only).
- **F2** `@ai-sdk/provider-utils@5.0.2` `dist/index.d.ts:1284` — `AssistantContent = string |
  Array<TextPart | CustomPart | FilePart | ReasoningPart | ReasoningFilePart | ToolCallPart |
  ToolResultPart | ToolApprovalRequest>`. **No image part.** `UserContent` (:1362) does accept
  `ImagePart`, so user-side projection is correct as-is. `ImagePart` is `@deprecated` (:103-131)
  in favor of `FilePart` (:135-171): `{ type: 'file', data: FileData | DataContent | URL |
  ProviderReference, mediaType: string, filename? }` where `DataContent` strings are base64
  (the SDK's data-content utilities also tolerate `data:` URLs — `dist/index.js:542`).
- **F3** `src/lib/ai/sdk-errors.ts` is 57 lines; the `AI_InvalidPromptError` → `NetworkError`
  fallthrough the issue cites as ":62-64" is actually **:54** (`if (err instanceof Error)
  return new NetworkError(...)`). `AI_InvalidPromptError` is not an `APICallError`, so it lands
  there. Functionally as the issue describes; only the line number drifted.
- **F4** `src/lib/agent/loop.ts` — `walkPersist` (:423-453) only creates rows inside
  `if (content)` and attaches images only to the last text row (:441-448); `turnImages` (:457);
  start-of-iteration abort (:461-468) and constructor-abort (:515-522) persist `buf` without
  images; consumeStream-abort calls `walkPersist(i, buf)` without images (:579-588); the
  iteration's images reach `turnImages` only after a normal stream end (:596); the
  between-iterations abort check (:616-620) precedes nothing that would have added the current
  iteration's images to the persist; finalize paths at :622-647 (critic/walk) and :852-868
  (budget); interim tool-call persist :655 deliberately defers images to finalize.
  `consumeStream` (:202-311) accumulates recognized images in a **function-local array**
  returned only on normal completion (:310) — on AbortError the partial images are lost with
  the stack. `collectStreamImages` (:99-118) already writes into a caller-passed array.
- **F5** `src/lib/stores/chat.svelte.ts` — `pendingImages` cleared at send start (:557);
  populated only inside `appendAssistantText` (:698-701); compose + append at :714-722 with
  `interrupted` metadata only when `aborted && parts` (:718-720); catch-time refinement keyed on
  `this.pendingImages.length > 0` (:875-878 — the issue's ":876-878" confirmed); finally-block
  residual abort persist (:912-925) re-runs `composeAssistantParts`; `composeAssistantParts`
  (:1017-1050) materializes URL candidates, appends fetch-failure notices, decodes, applies
  `applyOutputBudget`, and emits parts as `[textPart?, ...images]` (text always first).
- **F6** `src/lib/chat/images.ts` — `MAX_IMAGES_PER_MESSAGE = 8` (:21, used for input cap);
  `applyOutputBudget` (:303-323) re-encodes over-cap images via `reencodeOutputImage`, whose
  decode at :269 is unguarded (a corrupt over-cap payload rejects the whole call);
  `candidateToImagePart` (:331-355) swallows dimension-probe decode failure (:340-347) and
  stores the bytes anyway (0×0); `sniffImageMime` (:55-61) is the existing magic-byte sniff;
  `dataUrlToBytes` (:251-256) is module-private. `fetchImageCandidate` (:383-429) and
  `IMAGE_FETCH_MAX_BYTES` (:371) are the 032 work — must not regress.
- **F7** `src/lib/db/repositories/messages.ts:23-38` — `validateParts` enforces: non-empty
  parts, **≤ 8 image parts** (:27-30), text parts concatenate byte-for-byte to `content`.
  Applied on `append` and `insertAnchored`.
- **F8** `src/lib/chat/propagation.ts:105,121` — branch propagation slices collected images to
  8 at collection time (precedent for capping before insert).
- **F9** `src/lib/components/chat/rows/AssistantMessage.svelte:107-159` — the durable renderer
  already renders parts as ordered segments (contiguous text runs → Markdown blocks, images →
  thumbnail grids between them). Interleaved parts need **no renderer change**.
- **F10** `src/lib/ai/image-output-capability.ts` — `supportsImageOutput(config, modelId)`
  exists (030 capability gate: advisory, static allowlist, never blocks).
- **F11** Existing tests: `src/lib/stores/chat.svelte.test.ts:76-85` mocks `runAgentTurn`
  (wrapping the real one); the abort-with-image test "(b)" (:2167-2199) replaces the loop
  entirely and calls `appendAssistantText` with images post-abort — it never exercises the
  real abort paths (issue item 3's complaint). `src/lib/agent/loop.test.ts` has the 030
  recognition describe (:2206+) using `scriptedFullStream` (:170), which accepts arbitrary part
  shapes. `src/lib/chat/projection.test.ts` has the assistant-parts describe (:151).
- **F12** 030 contracts: `message-parts.md` §1 (canonical text concat; image-only rows
  `content=''`), §3 (≤8 images; caps before finalize), §4 (interleaved rendering in parts
  order), §5 (assistant images ride the wire only for vision-capable targets).
  `stream-image-parts.md` §2 ("ordered by arrival relative to text"), §3 ("parts = ordered
  text part(s) + images" — the wording this feature amends), §4 (abort persists complete
  `pendingImages` with `interrupted: true`).

## Decisions

### D1 — Item 1: project assistant images as AI SDK `file` parts (not text-only)

- **Decision**: In `projection.ts`, the assistant branch emits each stored image part as
  `{ type: 'file', mediaType: p.mimeType, data: <base64-only string> }` (data-URL prefix
  stripped at the comma), gated on `visionCapable` exactly as today. The user branch keeps the
  018 `image` part shape (valid for `UserContent`, byte-identical history).
- **Rationale**: `AssistantContent` has no image part in this SDK version (F2), so today's
  output is rejected before any provider call, permanently breaking the chat (issue item 1).
  `FilePart` is the SDK's own non-deprecated replacement. Text-only projection would discard
  context fidelity that 030 FR-011 explicitly promises. Stripping to pure base64 + explicit
  `mediaType` avoids relying on provider-side data-URL tolerance.
- **Alternatives considered**: (a) project assistant rows text-only until the SDK grows
  assistant image support — loses 030 FR-011, rejected; (b) keep data-URL string as `data` —
  legal (SDK utils split at the comma) but leaves the mediaType implicit per-provider; (c)
  change `sdk-errors.ts` to map `AI_InvalidPromptError` more kindly — treats the symptom;
  mapping stays as-is (out of scope, see non-goals).
- **Contract impact**: amends 030 `message-parts.md` §5 wording (wire shape for assistant
  images = provider-acceptable file part). The vision gate itself is unchanged.

### D2 — Item 2: image-only rows via the existing empty-content append

- **Decision**: When a finalize/abort persist has images but produced no text row
  (`walkPersist` returned null / no `content` block fired), the loop calls
  `appendAssistantText('', { images })`. Contract §1's image-only row (`content=''`, no text
  parts) already models this; the store path already handles it (empty text part omitted in
  `composeAssistantParts`).
- **Rationale**: Reuses the single finalize point (030 contract §3) and the atomic append;
  no schema or store changes beyond what the row shape already allows.
- **Alternatives considered**: synthesizing placeholder text ("Here is your image") — pollutes
  canonical text and FTS; rejected.

### D3 — Item 3: images survive abort via a caller-owned accumulator + both abort persists

- **Decision**: `consumeStream` gains an `imageSink: ImageCandidate[]` parameter (caller-owned,
  alongside the return value); recognition pushes into the sink at arrival, so an AbortError
  throw cannot lose already-recognized images. The loop hoists `turnImages.push(...)` so both
  abort paths — the consumeStream catch (:583) and the between-iterations check (:617) — hand
  the full turn image set (`turnImages` already includes the current iteration's sink) into
  `walkPersist`, with D2's image-only fallback when no text row exists. The defensive abort
  branches (:461-468, :515-522) also pass `turnImages`. Interrupted marking needs no change:
  aborted appends carrying parts already set `metadata.interrupted` (F5).
- **Rationale**: The sink mirrors how `collectStreamImages` already works (`into` array); the
  abort paths converge on the same walk as normal finalize.
- **Alternatives considered**: catching AbortError inside `consumeStream` and returning
  partials — conflates abort with normal completion and touches the finish/usage contract;
  rejected.
- **Tests**: must drive the REAL loop with a scripted stream (file part → hang → abort), not
  the store's mocked `runAgentTurn` (F11) — FR-008.

### D4 — Item 4: cap at 8 in `composeAssistantParts` with a drop notice

- **Decision**: `composeAssistantParts` slices the materialized candidates to
  `MAX_IMAGES_PER_MESSAGE` (imported from `images.ts`) before decoding and appends a bracketed
  notice for the dropped count, using the established un-fetchable-link notice pattern. The
  repository's `validateParts` stays the enforcement backstop; `applyOutputBudget` stays
  byte-only.
- **Rationale**: The compose step is the single seam every persistence route (normal, abort,
  budget) already flows through, and it is where notices already live (F5). Capping pre-decode
  also avoids wasted decode/re-encode work on images that will be dropped.
- **Alternatives considered**: capping inside `applyOutputBudget` — operates post-decode and
  would need a second result channel anyway; capping in the loop — would miss the store's
  finally-block residual persist; both rejected.

### D5 — Item 5: arrival offsets on the finalize handoff; parts composed in arrival order

- **Decision**: Recognized candidates carry `offset` = the text buffer length at arrival
  (captured in `consumeStream` via the existing `textLength()` callback). `walkPersist`
  attaches each image to the text row whose slice contains its offset (last row absorbs
  overflow); `appendAssistantText`'s `opts.images` entries carry the offset;
  `composeAssistantParts` splits the row text at the (clamped, stable-sorted) offsets and
  interleaves image parts at their positions. The critic-replacement path (re-emitted buffer,
  offsets stale) appends images after the corrected text — documented best-effort.
- **Rationale**: One row per text block (029 row discipline) is preserved; the §1 concat
  invariant holds by construction (splitting at offsets); the renderer already renders
  interleaved parts (F9); no schema change.
- **Alternatives considered**: (a) persist images as their own rows (row-splitting) — changes
  row cardinality and bubble structure, more churn; (b) per-part order index stored in the DB —
  schema-adjacent churn for no gain; both rejected.
- **Contract impact**: amends 030 `stream-image-parts.md` §2/§3 (arrival offsets; parts in
  arrival order) — §2's "ordered by arrival relative to text" already intended this.

### D6 — Item 6: byte-sniff gate + never-throw budget; per-image drop notices

- **Decision**: (1) `composeAssistantParts` rejects candidates whose bytes fail magic-byte
  sniffing (new tiny exported helper in `images.ts` wrapping `sniffImageMime` over
  `dataUrlToBytes`) with a bracketed drop notice — decoder-independent, so node tests and
  decoder-less runtimes never drop valid images. (2) `applyOutputBudget` wraps
  `reencodeOutputImage` per image in try/catch and returns `{ images, dropped }`; a decode or
  encode failure drops that image (counted) instead of rejecting the finalize. (3)
  `candidateToImagePart`'s best-effort 0×0 dimension probe stays as-is. The store maps every
  drop (sniff, budget, cap) to the same bracketed-notice mechanism.
- **Rationale**: Containment per image is the issue's requirement; sniffing is the only
  decoder-free validity signal available before passthrough (F6); the budget's "never a
  rejection" doc-comment already promises this for byte caps — the fix extends it to decode
  failures.
- **Alternatives considered**: treating probe failure as corruption — would drop every image in
  decoder-less environments (node tests) since `browserOps.decode` throws there; rejected.

### D7 — Item 7: `onImageRecognized` dependency drives refinement; zero-image notice on finalize rows

- **Decision**: `AgentTurnDeps` gains optional `onImageRecognized?: (candidate) => void`,
  invoked at recognition in `consumeStream`. The store increments a turn-scoped
  `streamRecognizedImages` counter (reset at send start, like `pendingImages`) and the
  catch-time refinement (:875-878) keys on that counter instead of `pendingImages.length`.
  For the zero-image success case: the loop marks its finalize calls (walk/critic path and
  budget path) with `opts.final: true` (interim tool-call persists don't); when a final append
  completes with `!aborted && content.trim() !== ''` and the active model is image-output
  expected (`supportsImageOutput`, F10) while `streamRecognizedImages === 0`, the store appends
  the bracketed plain-language no-image notice (same text family as `ImageOutputError`) to the
  row's content.
- **Rationale**: Recognition-time signal is the only one that exists during streaming (the
  issue's diagnosis); `final` disambiguates interim rows without changing the byte-identical
  1-arg call for image-less interim persists; the capability flag keeps the notice advisory
  (never blocks, F10).
- **Alternatives considered**: post-turn DB amendment of the final row — needs a new repo
  update path for assistant rows (no such method exists; heavier); emitting `chatStore.error`
  on a successful turn — wrong semantics; both rejected.

### D8 — Scope guardrails (non-goals)

- `sdk-errors.ts` mapping stays unchanged (the projection fix removes the invalid prompt at
  its source; remapping `AI_InvalidPromptError` is defense-in-depth for other causes, out of
  scope).
- 032's `fetchImageCandidate` reader-loop and `IMAGE_FETCH_MAX_BYTES` are untouched.
- No renderer changes (F9), no schema migration, no propagation changes (already slices to 8),
  no e2e additions beyond what exists (mock-llm deck may gain cases only if trivially cheap —
  not required by the acceptance bar).

## Open questions resolved by default (orchestrator mandate)

- FilePart vs text-only projection → **FilePart** (D1).
- Ordering representation → **finalize-path offsets, parts composed in arrival order** (D5).
- Cap seam → **composeAssistantParts pre-decode** (D4).
- Recognition-count flow → **onImageRecognized dep + store counter** (D7).
- Zero-image notice trigger → **capability-flag expected + successful final text row** (D7).

Residual (recorded in the handoff, not blocking): whether providers behind `openai-compatible`
universally accept assistant `file` parts — the projection is shape-valid per the SDK, and a
provider that rejects it surfaces a normal per-turn provider error (not a permanent break),
which is the accepted worst case per spec US1 edge case 7.
