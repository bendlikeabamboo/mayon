# Quickstart: Validating Model-Generated Images in Chat (030)

**Spec**: [spec.md](spec.md) · **Contracts**: [message-parts.md](contracts/message-parts.md), [stream-image-parts.md](contracts/stream-image-parts.md), [image-output-capability.md](contracts/image-output-capability.md) · **Data model**: [data-model.md](data-model.md)

Runnable validation scenarios proving the feature end-to-end. Implementation details live in `tasks.md` (created by `/speckit.tasks`).

## Prerequisites

```bash
pnpm install
pnpm --filter @mayon/shared build   # fresh worktree: shared types must exist
pnpm dev                            # all-Docker dev stack (web :5173, server :4319)
```

Automated gates (must all pass before any manual scenario):

```bash
pnpm check && pnpm lint && pnpm test
```

## S1 — Stream recognition & finalize (automated)

Feed scripted image-bearing parts through the agent-loop tests (pattern: `scriptedFullStream` in `src/lib/agent/loop.test.ts`).

**Expect**: recognized images ride `pendingImages` through critic rounds and land in the finalized append call's `parts`; text buffer behavior unchanged for image-less streams.

## S2 — Assistant row persistence (automated)

Store-level tests (pattern: the "T010 — US1" attachment block in `src/lib/stores/chat.svelte.test.ts`).

**Expect**: an image reply persists as ONE assistant row with `parts` (ordered text+images), `content` = concatenated text; abort mid-reply-after-image persists the image with `interrupted: true`; repo rejects >8 images / text-mismatch (existing invariants now exercised on assistant rows).

## S3 — Render, search, projection, backprop (automated)

- Assistant rendering: segmented markdown + image grid; image-less replies byte-identical to today.
- Search: base64/data-URL noise never matches; conversation text still findable (`src/lib/db/repositories/search.test.ts` pattern).
- Projection: assistant image parts emitted only for vision-capable targets (`src/lib/chat/projection.test.ts` pattern).
- Backprop: artifact row carries parts; raw payload contains positioned `[image]` markers (`src/lib/chat/propagation.test.ts` pattern).

## S4 — Capability gate (automated)

Resolver unit tests + gate wiring test (pattern: `src/routes/chat/[id]/vision-gate.test.ts`).

**Expect**: `on`/`off` force; `auto` uses the static allowlist; resolver is pure and never touches request payloads; UI shows the tri-state and model badge.

## S5 — Mock LLM round trip (e2e)

With the dev stack up, run the Playwright suite against the `mock-llm` fixture's new image-reply kind (all requests must ride browser → `/api/llm/proxy` → mock; `page.route` interception is prohibited).

**Expect**: streamed reply delivers text with the live marker (`#msg-live-text`), then a placeholder, then a durable assistant message whose image renders after finalize; reload redisplays the image with zero provider requests (assert via fixture request log).

## S6 — Manual smoke (real provider)

Configure an image-capable model (e.g. a Gemini image model with `responseModalities` via existing `extraBody` support, or an OpenRouter/OpenAI-compatible image-capable model). On http://localhost:5173:

1. Ask for a chart/infographic → image renders inline in order with caption text.
2. Reload the page → image redisplays offline from the provider.
3. Open full-size; download the file (each ≤2 actions).
4. Ask a text-only model for an image → clear plain-language notice, nothing outside the block.
5. Branch the chat, generate an image, propagate to parent → parent shows the artifact with the image and `[image]` markers.
6. Take a backup; restore it → images survive.

**Expect**: every step matches its stated outcome; no page-level layout breakage; search in that conversation still finds text and never matches image data.
