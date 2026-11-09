# Implementation Plan: Model-Generated Images in Chat

**Branch**: `030-image-generation` | **Date**: 2026-11-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/030-image-generation/spec.md`

## Summary

Model-generated images (charts, infographics, illustrations) arrive inside assistant replies, render inline in order with the reply's text, and persist as `ImagePart`s on the existing `assistant_message` rows via the 018 parts architecture — no schema change, no new dependencies. Recognition happens at the single stream consumer (`consumeStream`) as atomic parts that bypass the string pacer and materialize at finalize; remote-URL delivery is materialized through the existing keychain/proxy fetch; an advisory `imageOutput` capability flag (sibling of the 018 vision flag) drives UI indication only. Rendering reuses the user-image presentation (outside Markdown) extended with segmented text/image ordering and a shared lightbox with download. Assistant image parts project to vision-capable models on continuation; branch artifacts carry propagated images with positioned markers. Research: [research.md](research.md) (R-1…R-12).

## Technical Context

**Language/Version**: TypeScript on Node 22 (pinned); SvelteKit static SPA (Svelte 5 runes).

**Primary Dependencies**: existing only — Vercel AI SDK v7 (`ai@^7.0.4`, `@ai-sdk/google@^4.0.2`, `@ai-sdk/openai-compatible@^3.0.2`), Tailwind v4 + shadcn-svelte, Drizzle. No new dependencies.

**Storage**: Postgres behind the `StorageDriver` seam (tests: pglite). Images persist as base64 data-URLs inside the existing nullable `parts` JSON-text column; they ride `pg_dump`/restore untouched.

**Testing**: Vitest (`pnpm test`, pglite driver) + `pnpm --filter @mayon/server test` where server-side; Playwright e2e against the `mock-llm` fixture (dev compose); `pnpm check` + `pnpm lint` gates.

**Target Platform**: browser SPA + Node server container (dev: Docker compose, `pnpm dev`).

**Project Type**: web application (SPA + server).

**Performance Goals**: streaming text behavior unchanged for image-less replies (no added perceptible delay); image materialization bounded so a persisted row fits the 16 MiB `/api/db/query` envelope; live placeholder instead of partial frames.

**Constraints**: constitution + AGENTS.md invariants (see Constitution Check); no secrets in settings; per-route body limits only (16 MiB precedent); no sanitize-schema changes; no FTS writes.

**Scale/Scope**: single-user daily-driver app; ≤8 images per reply (repo cap); one provider flag + allowlist module; ~10 source files touched, ~6 test files extended.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Layering (repos only, driver seam) | PASS | All persistence via `messagesRepo.append` / `insertAnchored`; drivers untouched. |
| I. No secrets in settings | PASS | `imageOutput` is a non-secret tri-state handle field. |
| I. `+` prefix / toolchain pins | PASS | No new files named `+*`; no new deps. |
| II. Tests with the change | PASS | Unit/store/repo/projection/e2e plan in research R-11; bug-fix-grade regression coverage for assistant-parts invariants. |
| II. FTS columns self-maintaining | PASS | No writes to `search_vec`; parts never enter `content` (inherited 018 construction). |
| III. UI vocabulary / progressive degradation | PASS | Reuses existing presentation patterns; capability advisory; server-less operation unaffected. |
| III. Expound offsets (sourcemap + DOM alignment) | PASS | Segmented rendering derives offsets from the concatenation invariant; bounded fallback = selection-menu disable for multi-segment messages (established precedent); no substring heuristics, no fallback spans. |
| IV. Perf measured / bundle justified | PASS | Zero new dependencies; perf probe before/after for streaming render changes is a tasks-phase requirement. |
| IV. Backup in-place | PASS | Untouched; parts are row data (restore tests extended, not changed). |

**Post-Phase-1 re-check**: design (research R-1…R-12, data-model, contracts) introduces no new seam, kind, migration, or dependency; the only constitution-adjacent risk (expound on segmented messages, R-5) is resolved inside the existing invariant with a disable-don't-break containment. All gates remain PASS.

## Project Structure

### Documentation (this feature)

```text
specs/030-image-generation/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions R-1…R-12
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output — validation guide S1–S6
├── contracts/           # Phase 1 output
│   ├── message-parts.md           # durable parts contract (user + assistant + artifact)
│   ├── stream-image-parts.md      # recognition → pendingImages → finalize contract
│   └── image-output-capability.md # advisory flag contract (018 vision-flag sibling)
└── tasks.md             # Phase 2 output ($speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/lib/
├── agent/
│   ├── loop.ts                        # consumeStream: recognize image parts; critic survival; finalize handoff
│   └── loop.test.ts                   # scripted image parts (pattern: scriptedFullStream)
├── ai/
│   ├── types.ts                       # ProviderConfig.imageOutput tri-state
│   ├── image-output-capability.ts     # NEW: allowlist + resolver (mirrors vision-capability.ts)
│   ├── errors.ts                      # typed image-output failure refinement
│   ├── dialects.ts                    # per-dialect wire normalization (spike outcome, if needed)
│   └── sdk-fetch.ts                   # reused for URL materialization (no change expected)
├── chat/
│   ├── kinds.ts                       # generated-image naming/alt helpers
│   ├── images.ts                      # output-side cap constants + re-encode reuse
│   ├── projection.ts                  # assistant branch emits image parts (vision-gated)
│   ├── propagation.ts                 # positioned [image] markers in raw payload
│   └── propagation.test.ts
├── stores/
│   └── chat.svelte.ts                 # pendingImages turn state; finalize parts; abort persist
├── db/repositories/
│   ├── messages.ts                    # insertAnchored accepts parts
│   └── messages.test.ts
├── components/
│   ├── chat/rows/AssistantMessage.svelte  # segmented rendering + shared image grid
│   ├── chat/rows/UserMessage.svelte       # shared lightbox extraction
│   ├── ai/ProviderConfig.svelte           # Image output tri-state select
│   └── ai/model-select/                   # image-output badge chip
└── routes/chat/[id]/
    ├── +page.svelte                   # derived imageOutput indicator (supportsVisionModel pattern)
    └── vision-gate.test.ts            # pattern for the new gate wiring test

tests/
├── fixtures/mock-llm/server.mjs       # image-reply kind (wire shape fixed by spike)
└── e2e/*.spec.ts                      # image reply round trip (real proxy path)
```

**Structure Decision**: single-repo SvelteKit app (existing layout); one new module (`image-output-capability.ts`) and one new shared component piece (lightbox extraction); everything else extends existing files. Server package unchanged (proxy already passes image payloads through as raw bytes).

## Complexity Tracking

No constitution violations to justify. (The pre-planned spike — R-2 — resolves the AI SDK part-type question before implementation and is the first tasks.md item.)
