# Research: Model-Generated Images in Chat (030)

**Date**: 2026-11-09
**Sources**: two read-only repo investigations (parts/persistence/rendering; provider path/streaming/gates), `docs/history/018-image-chat-parts.qmd`, `docs/history/appendices/018-provider-vision-flag.md`, `docs/history/appendices/020-mock-llm-protocol.md`, spec `specs/030-image-generation/spec.md`. All file:line references verified against this worktree.

## R-1 Durable representation: reuse `ImagePart` on `assistant_message` rows; no new kind, no schema change

**Decision**: Model-generated images persist through the existing nullable `parts` JSON-text column on `messages`, using the existing `ImagePart` shape (`src/lib/chat/kinds.ts:168-183`) on rows of the existing `assistant_message` kind. No migration, no new `kind` enum value, no new column.

**Rationale**: The 018 parts architecture was explicitly designed so later modality slices are follow-ons, not rewrites. `messagesRepo.append` (`src/lib/db/repositories/messages.ts:21-82`) already validates parts role-agnostically (non-empty, ≤8 image parts, text parts must concatenate exactly to `content`) and serializes them; the store simply never passes parts for assistant rows today. The open `MessagePart` union (`{type: string}` catch-all) round-trips unknown kinds end-to-end (regression-tested at `src/lib/db/repositories/repositories.test.ts:181-195`).

**Alternatives considered**:
- New durable kind (e.g. `assistant_image_message`): touches the schema enum (`src/lib/db/schema.ts:74-88`), `EntryKind`/`ALL_KINDS`/`laneOf` (`src/lib/chat/kinds.ts:3-39`), `MessageList` dispatch (`src/lib/components/chat/MessageList.svelte:174-199`), and needs a migration — four surfaces for zero added capability. Rejected.
- Separate blob store / media table: rejected by the 018 ruling (single-user scale; base64 in `parts` rides `pg_dump`/restore untouched — `docs/history/018-image-chat-parts.qmd:29-32`).
- Image as data-URL inside `content` markdown: the sanitize schema strips `data:` URIs and it would pollute `search_vec` (which extracts from `content` only, `packages/shared/src/fts.ts:4`). Rejected.

**Consequences**: the `content` concatenation invariant is load-bearing — the assistant row's canonical text lives in `content`, and any text parts must concatenate to it. Image-only replies are legal with `content: ''` and no text parts (shape proven by `src/lib/db/repositories/search.test.ts:326-349`) but are unsearchable; the model's caption/description text therefore goes into `content`/text parts whenever provided. The ≤8 image-parts cap applies to assistant rows as to user rows.

## R-2 Stream recognition: extend `consumeStream` to recognize image-bearing SDK parts; implementation spike first

**Decision**: The single recognition point is `consumeStream` in `src/lib/agent/loop.ts:153-210`. Today it handles `text-delta`, `tool-call`, `reasoning-delta`, `finish`, `error`; every other part is traced (`loop.ts:170`) and silently dropped. The feature adds recognition of assistant-emitted image parts as **atomic segments**: each recognized image becomes one finished image candidate (never a paced string fragment). A bounded **implementation spike** (first task of implementation) must verify how AI SDK v7 (`ai@^7.0.4`, `@ai-sdk/google@^4.0.2`, `@ai-sdk/openai-compatible@^3.0.2`) surfaces assistant-emitted images in `fullStream` (e.g. `file` parts with `image/*` media type vs provider-specific shapes), and whether a per-dialect normalization shim (alongside `src/lib/ai/dialects.ts`) is needed for wire shapes the SDK does not map (e.g. OpenRouter-style `choices[].message.images[]`).

**Rationale**: All assistant content funnels through this one consumer, and unrecognized parts are already visible in diagnostics traces — the seam exists and is observable. Unit tests script `fullStream` directly (`scriptedFullStream`, `src/lib/agent/loop.test.ts:167-173`), so recognition logic is testable without resolving the wire-format question.

**Alternatives considered**:
- Intercepting provider-native image tool calls (e.g. OpenAI `image_generation_call`) as "unknown tool → render as content": couples Mayon to one provider's tool surface and fights the tool registry (`loop.ts:389-408`, `toolsRun` at `529`). Rejected for v1; the recognition layer is part-shaped, not tool-shaped.
- Parsing images out of `streamBuffer` text (markdown/data-URL detection): re-introduces substring heuristics and the sanitize/FTS problems of R-1's rejected alternative. Rejected.

