# Implementation Plan: First-Class Inference Provider Templates

**Branch**: `007-inference-provider-templates` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-inference-provider-templates/spec.md`

## Summary

Promote six high-usage inference providers — DeepSeek, xAI (Grok), Moonshot Kimi,
Qwen/DashScope, Groq, Mistral — to first-class entries in the Settings "Add provider"
flow. Per research 003, every candidate speaks the OpenAI wire format, so the entire
feature is additive catalog data on existing seams: six `ProviderTemplate` entries in
`src/lib/ai/registry.ts` (plus base-URL additions to `KNOWN_GATEWAY_BASEURLS` in
`src/lib/agent/capability.ts` so tools default on), unit tests, and a README provider
list update. No new dependencies, transports, auth flows, or UI components.

## Technical Context

**Language/Version**: TypeScript (SvelteKit, Svelte 5 runes) on Node 22 / pnpm 10 (toolchain pins respected)

**Primary Dependencies**: Vercel AI SDK (`@ai-sdk/*`) via existing `sdk-factory.ts`. **No new dependencies** (spec SC-006).

**Storage**: N/A — no schema or migration changes. Provider configs persist through the existing provider repository/settings handle fields; templates are compile-time constants.

**Testing**: Vitest (`pnpm test`, pglite driver irrelevant here — pure unit tests). New `src/lib/ai/registry.test.ts`; extended `src/lib/agent/capability.test.ts`.

**Target Platform**: Browser SPA (SvelteKit adapter-static) + optional local Node server (llm-proxy fallback for CORS-blocked providers).

**Project Type**: Web application (self-hosted chat).

**Performance Goals**: N/A — additions are static catalog constants; zero runtime cost and zero SPA bundle growth beyond trivial string data.

**Constraints**: No new bundled dependencies (SC-006); no secrets in templates or settings (keys live in IndexedDB keychain, sent only via same-origin proxied requests); every provider must keep working when the server is absent (direct or via existing failure UX) except where CORS forces the existing proxy path.

**Scale/Scope**: ~6 template objects (~15 lines each), 8–9 gateway base-URL set entries, 2 test files, 1 README line. Estimated ~1 day total (research 003: uniformly S-effort).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #   | Gate (from constitution)                                                                     | Status           | How satisfied                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Layering: app code calls repositories only; no direct `db` imports                           | PASS             | Changes touch `src/lib/ai/registry.ts` and `src/lib/agent/capability.ts` only — no storage access at all                                                                |
| 2   | `StorageDriver` is the only storage seam; drivers stay dumb executors                        | PASS             | No storage changes; templates are in-memory constants                                                                                                                   |
| 3   | `pnpm check` + `pnpm lint` before merge                                                      | PASS (planned)   | tasks.md gates every task on both                                                                                                                                       |
| 4   | No secrets in `settings`; keys in IndexedDB keychain, same-origin proxied requests only      | PASS             | Templates carry handle fields only; `requiresKey: true` drives the existing keychain prompt. No code touches auth                                                       |
| 5   | SvelteKit `+` filename prefix reserved                                                       | PASS             | New test file named `registry.test.ts` (no `+` prefix)                                                                                                                  |
| 6   | New behavior in `src/lib/` ships with tests; `pnpm test` passes                              | PASS (planned)   | New registry template-shape tests + per-URL capability tests                                                                                                            |
| 7   | UI composed from existing component vocabulary; progressive degradation via `detectServer()` | PASS             | No new UI components — the existing Add provider picker renders the new catalog entries; server proxy fallback is existing generic behavior, no server assumption added |
| 8   | Perf: SPA bundle growth must be justified                                                    | PASS             | No new dependencies; bundle delta is ~six small object literals                                                                                                         |
| 9   | Releases RC-first per `AGENTS.md`                                                            | N/A at plan time | Release mechanics handled at release time, not in this feature's scope                                                                                                  |

**Post-Phase-1 re-check**: unchanged — the design (see `data-model.md`, `contracts/provider-templates.md`) adds only catalog instances on documented seams. No seam deviation, no new primitives.

## Project Structure

### Documentation (this feature)

```text
specs/007-inference-provider-templates/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   └── provider-templates.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/lib/ai/
├── registry.ts            # MODIFIED: +6 ProviderTemplate entries, ordered by usage
├── registry.test.ts       # NEW: template-shape & catalog-order unit tests
├── types.ts               # UNCHANGED (ProviderKind 'openai-compatible' reused)
├── model-discovery.ts     # UNCHANGED (generic GET <baseUrl>/models already covers all six)
├── sdk-factory.ts         # UNCHANGED (generic openai-compatible adapter)
└── sdk-fetch.ts           # UNCHANGED (keychain Bearer shim + proxy fallback)

src/lib/agent/
├── capability.ts          # MODIFIED: +8–9 entries in KNOWN_GATEWAY_BASEURLS (incl. regional variants)
└── capability.test.ts     # MODIFIED: per-URL tool-capability resolution tests

README.md                  # MODIFIED: provider list line
```

**Structure Decision**: Single existing-project layout — this feature modifies two lib modules plus tests inside the current `src/lib/` tree and adds no new files outside `registry.test.ts`. No restructuring; no `server/` or `packages/` changes.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None — no constitution violations. The feature is deliberately scoped as catalog data on existing seams (research 003's Pareto conclusion).
