# Phase 0 Research: Image-First Chat (Multimodal-Ready)

**Feature**: `018-image-chat-parts` | **Date**: 2026-09-02

All NEEDS CLARIFICATION items from Technical Context are resolved below. Grounding evidence
comes from code inspection of the current tree (paths verified in this worktree) and the
accepted trade-offs recorded in `specs/018-image-chat-parts/spec.md`.

## D1. Parts storage: additive `messages.parts` JSON-text column; `content` stays canonical text

**Decision**: Add a nullable `parts` `text` column to `messages`, holding the ordered typed
content parts as a JSON string (house encoding style — `metadata`, `chats.brief`, `labs.checklist`
are all JSON-as-text). `messages.content` remains `NOT NULL text` and stores exactly the
concatenation of the message's text parts (for parts-bearing rows, written by the app at
append time; for legacy rows, it is already the whole text).

**Rationale**: Every current consumer of `Message.content` as a string (context assembly for
generate orchestrators, title/brief/quiz generation via `String(m.content)`, search
`ts_headline`, DiagnosticsPanel, MessageList empty-trim, draft persistence) keeps working
unchanged. The `search_vec` generated column reads `messages.content`
(`packages/shared/src/fts.ts:4`), so the full-text-search invariant ("search extracts from the
text part") holds **by construction, with zero FTS changes**. An additive nullable column needs
no data migration for existing rows (null parts ⇒ derive `[text]` from `content`), and drizzle
`pnpm db:generate` produces it cleanly.

**Alternatives considered**:
- *Move everything into `parts`, rewrite `search_vec` over JSON extraction* — rejected:
  a `GENERATED ALWAYS ... STORED` expression cannot iterate a parts array (no set-returning
  functions/subqueries; JSON text-part aggregation requires a helper function with dubious
  IMMUTABILITY across PG versions). High invariant risk for zero user-visible gain, and the
  spec explicitly flags search as the "once, sneaky" snag to protect.
- *Store parts inside `metadata` JSON* — rejected: `metadata` carries per-kind semantics
  (`{hidden}`, `{choicesEntryId}`, `{interrupted}`, …); multi-hundred-KB byte blobs would
  pollute every metadata reader and conflates concerns.
- *Separate `message_images` table* — rejected: images have no lifecycle separate from their
  message (created/backed-up/deleted with it); a join table adds ord-sync complexity and a
  second insert round-trip on the hot send path for no benefit at single-user scale.

## D2. Image byte representation: base64 data-URL strings inside the parts JSON

**Decision**: Each image part stores the downsized image as a base64 data-URL string
(`data:image/jpeg;base64,...`) plus descriptive attributes (mime, pixel width/height, byte
size). No `bytea`, no separate blob store.

**Rationale**: The `StorageDriver` seam moves JSON params over HTTP (`POST /api/db/query`);
binary would need its own encoding anyway (base64/hex) with no driver simplification. Data-URLs
are directly usable by the AI SDK image part (string form) and by `<img src>` in the UI — one
copy serves storage, wire, and render. At the accepted scale (~1–2 GB/yr, spec-assumption),
the ~33% base64 overhead is immaterial, and bytes ride pg_dump/pg_restore unchanged
(generated `search_vec` columns are excluded from `--data-only` inserts, so restore is safe).
Spec FR-008 ("stored as part of the message in the primary store") is satisfied literally.

**Alternatives considered**:
- *`bytea` column* — rejected: no precedent (zero `bytea` in schema), no size win after base64
  on the wire, and every read would add a client-side encode step.
- *Filesystem/object store on the server* — rejected: violates FR-008 (bytes must live with the
  message and ride the pg_dump story), adds a new capability seam and a non-atomic
  message+blob write.

## D3. Client-side downsizing: native Canvas, 1568 px long edge, JPEG q0.85, small-PNG passthrough

**Decision**: On attach/paste (before anything is stored or sent): decode via
`createImageBitmap`, downscale so the long edge ≤ 1568 px (the patch-grid sweet spot used by
major vision providers; larger buys no model legibility), re-encode to JPEG quality 0.85
(flat white background for alpha) targeting ≤ ~500 KB (SC-002). Pass-through untouched when
the source is already small (≤ ~300 KB and ≤ 1568 px) to avoid generation loss. Animated GIFs
contribute their first frame (canvas decode semantics). Output size logged to the part's
`bytes` attribute.

**Rationale**: Spec FR-005 + the resolved blob-storage decision make day-one downsizing
mandatory ("conditional on client-side downsizing"). Native Canvas API = zero new dependencies
(constitution bundle gate). 1568 px keeps screenshot text legible to vision models while
cutting a ~3 MB retina PNG to well under 500 KB.

**Alternatives considered**:
- *WebP output* — smaller, but provider-side data-URL mime support is uneven; JPEG is the
  lowest common denominator. Revisit later.
- *Keep original PNG for screenshots (lossless)* — rejected: retina screenshots are the
  multi-MB case the spec calls day-one work; JPEG q0.85 keeps text readable (validated in
  quickstart scenario 2).
- *Worker-based encoding* — deferred; `createImageBitmap`+canvas off the hot path is fast
  enough for ≤8 images, and perf-probe measurement (SC-007) will flag if a worker becomes
  necessary. Noted as a follow-on, not a launch need.

## D4. Raise the request-body limit on two routes

**Decision**: Register `POST /api/db/query` and `POST /api/llm/proxy` with
`bodyLimit: 16 * 1024 * 1024` (16 MiB). Nothing else about either route changes — the
`/api/llm/proxy` envelope (`LlmProxyRequest` with opaque string body) and the `/api/db/query`
op/sql/params schema are untouched, and the proxy remains a byte pipe (FR-004 pass-through is
already its behavior).

**Rationale**: Fastify's default is 1 MiB (`server/src/server.ts:40` — `Fastify()` with no
options). One downsized 500 KB image ≈ 667 KB base64; a single append with several images, or
an LLM request whose context carries several images, exceeds 1 MiB and would fail with
`FST_ERR_CTP_BODY_TOO_LARGE`. Per-route override is the established precedent (backup/import
routes already use `bodyLimit: 512 * 1024 * 1024`). 16 MiB is comfortably above the 8-image
guardrail with context headroom while staying bounded.

