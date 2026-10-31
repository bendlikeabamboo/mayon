# Implementation Plan: Optional User-Defined Telemetry (Langfuse First)

**Branch**: `026-optional-telemetry` | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/026-optional-telemetry/spec.md`

## Summary

Optional, owner-configured telemetry that ships every LLM interaction to the owner's Langfuse project for prompt improvement and data gathering. Capture happens in the web app at the existing agent trace seam (the only point where provider-agnostic input/output/usage/outcome plus conversation identifiers all exist, including browser-direct traffic the server proxy never sees); records are finalized per capture mode in the browser, relayed same-origin to the server, and delivered by a small server-side background pipeline to Langfuse's public ingestion API. Strictly off by default; disabling discards pending records; metadata-only mode removes conversation text before a record leaves the browser. No new database tables, no new SPA dependencies, no new secrets in the settings store (the Langfuse secret key follows the `MAYON_AUTH_SECRET` env precedent).

## Technical Context

**Language/Version**: TypeScript throughout — SvelteKit/Svelte 5 runes SPA (web), Node 22 server package (`@mayon/server`), shared types in `@mayon/shared` (tsup, built before consumers).

**Primary Dependencies**: Existing stack only. Web: Vercel AI SDK call sites (already present, read-only context for capture), `settingsRepo` for config. Server: Fastify (`registerX(app)` module pattern), global `fetch` for Langfuse calls. **No new runtime dependencies** — the Langfuse client is a small typed module over the public ingestion HTTP API (see [research.md](./research.md#d3)).

**Storage**: Non-secret telemetry config as one `settings` KV row (`telemetry`) in Postgres via `settingsRepo` (web) — server reads it directly with the `getSecurityMode` TTL-cache precedent (`server/src/server.ts:55-84`). Langfuse secret key: `MAYON_LANGFUSE_SECRET_KEY` env var (docker-compose `environment:`, owner's `.env`), mirroring `MAYON_AUTH_SECRET`. Pending records: bounded in-memory queue on the server (drop-oldest); small in-memory buffer in the browser relay. No drizzle migration (settings KV is schemaless rows).

**Testing**: Vitest both packages. Web: `useFileTestDb()` pglite driver + repos, `vi.mock('ai')` for chat paths (`src/lib/stores/chat.svelte.test.ts` pattern). Server: `buildApp(':memory:')` + `app.inject()` + `vi.stubGlobal('fetch', ...)` for Langfuse (`server/src/llm-proxy.test.ts` pattern). E2E: mock-llm fixture suite (`tests/fixtures/mock-llm/`) plus a stub Langfuse receiver for delivery assertions.

**Target Platform**: Dockerized deployment (web SPA + server + Postgres); dev via `pnpm dev`. Langfuse destination is owner-provided (cloud or self-hosted, any reachable URL).

**Project Type**: Web application (SPA + backing server).

**Performance Goals**: Zero user-perceptible chat latency from capture or relay (fire-and-forget off the interaction path); capture overhead measured with the perf probe per constitution IV. Server flush batching: ≤5s interval or ≤20 records per batch to Langfuse.

**Constraints**: FR-002 zero-emission-when-off must hold at network level; capture must cover all providers including browser-direct (Ollama, loopback); no secret material in the settings KV or SPA bundle; bounded memory (queue ≤500 records, per-field content cap ~128 KiB with truncation marker); server flush failures must back off, never storm.

**Scale/Scope**: Single-user self-hosted deployment; tens of LLM calls per session. v1 scope: chat turns plus the side generators (title, brief, quiz, grading, lab, branch summary, MCP sampling).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I. Code Quality — layering | Telemetry capture is app code in `src/lib/` using repositories only; no component imports `db` | PASS |
| I. Code Quality — no secrets in `settings` | Only non-secret config (host URL, public key, mode, enabled flag) in settings KV; secret key in env per `MAYON_AUTH_SECRET` precedent | PASS |
| I. Code Quality — toolchain pins | No new deps; Node 22/pnpm 10 unchanged | PASS |
| II. Testing | New behavior in `src/lib/` and `server/src/` accompanied by Vitest tests both packages; regression test for disable-discards-queue | PASS (planned in quickstart) |
| III. UX — progressive capability | Telemetry degrades to inert no-op when disabled/unconfigured; UI never assumes delivery works | PASS |
| III. UX — no downtime ops | Config changes applied via API without restart; disable immediate | PASS |
| IV. Performance | Capture/relay off hot path; measured with perf probe before/after; no SPA bundle growth (no new deps) | PASS |
| Seams authority | New telemetry seam (capture tap, relay API, outbound client) documented in `docs/reference/seams.qmd` as part of implementation | PASS (task listed in structure) |

Post-Phase-1 re-check: data model adds no tables (settings KV row only — no `pnpm db:generate`), server route module follows `registerX` pattern, shared protocol types extend `@mayon/shared` with rebuild ordering respected. No violations; no complexity tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/026-optional-telemetry/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions D1–D9
├── data-model.md        # Phase 1 output — entities + validation
├── quickstart.md        # Phase 1 output — validation scenarios V0–V7
├── contracts/
│   ├── telemetry-api.md       # web ↔ server relay/config/status API
│   └── langfuse-ingestion.md  # server → Langfuse outbound contract
└── tasks.md             # Phase 2 output ($speckit-tasks — NOT created by this command)
```

### Source Code (repository root)

```text
packages/shared/src/
└── protocol.ts                  # + TelemetryConfig, TelemetryEventRecord, TelemetryStatus, relay bodies

src/lib/
├── telemetry/
│   ├── state.svelte.ts          # reactive enable/mode state, boot-initialized from settings
│   ├── capture.ts               # record assembly + mode-based stripping; emitTelemetry(record)
│   ├── relay.ts                 # bounded buffer → POST /api/telemetry/events (fire-and-forget)
│   └── telemetry.test.ts        # mode stripping, buffer bounds, disable stops emission
├── agent/
│   ├── loop.ts                  # tap: turn completion / error / abort → emitTelemetry
│   └── trace.ts                 # unify side-generator trace shapes feeding capture
├── stores/chat.svelte.ts        # pass turn context (chatId, model, duration, usage) to capture
├── settings/sections.ts         # + telemetry section entry (cap: null)
└── components/settings/
    └── TelemetrySection.svelte  # toggle, host/publicKey/mode, validation, delivery-health status

server/src/
├── telemetry.ts                 # registerTelemetry: config PUT (validate+apply+drop queue), GET status, POST events
├── telemetry-ingest.ts          # bounded queue, interval flush, backoff, Langfuse client (ingestion API)
├── telemetry.test.ts            # inject-based route tests + stubbed-fetch Langfuse tests
└── server.ts                    # registerTelemetry(fastify) in buildApp; no new ServerCap

tests/
├── fixtures/mock-llm/           # unchanged — drives real chat paths for capture e2e
└── e2e/telemetry.spec.ts        # V-scenarios against a stub Langfuse receiver

docs/reference/seams.qmd         # telemetry seam entry (capture tap → relay → outbound client)
```

**Structure Decision**: Single-repo layout as-is; new modules follow existing per-feature file placement (web library code in `src/lib/<feature>`, server feature modules as `server/src/<feature>.ts` with `registerX` wiring in `buildApp`). No new packages, no schema changes.
