# Implementation Plan: GitHub Copilot Support

**Branch**: `016-github-copilot-support` | **Date**: 2026-08-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/016-github-copilot-support/spec.md`

## Summary

Add GitHub Copilot as a first-class provider kind so users can drive Mayon with their workplace Copilot license. Authorization uses the GitHub OAuth device flow run **server-side** (github.com endpoints are CORS-blocked in browsers); the resulting grant is stored in the existing browser KeyStore, and the server mints short-lived Copilot session tokens with eager refresh (`api.github.com/copilot_internal/v2/token`). Serving reuses `createOpenAICompatible` (AI SDK v7) behind a session-aware fetch that injects the mandatory Copilot header set and routes through the existing `llm-proxy` streaming seam — giving chat, tool calls, and lab/quiz generation parity for free. Models are discovered live from the session-authenticated `/models` endpoint with policy filtering and a curated fallback.

## Technical Context

**Language/Version**: TypeScript 5.x — SvelteKit SPA (Svelte 5 runes, `@sveltejs/adapter-static`) + Node 22 server (Fastify 5, `tsx` dev / `tsup` build)

**Primary Dependencies**: Vercel AI SDK v7 (`ai`, `@ai-sdk/openai-compatible`), drizzle/`pg` on server; **no new dependencies** (device flow and exchange are hand-rolled `fetch`)

**Storage**: Postgres via `StorageDriver` — **zero schema change**; secrets in IndexedDB KeyStore (`providerKeys`); flow/session state is server+browser memory only

**Testing**: Vitest (`pnpm test`, pglite driver; `pnpm --filter @mayon/server test`), `pnpm check`, `pnpm lint`

**Target Platform**: Browser SPA + same-origin Node companion server (Docker compose; `llm-proxy` capability required)

**Performance Goals**: Streaming parity with other providers — session token resolution happens once per request before streaming; no per-chunk added work

**Constraints**: No secrets in `settings` (constitution I); progressive degradation when server absent (constitution III); no bundle growth (constitution IV); device-flow client_id + header constants isolated in one module (risk containment)

**Scale/Scope**: Single-user desktop-class app; one new provider kind, one server module (3 routes), one new Settings dialog component

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| I. Code Quality — repositories-only layering | **Pass.** No DB access added; KeyStore is the existing secret seam; server module follows the `registerXxx(app)` pattern (`server/src/server.ts:42-87`). |
| I. No secrets in `settings` | **Pass.** Grant → IndexedDB KeyStore; session token → memory; `ProviderConfig` gains no secret fields. Both secrets ride the same-origin proxy envelope exactly like today's provider keys. |
| II. Testing Standards | **Pass (planned).** New behavior ships with unit tests: server flow/token routes (`app.inject` + stubbed upstream fetch, pattern of `llm-proxy.test.ts`), session wrapper header/cache/renewal, discovery filter, error mapping; registry pins updated. Gates run before merge. |
| III. UX Consistency | **Pass.** Settings dialog extends `ProviderConfig.svelte` vocabulary; all states use existing tokens, light+dark; progressive capability respected (`llm-proxy` cap already gates both fetch seams; server-absent → standard indicators, connector refuses with a clear message). |
| III. No downtime from user operations | **Pass.** No restart involved; server state is additive in-memory. |
| IV. Performance | **Pass.** No perf-sensitive path changed; streaming/proxy untouched; **zero new dependencies** (bundle growth gate trivially satisfied); no search/restore surface touched. |
| Quality gates — migrations | **Pass.** No drizzle migration (`pnpm db:generate` not needed). |

**Gate result: no violations. Complexity Tracking table stays empty.**

## Project Structure

### Documentation (this feature)

```text
specs/016-github-copilot-support/
├── plan.md                        # This file
├── research.md                    # Phase 0 output — decisions D1–D8 + risks
├── data-model.md                  # Phase 1 output — entities & state machines
├── quickstart.md                  # Phase 1 output — validation scenarios
├── contracts/
│   ├── copilot-server-api.md      # Server endpoint + protocol contract
│   └── provider-integration.md    # In-app kind contract (adapter/UI/discovery)
└── checklists/requirements.md     # Spec quality checklist (from /speckit.specify)
```

### Source Code (repository root)

```text
packages/shared/src/
└── protocol.ts                    # + CopilotAuthStart/Poll/Token request & response types

server/src/
├── copilot-auth.ts                # NEW: device flow, exchange, session cache, header constants
└── copilot-auth.test.ts           # NEW: app.inject + stubbed GitHub/Copilot upstream

src/lib/ai/
├── types.ts                       # + 'github-copilot' kind; + CopilotAuthRequiredError, CopilotSubscriptionError
├── sdk-factory.ts                 # + github-copilot branch (createOpenAICompatible + session fetch)
├── copilot-session.ts             # NEW: browser-side session descriptor cache (per provider id)
├── copilot-fetch.ts               # NEW: session-aware fetch wrapper (headers, endpoint, delegation to getLlmFetch)
├── model-discovery.ts             # per-kind auth/header descriptor; policy-aware parsing
├── errors.ts / sdk-errors.ts      # map exchange/inference failures (D4 table)
├── registry.ts                    # + GitHub Copilot template; listProviderKinds
└── dialects.ts                    # + KIND_BASELINES / KIND_DESCRIPTIONS / EXTRA_BODY_ALLOWLISTS / namespaceFor entries

src/lib/agent/
└── capability.ts                  # defaultForKind('github-copilot') → true

src/lib/components/ai/
├── ProviderConfig.svelte          # kind badge; device-flow connector replaces paste box for this kind
└── copilot-auth-dialog.svelte     # NEW: user code + link + polling states

tests (extend existing files, no new suites):
├── src/lib/ai/registry.test.ts    # template pins 17→18
├── src/lib/ai/model-discovery.test.ts
├── src/lib/ai/dialects.test.ts
└── src/lib/agent/capability.test.ts
```

**Structure Decision**: Extends the existing single-SPA + server topology with no new top-level directories. The only new modules are `copilot-auth.ts` (server) and `copilot-session.ts`/`copilot-fetch.ts`/`copilot-auth-dialog.svelte` (client), placed beside the seams they extend (`src/lib/ai/`, `src/lib/components/ai/`).

## Complexity Tracking

> No constitution violations to justify — table intentionally empty.
