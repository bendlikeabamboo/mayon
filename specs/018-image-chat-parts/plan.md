# Implementation Plan: Image-First Chat (Multimodal-Ready)

**Branch**: `018-image-chat-parts` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/018-image-chat-parts/spec.md`

## Summary

Users paste or attach an image into chat with vision-capable models; messages become
parts-based (ordered typed content parts — text + image now, other modalities later).
The LLM wire side already speaks parts (the client projects rows into AI SDK `ModelMessage`
parts arrays and the server proxy is a byte pipe), so the design work concentrates on three
seams: (1) storage — a new additive `messages.parts` JSON-text column carrying the ordered
parts (image bytes as base64 inline, per the accepted single-user-scale decision) while
`content` stays the canonical flat text so the `search_vec` generated column keeps extracting
from message text untouched; (2) client — composer paste/attach with client-side
downsize/compress before send (day-one, per spec), thumbnail previews, vision gating of the
paperclip from a new provider-config vision flag following the existing `toolCapability`
pattern; (3) transport limits — a bounded `bodyLimit` override on `/api/db/query` and
`/api/llm/proxy` (Fastify's 1 MiB default would reject downsized base64 payloads), using the
existing per-route override precedent (backup routes already use 512 MiB).

## Technical Context

**Language/Version**: TypeScript 5.x on Node 22 (`.nvmrc`); SvelteKit (Svelte 5 runes) SPA via
`@sveltejs/adapter-static` (no SSR); pnpm 10 workspace (`server/`, `packages/shared/`, root app).

**Primary Dependencies**: Svelte 5, Tailwind v4 + shadcn-svelte (bits-ui), Vercel AI SDK v7
(`ai` + provider packages; runs in the browser), drizzle ORM (pg-proxy driver), Fastify
(server), Postgres 17 (prod/dev) / PGlite (tests). No new dependencies required — image
downsizing uses the native Canvas API.

**Storage**: Postgres, single shared drizzle schema behind the `StorageDriver` seam
(browser → `RemotePgDriver` → `POST /api/db/query`). Image bytes live inline in a new
`messages.parts` JSON-as-text column (house encoding style), riding pg_dump/pg_restore
backup unchanged. Full-text search stays on the `search_vec` `GENERATED ALWAYS ... STORED`
column over `messages.content` — expression untouched.

**Testing**: Vitest — root `pnpm test` (PGlite driver; runs drizzle migrations + FTS bootstrap
per test DB), `pnpm --filter @mayon/server test` for server-side. Merge gates:
`pnpm check`, `pnpm lint`, `pnpm test`, server tests.

**Target Platform**: Browser SPA (desktop-first) + Node server container + Postgres; all-Docker
dev stack via `pnpm dev`.

**Project Type**: Web application (SPA + API server), existing `src/` / `server/` /
`packages/shared/` workspace.

**Performance Goals**: Composer stays responsive during image preparation (no main-thread
freeze; downsized + attached in ≤2 s for a typical ~3 MB screenshot, SC-007); no perceptible
change to search latency (SC-004); send-path overhead dominated by one downsize pass.

**Constraints**: Fastify request-body ceiling — must raise per-route `bodyLimit` on
`/api/db/query` and `/api/llm/proxy` (default 1 MiB rejects multi-hundred-KB base64 images);
image payloads ride JSON params as base64 (~+33%); ~500 KB per-image target after downsizing
(SC-002); ≤8 images per message (guardrail, spec assumption); restore stays
`--single-transaction` atomic with the 503 restoring flag; zero writes to `search_vec`, no
reindex affordances; no new runtime dependencies (bundle-growth gate).

**Scale/Scope**: Single-user local deployment (~1–2 GB/yr image growth accepted); one feature
surface (chat composer + message rendering + provider settings flag) touching ~8 existing
modules plus storage migration; no server parsing changes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status | Notes |
|------|--------|-------|
| I. App code calls repositories only; `db` private to `src/lib/db/` | ✅ Pass | Parts read/written only via `messagesRepo`; components get parts through existing store/repo paths |
| I. `StorageDriver` is the only storage seam; drivers stay dumb | ✅ Pass | No driver-interface changes; image bytes are plain SQL params, driver logic unchanged |
| I. `pnpm check` + `pnpm lint` gates | ✅ Planned | Standard gates run before merge |
| I. No secrets in settings; keys in IndexedDB | ✅ Pass | Vision flag is a non-secret handle field on `ProviderConfig`; no key handling changes |
| II. `pnpm test` + server tests must pass; tests accompany new behavior | ✅ Planned | Regression test for the search-over-text-parts invariant; repo/projection/composer tests listed in quickstart |
| II. `search_vec` is generated; never written; no rebuild paths | ✅ Pass | Generated-column SQL untouched — `content` remains the searchable text, so the invariant holds by construction; regression test added |
| III. Tailwind v4 + shadcn-svelte vocabulary; match existing conventions | ✅ Pass | Thumbnails/preview chrome reuse existing primitives and composer patterns |
| III. Progressive degradation; UI must not assume server presence | ✅ Pass | Images ride the already server-gated chat path (pg + llm-proxy caps); raw-fetch fallback (no llm-proxy) still works since data-URL parts are ordinary request body |
| III. No downtime/restart from user-facing operations | ✅ Pass | Additive nullable column migration; restore pipeline unchanged (generated columns are excluded from `--data-only` inserts and recompute on INSERT) |
| III. Expound offsets via source map + DOM alignment | ✅ Pass | Images render as sibling elements in the user bubble, outside the Markdown pipeline — no new markdown-injected DOM, no source-map impact (verify exclusion list unaffected during implementation) |
| IV. Perf-sensitive changes measured with the perf probe | ✅ Planned | Composer image-prep measured with `window.__MAYON_PERF__` before/after (SC-007) |
| IV. Restore preserves `--single-transaction` + 503 flag semantics | ✅ Pass | No backup/restore code changes; larger rows only lengthen the existing single transaction |
| IV. Bundle growth justified; no heavy dependencies | ✅ Pass | Zero new dependencies (Canvas API + native file input); `@mayon/shared` type additions are source-only |
| Quality gates: drizzle migrations via `pnpm db:generate` | ✅ Planned | Additive column generated from `src/lib/db/schema.ts`; no hand-edited SQL |

**Gate result**: no violations. **Post-design re-check (after Phase 1)**: still no violations —
the two notable design choices (bounded `bodyLimit` override on two routes; `parts` as
JSON-as-text house-style column) follow documented precedent and are recorded in
[research.md](./research.md#d4-raise-the-request-body-limit-on-two-routes) and
[data-model.md](./data-model.md); neither deviates from a documented seam.

## Project Structure

### Documentation (this feature)

```text
specs/018-image-chat-parts/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── message-parts.md
│   ├── provider-vision-flag.md
│   └── http-limits.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/                                  # SvelteKit SPA (main app)
├── lib/
│   ├── db/
│   │   ├── schema.ts                 # + messages.parts (nullable text, JSON parts array)
│   │   └── repositories/
│   │       └── messages.ts           # append() gains optional parts; parts accessors
│   ├── chat/
│   │   ├── context.ts                # assembleContext carries parts on ChatMessage
│   │   ├── projection.ts             # user rows project text + image parts (ModelMessage)
│   │   ├── kinds.ts                  # parts types / derivation helpers (shared with UI)
│   │   └── images.ts                 # NEW: paste/attach intake + canvas downsize/encode
│   ├── ai/
│   │   ├── types.ts                  # ChatMessage gains optional parts; ProviderConfig.vision
│   │   ├── vision-capability.ts      # NEW: 'auto'|'on'|'off' resolver (allowlist, toolCapability precedent)
│   │   └── errors.ts                 # + image-unsupported error branch
│   ├── stores/
│   │   └── chat.svelte.ts            # send() persists parts; retry restores attachments
│   └── components/
│       ├── chat/
│       │   ├── Composer.svelte       # paste/attach handlers, thumbnail strip, vision-gated paperclip
│       │   └── rows/UserMessage.svelte  # render image parts (thumbnails → expand), text via Markdown
│       └── ai/
│           └── ProviderConfig.svelte # vision setting control
├── routes/chat/[id]/+page.svelte     # wire composer attachments into onSend
└── lib/db/driver/pg.ts, server routes (below) unchanged in contract

server/src/
├── server.ts                         # + bodyLimit on /api/db/query registration (pg.ts) — see contracts/http-limits.md
├── llm-proxy.ts                      # + bodyLimit on /api/llm/proxy (still a byte pipe; zero parsing)
└── fts.ts, pg-backup.ts, pg.ts       # UNTOUCHED (FTS bootstrap, backup/restore, query handler)

packages/shared/src/
├── protocol.ts                       # LlmProxyRequest envelope unchanged (opaque body)
└── fts.ts                            # UNTOUCHED — search_vec expression keeps reading messages.content

drizzle/
└── 000X_*.sql                        # generated by pnpm db:generate: ALTER TABLE messages ADD COLUMN parts text
```

**Structure Decision**: Existing workspace layout extended in place — SPA feature code under
`src/lib/{chat,ai,stores,components/chat,db}`, server touches limited to two route
registrations in `server/src/`, shared types in existing modules (`src/lib/ai/types.ts`,
`src/lib/chat/kinds.ts`), one generated drizzle migration. No new packages, no new top-level
directories.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None — Constitution Check passes pre- and post-design with no deviations from documented
seams.