**Alternatives considered**:
- *Chunked uploads* — rejected: complexity (reassembly, partial-failure states) unjustified at
  this scale; the spec caps images per message.
- *Global higher `bodyLimit`* — rejected: widen only what must widen; other routes keep the
  conservative default.
- *Compress request bodies* — rejected: new client/server encoding contract for marginal gain;
  base64-over-JSON at 16 MiB ceiling is well within Fastify/Node norms.

## D5. Vision capability: `ProviderConfig.vision: 'auto' | 'on' | 'off'` + static resolver

**Decision**: Add an optional `vision` field to `ProviderConfig` (settings key `providers`,
non-secret handle field — no secret-handling impact), defaulting to `'auto'`. Resolution
follows the `toolCapability` precedent (`src/lib/agent/capability.ts`): `'auto'` consults a
small static allowlist of vision-capable model-family prefixes (gpt-4o/gpt-4.1/gpt-5/o4,
claude-3+/claude-4, gemini-1.5+/gemini-2/gemini-3, llama-3.2-vision, qwen-vl/qwen2-vl, etc.),
`'on'` forces advertised, `'off'` forces hidden. The resolved boolean gates the paperclip
(FR-006) and the pre-send posture (FR-007).

**Rationale**: No per-model capability object exists today; `/models` discovery deliberately
keeps IDs only. `toolCapability` (`'auto'|'on'|'off'` + resolver) is the established in-repo
pattern for exactly this shape of fuzzy, provider-dependent capability, and spec assumptions
mandate permissive-with-clear-error, not omniscient gating. Provider templates
(`src/lib/ai/registry.ts`) can seed the field like they seed `toolCapability`.

