# Quickstart: Image-First Chat (Multimodal-Ready) — Validation Guide

**Feature**: `018-image-chat-parts`

Runnable scenarios that prove the feature end-to-end. Design details live in
[plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md), and
[contracts/](./contracts/message-parts.md) — not duplicated here.

## Prerequisites

- Node 22 + pnpm 10 (`corepack`), Docker or Podman (`MAYON_DEV_ENGINE`).
- A vision-capable provider configured (e.g. an OpenAI-compatible gateway exposing `gpt-4o` /
  `claude` / `gemini` family models) with its API key set, **and** a non-vision model on some
  provider for the gating scenario.
- A ~3 MB retina screenshot (PNG) on the clipboard and as a local file; a small (<300 KB)
  PNG; a text snippet on the clipboard; a non-image file (e.g. `.pdf`).

## Setup

```bash
pnpm install
pnpm dev            # all-Docker dev stack; web on http://localhost:5173 (first run may need `pnpm dev:build`)
# optional perf probe for scenario 4: window.__MAYON_PERF__ = 1 in the browser console
```

## Scenario 1 — Paste a screenshot, the model reads it (P1 core loop)

1. Open a chat with a vision-capable model selected (paperclip visible in the composer).
2. Paste the screenshot into the composer → a thumbnail appears; remove/re-add it (remove works).
3. Type "what does this error say?" and send.
4. **Expected**: the user bubble shows the text plus the image thumbnail; clicking a thumbnail
   expands it; the assistant reply quotes actual visible text from the screenshot.

## Scenario 2 — Downsizing happens before send, day one (P4)

1. Attach the ~3 MB retina screenshot; open browser DevTools → Network.
2. Send and inspect the `/api/db/query` insert params and the `/api/llm/proxy` body.
3. **Expected**: the stored/sent image is the JPEG-downsized version — target ≤ ~500 KB
   (roughly 1568 px long edge), several-fold smaller than the input; screenshot text remains
   model-legible (scenario 1's reply proves it). Attaching the small PNG leaves it unchanged
   (passthrough, no generation loss). The composer never freezes during attach (see scenario 4).

## Scenario 3 — Vision gating and clear errors (P2)

1. Switch to a provider/model where vision is **not** advertised → paperclip hidden.
2. **Expected**: paste-with-image still attaches (permissive posture); sending shows a clear,
   specific "model doesn't accept images" error (not an opaque provider dump), with Retry that
   restores **text and attachments**.
3. Switch back to the vision-capable model → paperclip visible again.
4. In provider settings, set the vision override (`auto` / `on` / `off`) and confirm the
   paperclip follows it (`off` hides even for a known vision family; `on` shows for an unknown
   ID).

## Scenario 4 — Composer responsiveness (perf probe)

1. In the console: `window.__MAYON_PERF__ = 1` (optionally
   `localStorage.mayon_perf_scenario = 'image-attach'`).
2. Attach 3–4 multi-MB screenshots in quick succession while watching the `[mayon-perf]`
   summary.
3. **Expected**: no long-task spike that freezes typing (downsize+attach ≤ ~2 s for a typical
   screenshot); input latency stays in the normal band observed before the feature.

## Scenario 5 — Persistence, search, backup (P3)

1. Send a message with text + image; reload the page → image still renders.
2. Search (conversation search) for a distinctive word from that message's **text** →
   **Expected**: found, with a text snippet highlight — exactly as before images existed;
   image-only messages contribute no searchable words but don't break other results.
3. Settings → backup (download `.dump`), then restore it → **Expected**: restore completes
   in place (503 only during restore), images render correctly afterwards.

## Scenario 6 — Intake validation edge cases

- Paste copied **text** → pastes as text (existing behavior; not captured as attachment).
- Attach a `.pdf` → clear rejection naming supported formats (PNG/JPEG/WebP/GIF).
- Attach 9 images → the 9th is rejected with the per-message cap message.
- Attach a 25 MB image → rejected pre-decode with the size message.

## Automated gates (merge blockers)

```bash
pnpm check                              # svelte-check
pnpm lint                               # ESLint + Prettier
pnpm test                               # Vitest (pglite) — includes the new invariant tests below
pnpm --filter @mayon/server test        # server tests — includes the new body-limit tests
```

Key tests to observe passing (new in this feature):

- **Search invariant regression** (`src/lib/db/repositories/search.test.ts`): a parts-bearing
  row (text + image) is found by its text-part words via the real generated `search_vec`
  column; image data never matches.
- **Repo parts round-trip** (`src/lib/db/repositories/repositories.test.ts`): append with
  parts stores content = text-parts concat and the parts JSON atomically; legacy rows derive
  `[{type:'text'}]`.
- **Projection** (`src/lib/chat/projection.test.ts`): parts-bearing user rows project text +
  image parts; image-less rows produce byte-identical output to today.
- **Vision resolver + errors** (`src/lib/ai/…`): `supportsVision` allowlist/override table;
  image-unsupported provider failures classify to the dedicated message.
- **Intake/downsize** (`src/lib/chat/images…`): mime/size/cap validation; downsize output
  bounds on fixture images.
- **Server limits** (`server/src/…`): both routes registered with the 16 MiB limit; >1 MiB
  payloads succeed through the query handler and the proxy.
