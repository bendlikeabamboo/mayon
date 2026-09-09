# Implementation Plan: Smooth Streaming — Steady Cadence with a Soft Blur Edge

**Branch**: `022-smooth-streaming` (git: `add-streaming-text-blur-animation`) | **Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/022-smooth-streaming/spec.md`

## Summary

Streamed chat replies currently pop in chunk-by-chunk at network cadence. This feature inserts a pacing layer between the raw stream accumulator and the render copy the markdown renderer sees (extending the existing 80 ms `streamBufferRender` flush), releasing text at a steady, word-safe cadence with adaptive catch-up and an eased final drain. On top of it, a CSS blur/fade growth-edge overlay — rendered only in the live message row, outside any expound-monitored DOM — supplies the visual identity, with a plain-cursor variant for the Calm preset. One new settings-KV enum (`streamPreset`: Calm / Standard / Expressive, default Standard) exposes the look; no schema migration, no new dependencies, and the durable message DOM is byte-identical to today's by construction.

## Technical Context

**Language/Version**: TypeScript 5 (SvelteKit 2, Svelte 5 runes), Node 22, pnpm 10 (toolchain pins per AGENTS.md)

**Primary Dependencies**: Svelte 5 runes ($state/$derived/$effect), Tailwind v4 (CSS-first tokens in `src/app.css`), unified/remark/rehype markdown pipeline (`renderMarkdownLive`), Vercel AI SDK (`streamText` client-side). **Zero new dependencies.**

**Storage**: Postgres via `repos.settings` schema-less KV (one new key `streamPreset`; no drizzle migration, default resolved at read time). Message persistence flow unchanged.

**Testing**: Vitest (node env, jsdom opt-in, `vi.useFakeTimers()` convention, colocated `*.test.ts`); existing suites `chat.svelte.test.ts` (`mockStreamReply`), `selection.test.ts`, `sourcemap.test.ts`, `strip/pref.test.ts` as guardrails; Playwright E2E exists (dev-stack + mock-llm fixture) — optional extension only.

**Target Platform**: Browser SPA (modern Chromium/Firefox/Safari); server is transport-only (`/api/llm/proxy` pipe) — no server code changes.

**Project Type**: Web application (SPA + thin server container), existing repo layout.

**Performance Goals**: Markdown re-render cadence stays bounded by the 80 ms flush; pacing adds only O(prefix-scan) work per flush; frame pacing (probe fps p95) and CLS unregressed; final drain completes ≤ ~1 s after stream end.

**Constraints**: Hidden-but-arrived latency ≤ a few hundred ms while streaming (accepted, spec'd); message-body DOM invariants hold (canonical text equality for expound alignment, `EXCLUDED_CHROME_SELECTORS`, nothing appended inside `<pre>` except `.md-copy-btn`); overlay is `pointer-events-none`, `z-10`, reduced-motion-aware; preset default Standard = today's behavior exactly.

**Scale/Scope**: One client-side pacing module + one overlay component + one settings key + settings UI select + store wiring; ~6–8 files touched, all client-side.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Code Quality — layering | ✅ Pass | Settings accessed only via `repos.settings` through a single-writer accessor module (`strip/pref.ts` pattern). No `db` imports outside `src/lib/db/`. No new deps; no toolchain changes; no `+`-prefixed non-route files. |
| I. Code Quality — gates | ✅ Pass | `pnpm check` + `pnpm lint` are merge gates; scope is client TS/Svelte/CSS only. |
| II. Testing Standards | ✅ Pass | New behavior in `src/lib/` ships with tests (pacer unit tests w/ fake timers, pref defensive-read tests, store integration tests, perf-mark source-contract test). UI-only presentation changes verified via `pnpm check` + manual smoke on `pnpm dev`, per constitution. No `search_vec` writes, no reindex paths. |
| III. UX Consistency — component vocabulary | ✅ Pass | Overlay reuses established in-row overlay conventions: `z-10` + `pointer-events-none` (edge-fade/section-strip precedent), `motion-reduce:transition-none`, reduced-motion gating at the source (`motion/stagger.ts`), tokens/keyframes appended to `src/app.css`. |
| III. UX Consistency — progressive enhancement | ✅ Pass | Pure client-side feature; no server capability assumed; Standard preset renders exactly today's path. |
| III. UX Consistency — expound alignment | ✅ Pass | Overlay renders only in the live branch of `AssistantMessage` (no `Highlighter`, no alignment container there) and disappears at finalization; durable DOM unchanged → sourcemap/expound/search/copy untouched by construction. Overlay added to live branch contains zero text nodes, so no `EXCLUDED_CHROME_SELECTORS` change is needed. |
| IV. Performance Requirements | ✅ Pass (obligation) | Perf-sensitive: before/after measurement with the perf probe (`window.__MAYON_PERF__ = 1`, scenario tag) is a mandatory verification step in [quickstart.md](quickstart.md); pacing adds `mark('pacing:flush')` / `incRender` probes. No bundle growth (zero deps). Markdown re-render cadence remains bounded by the existing 80 ms flush. |

**Gate result**: No violations. Post-design re-check (Phase 1): still clean — the only semantic change to an existing contract is that normal completion now finalizes (persists the durable assistant row) *after* the eased drain (≤ ~1 s), documented in the pacer contract; the abort/error path keeps today's immediate full-flush + `interrupted: true` persistence. No complexity-tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/022-smooth-streaming/
├── plan.md              # This file
├── research.md          # Phase 0 output: pipeline research + design decisions
├── data-model.md        # Phase 1 output: entities, state, transitions
├── quickstart.md        # Phase 1 output: validation guide
├── contracts/           # Phase 1 output: module/UI contracts
│   ├── pacer-api.md
│   ├── stream-preset-setting.md
│   └── growth-edge-overlay.md
└── tasks.md             # Phase 2 output ($speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── chat/
│   │   └── streaming/               # NEW: pacing + preset feature module
│   │       ├── pacer.ts             # release-cadence controller (pure-ish, timer-injectable)
│   │       ├── pacer.test.ts        # fake-timer unit tests (toasts.svelte.test.ts pattern)
│   │       ├── pref.ts              # streamPreset settings-KV accessor (strip/pref.ts pattern)
│   │       └── pref.test.ts         # key stability / default / corrupt-JSON fallback tests
│   ├── stores/
│   │   └── chat.svelte.ts           # wire pacer into the streamBufferRender flush; deferred finalize on finish; abort fast-flush
│   ├── components/
│   │   ├── chat/
│   │   │   ├── GrowthEdge.svelte    # NEW: live-row overlay (blur/fade or caret variant), pointer-events-none z-10
│   │   │   └── rows/AssistantMessage.svelte  # live branch: mount GrowthEdge around <Markdown live>
│   │   └── settings/
│   │       └── ChatDisplayConfig.svelte      # streaming-look preset select (optimistic save)
│   └── app.css                      # overlay keyframes/tokens appended at bottom (expound-flash precedent)
└── routes/
    └── chat/[id]/+page.svelte       # load preset on mount → chatStore (stripEnabled pattern)

tests/fixtures/mock-llm/server.mjs   # OPTIONAL later: env-tunable CHUNK_INTERVAL_MS for E2E pacing asserts
```

**Structure Decision**: Single existing SPA layout; the feature is one cohesive client module (`src/lib/chat/streaming/`) plus narrow wiring points in the store, the live message row, the settings page, and `app.css`. No new routes, packages, or server code. Contracts for the three seams (pacer, setting, overlay) live in `contracts/`.

## Complexity Tracking

> No constitution violations to justify — table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