**Alternatives considered**:
- *Per-model static table like `ENDPOINT_DIALECTS`/`MODEL_OVERLAYS`* — considered; subsumed by
  the `'auto'` allowlist (same mechanics, one field, provider-level override included).
- *Probe the provider at runtime* — rejected: no standard vision-probe endpoint across
  providers; cost and latency for a gate the spec says must stay humble.
- *Always show the paperclip* — rejected: contradicts FR-006 (control appears only when vision
  is advertised).

## D6. Unsupported-model error: typed branch in the existing error pipeline + pre-send posture

**Decision**: If an image-bearing send reaches a model whose resolved vision support is false
(or a provider 4xx indicates image rejection), surface a dedicated branch in
`formatProviderError` (`src/lib/ai/errors.ts`) producing a clear title/message/hint
("this model doesn't accept images; remove the attachment or switch models"), flowing through
the existing `mapSdkError` → chat-store error block with Retry. The paperclip gate (D5) stays
advisory; nothing silently strips images.

**Rationale**: FR-007 requires clear, specific errors ahead of opaque provider output. The
pipeline (`httpStatusToError` → `mapSdkError` → `formatProviderError` → red error block +
Retry) already generalizes; the tools-off retry precedent (`loop.ts`) shows capability-driven
fallbacks belong at this layer. Retry restores the failed prompt — it must restore attachments
too (parts carried in `lastFailedPrompt` state), and the dangling-user-row delete on retry
already covers parts-bearing rows.

**Alternatives considered**:
- *Hard pre-send block when unadvertised* — rejected: spec mandates permissive-with-clear-error
  (advertisement is fuzzy; a working vision model behind a stale allowlist must still work).
- *Intercept provider 400s with generic text* — rejected as primary: pattern-matching provider
  bodies is brittle; used only as a fallback classification for image-bearing requests.

## D7. Rendering: image parts render outside the Markdown pipeline in the user bubble

**Decision**: `UserMessage.svelte` renders the message's text through the existing
`<Markdown>` element and image parts as sibling thumbnail elements (existing Tailwind/bits-ui
styling), clicking a thumbnail expands to full size. The markdown pipeline
(`render.ts`, sanitize schema) is **unchanged** — image parts never enter markdown source.

**Rationale**: The sanitize schema strips `data:` URI `src` values (hast-util-sanitize GitHub
default allows only http/https), so markdown-embedded images would require schema loosening —
unnecessary attack surface since parts render as real elements with browser-native loading.
Keeping images out of the markdown DOM also means **zero expound/source-map interaction**
(Highlighter wraps assistant rows only; user bubbles are plain), satisfying FR-011 by
construction. Assistant rows never carry images in this release (models here return text),
so no assistant-side work.

**Alternatives considered**:
- *Extend sanitize schema to allow `data:` images in markdown* — rejected: widens the sanitize
  surface for no requirement; FR-009 only asks for thumbnail + expand.
- *Lightbox component* — deferred; "expand to view" is satisfied by a simple overlay/new-tab
  view per the shallow-depth trade-off. Choose at tasks time with existing primitives.

## D8. Send-path wiring: composer holds attachments; `send()` persists parts in one append

**Decision**: The composer maintains an ordered attachment list (paste + paperclip intake via
`src/lib/chat/images.ts`), each entry already downsized. `onSend` passes text + attachments to
`chatStore.send`, which appends the user row **once** via an extended
`messagesRepo.append(chatId, 'user', content, { parts })` — content = text parts'
concatenation, parts = full ordered array (text part + image parts). No second write, no
orphan risk (FR-015: a failed send leaves no row, as today — the append happens before the
LLM call exactly like the current text flow).