## R-3 Turn lifecycle: parallel `pendingImages` array; images materialize at finalize; abort persists complete images

**Decision**: Keep `streamBuffer` a pure string (the pacer at `src/lib/chat/streaming/pacer.ts:11-56` and the rAF flush at `src/lib/stores/chat.svelte.ts:202-246` release string prefixes only). Recognized images accumulate in a per-turn `pendingImages: ImagePart[]` alongside the buffer; the live view shows a bounded placeholder indicator (no base64, no partial frame) while `pendingImages` is non-empty. `appendAssistantText` (`chat.svelte.ts:622-652`) becomes the finalize point: it builds parts (text part(s) + images, ordered) and passes them to `repos.messages.append(chatId, 'assistant', content, { model, parts })`. The abort/interrupt path (`chat.svelte.ts:815-824`) persists `pendingImages` too — an interrupted reply keeps its complete images with `metadata.interrupted: true`, mirroring how partial text is kept. The critic phase's smaller consumer (`loop.ts:262-271`) carries collected images through correction rounds (critic adds/replaces text; images survive).

**Rationale**: Spec FR-008 (no broken/partial image while streaming) falls out of the pacer's string-prefix discipline for free — an atomic payload cannot be split, so it lands only at finalize, which is also where non-standard presets already drain (`chat.svelte.ts:627-636`). Atomic append of text+parts in one row is the established 018 pattern for user messages (`chat.svelte.ts:478-499`), so a failed reply leaves no half-row.

**Alternatives considered**:
- Pacing images mid-stream: impossible without redesigning the pacer (string-prefix contract); unnecessary for FR-008. Rejected.
- Dropping images on abort: violates the "conversation record" framing (spec US1/FR-002) — partial text is already kept today, so keeping complete images is consistent. Rejected.

## R-4 Remote-URL delivery: materialize at receive time through the existing provider fetch path; bounded output-side caps with fallback re-encode

**Decision**: When a provider delivers the image as a remote link instead of embedded bytes, the client fetches it at finalize time through the existing keychain/proxy fetch (`createKeychainFetch` → `getLlmFetch`, `src/lib/ai/sdk-fetch.ts:18-46`, `src/lib/services/llm-proxy-fetch.ts:40-44`) so auth and the server proxy apply, then stores the bytes; display never depends on the live link (FR-004). Generated images are **not** downsized by default (chart/infographic text legibility), but handling stays bounded: images beyond an output-side cap are re-encoded through the existing canvas pipeline (`src/lib/chat/images.ts`) with output constants sized so a persisted row fits the 16 MiB `/api/db/query` request limit (`server/src/pg.ts:117-121`) that `RemotePgDriver` persistence rides. A link that cannot be fetched yields a contained inline notice (FR-007), never a permanently broken frame.

**Rationale**: The proxy is a raw hijacked byte pipe with no response limit (`server/src/llm-proxy.ts:66-78`), so multi-MB image payloads stream through fine; the only real ceilings are the 16 MiB request limits on `/api/llm/proxy` and `/api/db/query`. 018's input-side intake (1568 px / ≤500 KB target, `images.ts:20-27`) optimizes for upload economy — the wrong objective for generated output, where fidelity is the value; but unbounded growth risks the persistence envelope, hence cap-then-re-encode.

**Alternatives considered**:
- Server-side URL fetch: adds a server concern and a second auth surface; the client already owns provider credentials and proxy routing. Rejected.
- Hard-rejecting oversized images: turns a recoverable case into a dead end; the canvas re-encode path already exists. Rejected.
- Storing the remote URL and hot-linking forever: violates FR-002/FR-004 (provider-side retention is short on several gateways). Rejected.

## R-5 Rendering: segmented markdown blocks with image grids between; expound containment fallback

