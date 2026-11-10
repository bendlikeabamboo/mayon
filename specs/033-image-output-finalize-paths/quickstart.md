# Quickstart — Validate Feature 033 (Image Output Finalize & Follow-Up Paths)

All test runs MUST use the memory-capped low-spec wrapper (fleet rule; one process at a time):

```bash
WRAPPER='systemd-run --user --scope -p MemoryMax=500M --setenv=NODE_OPTIONS=--max-old-space-size=384'
```

SPA suites (run from repo root):

```bash
$WRAPPER pnpm test:low-spec src/lib/chat/projection.test.ts
$WRAPPER pnpm test:low-spec src/lib/agent/loop.test.ts
$WRAPPER pnpm test:low-spec src/lib/chat/images.test.ts
$WRAPPER pnpm test:low-spec src/lib/stores/chat.svelte.test.ts
```

Static checks:

```bash
pnpm check   # svelte-check
pnpm lint    # ESLint + Prettier --check
```

## Scenario walkthroughs (map to spec user stories)

### V1 — Follow-up after an image reply (US1 / FR-001)

- Unit: `projection.test.ts` — assistant row with `[text, image]` parts, `visionCapable: true`
  → assistant content contains `{ type: 'text' }` + `{ type: 'file', mediaType: 'image/png',
  data: <base64 without data: prefix> }`; every emitted part type is inside the SDK assistant
  union; `visionCapable` false/absent → text-only.
- Cross-seam: `loop.test.ts` — a two-iteration scripted turn (image reply, then follow-up)
  issues the second `streamText` with a prompt whose assistant content contains only
  SDK-legal part types (no `type: 'image'`).

### V2 — Image-only reply persists (US2 / FR-002)

- `loop.test.ts` — stream of only a `file` part (no text deltas) → one
  `appendAssistantText('', { images })` call; store-level: `chat.svelte.test.ts` — row
  persists with `content: ''` and image-only parts; reload keeps it.

### V3 — Abort keeps completed images, interrupted (US3 / FR-003)

- `loop.test.ts` (real loop, scripted stream): `file` part → text delta → hang → abort →
  `appendAssistantText` called with the image candidates; and image-only abort variant.
- `chat.svelte.test.ts` (real loop via base impl): interrupted row carries the image parts +
  `metadata.interrupted: true`. Replaces reliance on the mocked (b)-style test.

### V4 — Nine images → first eight + notice (US4 / FR-004)

- `chat.svelte.test.ts` — nine base64 candidates finalize → row has 8 image parts; content
  ends with the bracketed drop notice; no throw.

### V5 — text → image → text order survives (US5 / FR-005)

- `loop.test.ts` — image candidate carries `offset` between the two text stretches.
- `chat.svelte.test.ts` — persisted parts sequence `[text-a, image, text-b]`; concatenated
  text equals `content`; reload render order intact (data-level assertion).

### V6 — Corrupt/oversize contained (US6 / FR-006)

- `images.test.ts` — `applyOutputBudget` with a decode-rejecting ops stub returns
  `{ images, dropped }`, never throws.
- `chat.svelte.test.ts` — one valid + one garbage-base64 candidate → valid image + text
  persist, bracketed notice names the dropped image; over-cap corrupt payload same outcome.

### V7 — Notices fire when claimed (US7 / FR-007)

- `loop.test.ts` — `onImageRecognized` invoked once per recognized image.
- `chat.svelte.test.ts` — provider 4xx thrown mid-stream after recognition → typed
  "No image produced" notice (not raw, not network error); expected-model text-only success →
  row carries the bracketed no-image notice; non-expected model → no notice.

## Prerequisites

- `pnpm install` + `pnpm --filter @mayon/shared build` already done in this worktree.
- No dev stack needed (all scenarios are unit/store-level with pglite); optional manual smoke
  on `pnpm dev` is out of scope for the capped environment.