**Rationale**: Matches the current single-append persist-then-stream flow
(`chat.svelte.ts:333`), keeps `ord` semantics untouched, and gives the atomic
message+images insert the spec's no-orphan requirement rides on. Ordering: the composer keeps
text and images as separate concerns in v1 (text part first, then images in attachment order);
interleaved text/image ordering is a later-slice concern the parts structure already
accommodates.

**Alternatives considered**:
- *Persist attachments to settings keyed by chat before send (like MCP resource attachments)* —
  rejected: those are text notes injected as system text; images are first-class message
  content (FR-003), and double-bookkeeping invites divergence.
- *Batch statement (insert row + insert parts row)* — moot given D1 single-column design.

## D9. Limits and intake validation

**Decision**: Accepted image formats: PNG, JPEG, WebP, GIF (any; animated → first frame).
Reject other mime types/extensions with a message naming supported formats (FR-012). Caps:
≤ 8 images per message; reject input files > 20 MB before decoding (with a clear message).
Non-image clipboard pastes keep existing text-paste behavior untouched.

**Rationale**: Spec edge cases + the 8-image assumption; 20 MB pre-decode cap prevents
canvas-decode memory spikes on pathological inputs while never rejecting realistic screenshots
(which downsizing then handles). Intake validation lives in `src/lib/chat/images.ts` (tested
pure logic: mime sniffing by magic bytes where mime is missing).

**Alternatives considered**: 4-image cap (more conservative but arbitrary), no cap (spec
requires a guardrail). 8 matches the assumption recorded in the spec.

## D10. LLM payload: AI SDK projects parts; proxy passes through; context-split counts text only

**Decision**: `assembleContext` carries `parts` on `ChatMessage` (optional field;
`content` string unchanged); `projectEntries` emits the user row as
`[{type:'text'},{type:'image',image:dataURL}...]` parts (AI SDK `ModelMessage` already supports
image parts and already merges parts arrays). `streamText` passes messages untouched; the proxy
forwards the serialized body verbatim (FR-004). Context splitting/token estimation continues to
count text only — image token weight is not estimated (the token-cost affordance is explicitly
post-launch per the spec).

**Rationale**: Zero server parsing, zero envelope changes, and the diagnostic trace flattening
(`extractPartContent`) degrading to text-only traces is acceptable (known, harmless — image
parts won't appear in request traces; noted for tasks). Title/brief/quiz generation keep using
`content` text, so titles remain text-derived (images don't influence titles — acceptable,
documented).

**Alternatives considered**:
- *Hand-build provider JSON to control image part shape per provider* — rejected: re-implements
  the AI SDK provider layer; FR-004 demands pass-through, which the SDK + byte-pipe proxy
  already deliver.
- *Estimate image tokens in context-split* — deferred with the token affordance (spec
  trade-off).

## Resolved unknowns summary

| Unknown from Technical Context | Resolution |
|---|---|
| Storage shape for parts vs flat content column | D1 — additive `parts` JSON-text column, `content` stays text |
| Image byte representation | D2 — base64 data-URLs in parts JSON |
| Multi-MB screenshot handling | D3 — Canvas downsize 1568 px / JPEG q0.85 / ≤500 KB target, day-one |
| Transport size ceiling | D4 — 16 MiB `bodyLimit` on `/api/db/query` + `/api/llm/proxy` |
| Vision advertisement across fuzzy providers | D5 — `vision: 'auto'|'on'|'off'` + allowlist resolver |
| Clear error on unsupported model | D6 — typed error branch + retry-with-attachments |
| Rendering without breaking sanitize/expound | D7 — parts render outside markdown pipeline |
| Persistence atomicity on send | D8 — single append with parts |
| Caps and format validation | D9 — 8 images/msg, 20 MB input cap, 4 formats |
| Wire pass-through + token accounting | D10 — AI SDK parts projection; proxy untouched; text-only token split |

No NEEDS CLARIFICATION items remain.