**Decision**: `AssistantMessage.svelte` (today markdown-only, `src/lib/components/chat/rows/AssistantMessage.svelte:65-67`) renders the ordered parts as contiguous **text segments through the existing `Markdown` component** with image thumbnails (reusing the `UserMessage` grid pattern, `src/lib/components/chat/rows/UserMessage.svelte:23-41`) between segments — images stay outside the Markdown pipeline, preserving the sanitize/`data:` and sourcemap story. Image-less replies render exactly as today (single block, zero regression). Expound/anchoring: because text parts concatenate to `content` (repo invariant), per-segment offsets are derivable by construction; if the anchoring integration (sourcemap + DOM alignment, `src/lib/markdown/sourcemap.ts` + `src/lib/chat/selection.ts`) proves unsound for multi-segment messages, the bounded fallback is to disable the selection menu for those messages only — the established precedent for selections touching generated content — never to break offsets or fall back to substring heuristics.

**Rationale**: FR-001/FR-003 require position and ordering fidelity; segment rendering achieves it without touching the Markdown/sanitize/expound internals. The degradation path (disable, don't break) matches both the constitution's expound invariant and existing selection-menu behavior.

**Alternatives considered**:
- All images appended after the text block: loses model-authored ordering (violates FR-003 for text-after-image replies). Rejected.
- Inline `<img>` via markdown extension: re-opens the sanitize `data:` problem 018 explicitly closed. Rejected.

## R-6 Full-size view and download: shared lightbox with a download action

**Decision**: The existing click-to-expand fullscreen overlay (`UserMessage.svelte:52-64`) is extracted/reused as the shared image presentation and gains a **download** affordance (anchor with `download`, filename from the part's `name`/synthesized name); assistant thumbnails open the same overlay. Both full-size view and download are one click from the thumbnail (SC-005: ≤2 explicit actions).

**Rationale**: No download affordance exists anywhere today (expand-only); sharing one overlay keeps user-side and assistant-side presentation identical and the addition minimal. Zero new dependencies (native `<a download>`).

## R-7 Capability gate: `imageOutput` tri-state mirroring the 018 vision flag

**Decision**: Add `imageOutput?: 'auto' | 'on' | 'off'` to `ProviderConfig` (`src/lib/ai/types.ts:131-188`, sibling of `vision` at 164-172) with a static prefix allowlist + resolver in a new `src/lib/ai/image-output-capability.ts`, structurally mirroring `src/lib/ai/vision-capability.ts` (56 lines): pure, synchronous, advisory — never strips, blocks, or rewrites anything on the wire; a stale list never suppresses a working image. UI: a tri-state select in `ProviderConfig.svelte` (next to "Images (vision)" at 677-693), a badge chip in the model-select rows (next to the context-window badge, `src/lib/components/ai/model-select/model-select.svelte:78-89`), and a chat-page derived indicator following the `supportsVisionModel` pattern (`src/routes/chat/[id]/+page.svelte:102-108`). Provider 4xx/failure on an image turn is refined to a typed, plain-language error following `asImageUnsupportedError` (`src/lib/ai/errors.ts:188-198` → store catch at `chat.svelte.ts:779-785`).

**Rationale**: The 018 vision-flag contract (`docs/history/appendices/018-provider-vision-flag.md`) is the house pattern for fuzzy provider advertisement: permissive-with-clear-error, static allowlist, no runtime probing. Spec FR-006/US2 demand exactly this shape.

**Alternatives considered**:
- Probing the provider at boot: rejected by the 018 contract (no probing).
- Hard gate (block sends to non-capable models): explicitly forbidden by the advisory contract and spec FR-006 scenario 3. Rejected.

## R-8 Continuation context: project assistant image parts when the active model accepts image input

**Decision**: `projectEntries` (`src/lib/chat/projection.ts`) gains an assistant-row branch mirroring the user branch (221-247): when the active target model is vision-capable per the existing `supportsVision` gate, assistant image parts are emitted on the wire in order; otherwise the row projects text-only, silently (FR-011 degradation without errors). Token-weight estimation for these images remains un-estimated — the accepted deferred cost 018 already carries (`docs/history/018-image-chat-parts.qmd:41-43`).

**Rationale**: Follow-up turns ("make the chart blue") are the primary use case; gate reuse avoids sending images to text-only models.

## R-9 Backprop round-trip: artifact rows carry image parts; text payload carries positioned markers

**Decision**: `insertAnchored` (`src/lib/db/repositories/messages.ts:156-195`) is extended to accept `parts`; the branch artifact row (kind `branch_artifact`) carries the propagated turns' image parts (≤8 cap as everywhere), and the raw-mode payload text (`src/lib/chat/propagation.ts:27-52`) renders positioned `[image]` markers so the text record shows where images sat. `PropagatedArtifact` renders the parts with the shared image presentation. Model-facing projection of artifacts stays text (markers only) — the artifact is a text carrier for the parent model; the images are preserved for the *user's* record (spec US3 scenario 2), not re-sent to the model by the artifact itself.

**Rationale**: Today backprop drops image parts silently (propagation reads `content` only; artifact rows assert `parts === null`, `server/src/pg-import.test.ts:408`). Spec FR-010 requires the round-trip; carrying parts on the artifact row reuses every existing abstraction (kind, lane, metadata) per the standing ideas/008 ruling ("artifact reusing existing abstractions"), with the ≤8 cap bounding size.

**Alternatives considered**:
- Full model-side image projection of artifacts: widens scope; the parent model rarely needs the pixels (the summary text is the steering surface). Deferred.
- Weakening FR-010 to markers-only: silently drops user-visible content the spec promises. Rejected.

## R-10 Search / FTS: no changes, inherited by construction

**Decision**: Nothing to build. `search_vec` is `GENERATED ALWAYS` over `content` only (`packages/shared/src/fts.ts:4`); assistant image parts live in `parts` and never enter `content`, so the "no base64 noise in search" invariant (`src/lib/db/repositories/search.test.ts:284-349`) holds by construction. No reindex path, per constitution III/IV.

## R-11 Tests and mock fixture

**Decision**:
- Unit: extend `src/lib/agent/loop.test.ts` with scripted image parts (recognition, critic survival, finalize handoff).
- Store: extend `src/lib/stores/chat.svelte.test.ts` following the "T010 — US1" attachment block (1571-1810) — assistant row persists parts before/drain, abort keeps images, retry unaffected.
- Repo: extend `src/lib/db/repositories/repositories.test.ts` (parts invariants) + `messages.test.ts` (`insertAnchored` with parts).
- Projection: extend `src/lib/chat/projection.test.ts` (assistant parts on/off by vision gate) and `propagation.test.ts` (positioned markers).
- E2E: add an image-reply kind to the mock fixture (`tests/fixtures/mock-llm/server.mjs` — `classifyRequest` at 275-329 must learn it or 400s) whose wire shape is fixed by the R-2 spike outcome; all requests must ride the real browser → `/api/llm/proxy` → mock path (guardrail, `tests/fixtures/mock-llm/README.md:10-17`).

## R-12 Contracts placement; dangling reference note

**Decision**: Feature contracts live in `specs/030-image-generation/contracts/` (this feature's directory, per speckit layout). Note: four code comments cite `contracts/message-parts.md` (`src/lib/stores/chat.svelte.ts:159,479`; `src/lib/chat/projection.ts:230`; `src/lib/chat/projection.test.ts:115`) — a path that died with the removed specs/018 directory. This feature's `contracts/message-parts.md` restates and extends that contract (user + assistant sides); repointing or relocating those comments is a tasks-phase cleanup, out of scope for the plan proper.

## R-2 Addendum (implementation spike, 2026-11-09)

Resolved by reading the installed packages directly (`ai@7.0.4`, `@ai-sdk/google@4.0.2`, `@ai-sdk/openai-compatible@3.0.2`, `@ai-sdk/provider@4.0.0/4.0.1`, `@ai-sdk/provider-utils@5.0.1` — paths below are the real `.pnpm` homes of the `node_modules/*` symlinks).

**SDK shapes (exact)**:
- Model-stream file chunk (`LanguageModelV4File`): `{ type: 'file', mediaType: string, data: { type: 'data', data: Uint8Array | string } | { type: 'url', url: URL } }` — `node_modules/.pnpm/@ai-sdk+provider@4.0.0/node_modules/@ai-sdk/provider/dist/index.d.ts:2193-2222` (data union `SharedV4FileDataData`/`Url` at `:31-41`); it is a member of the `LanguageModelV4StreamPart` union (`:2576-2635`, file member `:2619`). Note v7 providers are spec V4, not V2 (ai d.ts `:113` accepts V4|V3|V2).
- `streamText` maps model `file`/`reasoning-file` chunks to fullStream parts: `{ type: 'file' | 'reasoning-file', file: GeneratedFile, providerMetadata? }` where `GeneratedFile = { base64: string, uint8Array: Uint8Array, mediaType: string }` — mapping at `node_modules/.pnpm/ai@7.0.4_zod@4.6.7/node_modules/ai/dist/index.js:8152-8166`; `TextStreamFilePart`/`TextStreamReasoningFilePart` in `ai/dist/index.d.ts:3005-3014`; `GeneratedFile` at `:1004-1019`; union `TextStreamPart` at `:3064`. So the R-2 guess "{ type:'file', mediaType, data }" is wrong for the ai layer — the payload is nested under `file`.
- fullStream `text-delta` is `{ type: 'text-delta', id, text, providerMetadata }` (`ai/dist/index.js:8097-8103`) — matches `consumeStream`'s `p.text` read (`src/lib/agent/loop.ts:171,179`).
- `steps[].content` / generated-message content is `ContentPart[]` including the same `{ type: 'file', file: GeneratedFile }` shape (`ai/dist/index.d.ts:1267-1293`, file variant `:1277-1280`) — irrelevant here (app never calls `generateText`), recorded for completeness.
- Raw-chunk escape hatch: `streamText({ includeRawChunks: true })` (option `ai/dist/index.d.ts:3503,3616`; plumbed `ai/dist/index.js:8545`) makes providers emit `{ type: 'raw', rawValue }` where `rawValue` is the parsed SSE JSON **before** zod stripping (`@ai-sdk/provider-utils` dist `:2698-2702,2743`), and ai forwards raw chunks into fullStream only when raw chunks are enabled (`ai/dist/index.js:9508-9513`).
- Caveat: URL-typed file data is not converted — `file.base64` would literally hold the URL string (`ai/dist/index.js:8155-8156` passes `chunk.data.url.toString()` into the base64 slot). Neither dialect below hits this (Google always sends base64; our shim defines its own output).

**Per-dialect verdicts**:
- **google: native, no shim.** Gemini response parts with `inlineData` are enqueued on the model stream as `{ type: part.thought === true ? 'reasoning-file' : 'file', mediaType: part.inlineData.mimeType, data: { type: 'data', data: <base64 string> } }` — `node_modules/.pnpm/@ai-sdk+google@4.0.2_zod@4.6.7/node_modules/@ai-sdk/google/dist/index.js:2101-2126` (doStream; same mapping in doGenerate `:1820-1832`; the stream schema accepts `inlineData` candidate parts `:2554-2560`). With `responseModalities` including `IMAGE` (request-side, already permitted via the gemini extra-body allowlist, `src/lib/ai/dialects.ts:58-64`), images arrive in fullStream as `{ type: 'file', file: { base64, uint8Array, mediaType } }`. Images flagged `thought: true` (thought signatures) arrive as `reasoning-file` and must be ignored, not persisted.
- **openai-compatible: dropped, shim required.** The chunk schema's `delta` object declares only `role/content/reasoning_content/reasoning/tool_calls` and zod strips unknown keys, so `delta.images` never survives parsing (`node_modules/.pnpm/@ai-sdk+openai-compatible@3.0.2_zod@4.6.7/node_modules/@ai-sdk/openai-compatible/dist/index.js:966-1001`); the non-stream `message` schema likewise has no `images` key (`:934-965`). The stream transform maps only reasoning/text/tool-call deltas (`:823-899`) — no branch can produce a file part. OpenRouter-style `choices[].message.images[]` / `delta.images[]` are silently dropped in both modes.
- No response-side post-processing exists in `src/lib/ai/` today: `dialects.ts` is request-side only (`resolveRequestSettings`, `src/lib/ai/dialects.ts:399-434`), and the provider `fetch` seam is auth-only (`src/lib/ai/sdk-factory.ts:28-42`). `wrapLanguageModel` middleware cannot help — it sees post-strip chunks; the images are already gone.

**Shim spec (openai-compatible only)** — lazy path, no SSE surgery, no new fetch layer:
- Enable `includeRawChunks: true` on the `streamText` calls, gated to `config.kind === 'openai-compatible'`: main call `src/lib/agent/loop.ts:354-362` and the critic-phase call `loop.ts:252-259` (only needed there because R-3 carries images through correction rounds). Gating matters: raw chunks duplicate every SSE payload in memory. (`github-copilot` also rides openai-compatible at `sdk-factory.ts:70-76` but emits no images; keep the gate narrow.)
- `consumeStream` gains a `raw` branch: extract `p.rawValue.choices?.[0]?.delta?.images[]`, each `{ type: 'image_url', image_url: { url } }` where `url` is a `data:<mime>;base64,<payload>` data URL (https URLs take the R-4 fetch-at-finalize path). The normalizer is a pure function `wireImage → { mediaType, base64 | url }` exported next to `dialects.ts` (same file or a sibling — fewest files wins).
- Images collected in the `raw` branch are returned from `consumeStream`'s result like `toolCalls` are today (`loop.ts:160-163,209`); R-3's finalize point persists them. Granularity is per-iteration (image-to-text interleave order within an iteration is not recoverable from raw chunks — accepted, matches R-3's finalize-time materialization).

**T006 directive**: `consumeStream` (`src/lib/agent/loop.ts:153-210`) must recognize `p.type === 'file'` — take `p.file.mediaType` + `p.file.base64` (ignore `p.type === 'reasoning-file'` entirely) — and, only when the dialect shim is active, `p.type === 'raw'` → extract `rawValue.choices[0].delta.images[]` (`image_url.url`, data-URL split into mime + base64); return collected images in the result. Everything else (persistence, capping) is R-3/R-4.

**T011 directive**: the mock fixture emits, per dialect — google-kind fixtures: SSE `candidates[0].content.parts[]` containing `{"inlineData":{"mimeType":"image/png","data":"<base64>"}}`; openai-compatible fixtures: SSE chunks with `choices[0].delta.images = [{ "type": "image_url", "image_url": { "url": "data:image/png;base64,<base64>" } }]` (the raw-chunk shim's input shape; no `message.images` — the app only streams).

## Perf measurement (T025, 2026-11-09)

Probe via `localStorage.mayon_perf=1` + `localStorage.mayon_perf_scenario`, `[mayon-perf]` 3s console summaries on the mock-llm dev stacks; values below are the single 3s window containing each turn's streaming+finalize activity. Mock fixture text turn = kitchen-sink SSE (~5s); image turn = 4-frame image_reply.

Baseline = image-less streaming on the pre-030 checkout (shimmer-check stack, :5173), scenario `stream-text`:

```
fps      n=173  avgMs=17.24  p50=16.70  p95=16.80  max=83.2  dropped=3
longtask 1x 50-100ms
cls      score=0.066  entries=2
marks    markdown:render n=24 totalMs=133.9 maxMs=36.5
renders  Markdown=11 TimelineRow=3 Highlighter=2 SectionStrip=1
```

030, scenario `stream-text` (image-less, same fixture turn):

```
fps      n=178  avgMs=16.76  p50=16.70  p95=16.70  max=33.3  dropped=1
longtask none
cls      score=0.122  entries=3
marks    markdown:render n=8 totalMs=32.5 maxMs=16.7
renders  TimelineRow=1 Markdown=4 Highlighter=2
```

030, scenario `stream-image` (image turn; activity straddles two 3s windows):

```
fps      n=179/179  avgMs=16.67/16.67  p50=16.70/16.70  max=16.8/16.8  dropped=0/0
longtask none
cls      score=0.0000247  entries=1
marks    markdown:render n=7 totalMs=11.8 maxMs=9.2 | n=2 totalMs=0.5 maxMs=0.3
renders  TimelineRow=3 Markdown=3 Highlighter=1 | Highlighter=1
```

Verdict: no user-perceptible regression for image-less replies — 030 stream-text holds 60fps with fewer dropped frames (1 vs 3) and no longtasks vs the pre-030 baseline; CLS is streaming-autoscroll growth in both (0.066 vs 0.122, same order of magnitude, no longtask driver). The image turn adds no dropped frames (0/0), no longtasks, negligible CLS (0.0000247), and its bounded placeholder shows without base64 rendering cost. markdown:render count differences vs baseline are chunk-batching differences between checkouts, not cost regressions (totalMs 32.5 vs 133.9 on the same fixture text).
