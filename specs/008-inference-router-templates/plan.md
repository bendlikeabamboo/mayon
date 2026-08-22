# Implementation Plan: First-Class Inference Router Templates

**Branch**: `008-inference-router-templates` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-inference-router-templates/spec.md`

## Summary

Promote four inference routers — OpenCode Zen, LiteLLM (self-hosted), Vercel AI Gateway,
Requesty — to first-class entries in the Settings "Add provider" flow, joining the
existing OpenRouter and Kilo Gateway entries. Per research 004, every router speaks the
OpenAI wire format, so the feature is almost entirely additive catalog data on existing
seams: four `ProviderTemplate` entries in `src/lib/ai/registry.ts` (plus seven base-URL
additions to `KNOWN_GATEWAY_BASEURLS` in `src/lib/agent/capability.ts` so tools default
on), unit tests, and a README provider-list update. The one behavioral change is small
and generic: `parseModelIds` in `src/lib/ai/model-discovery.ts` learns to skip entries
explicitly typed `embedding` (spec FR-008) so non-chat models never reach the picker.
LiteLLM is the first hosted template with `requiresKey: false`, reusing the existing
keyless path pioneered by Ollama. No new dependencies, transports, auth flows, or UI
components.

## Technical Context

**Language/Version**: TypeScript (SvelteKit, Svelte 5 runes) on Node 22 / pnpm 10 (toolchain pins respected)

**Primary Dependencies**: Vercel AI SDK (`@ai-sdk/*`) via existing `sdk-factory.ts`. **No new dependencies** (spec SC-006).

**Storage**: N/A — no schema or migration changes. Provider configs persist through the existing provider repository/settings handle fields; templates are compile-time constants.

**Testing**: Vitest (`pnpm test`, pure unit tests). Modified `src/lib/ai/registry.test.ts` (catalog order/shape rules extended), `src/lib/agent/capability.test.ts` (7 new URLs), `src/lib/ai/model-discovery.test.ts` (embedding-exclusion cases).

**Target Platform**: Browser SPA (SvelteKit adapter-static) + optional local Node server (llm-proxy fallback for CORS-blocked routers).

**Project Type**: Web application (self-hosted chat).

**Performance Goals**: N/A — catalog additions are static constants; the one runtime change is a single string comparison per parsed model entry (negligible).

**Constraints**: No new bundled dependencies (SC-006); no secrets in templates or settings (keys live in IndexedDB keychain, sent only via same-origin proxied requests); every router must keep working when the server is absent except where CORS forces the existing proxy path; LiteLLM setup must complete without a key (FR-002).

**Scale/Scope**: 4 template objects (~15 lines each), 7 gateway base-URL set entries, 1 small parser change (+tests), 3 modified test files, 1 README line + 1 docs note. Estimated ~half a day total (research 004: uniformly S-effort).

## Constitution Check

_**GATE**: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #   | Gate (from constitution)                                                                     | Status           | How satisfied                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Layering: app code calls repositories only; no direct `db` imports                           | PASS             | Changes touch `src/lib/ai/` and `src/lib/agent/` only — no storage access at all                                                                                 |
| 2   | `StorageDriver` is the only storage seam; drivers stay dumb executors                        | PASS             | No storage changes; templates are in-memory constants                                                                                                            |
| 3   | `pnpm check` + `pnpm lint` before merge                                                      | PASS (planned)   | tasks.md gates every task on both                                                                                                                                |
| 4   | No secrets in `settings`; keys in IndexedDB keychain, same-origin proxied requests only      | PASS             | Templates carry handle fields only; `requiresKey` flags drive the existing keychain prompt (LiteLLM `false` skips it — Ollama precedent). No code touches auth   |
| 5   | SvelteKit `+` filename prefix reserved                                                       | PASS             | No new files; modified tests keep their existing `*.test.ts` names                                                                                               |
| 6   | New behavior in `src/lib/` ships with tests; `pnpm test` passes                              | PASS (planned)   | Registry shape/order tests, per-URL capability tests, and `parseModelIds` embedding-exclusion tests all specified in data-model.md validation rules              |
| 7   | UI composed from existing component vocabulary; progressive degradation via `detectServer()` | PASS             | No new UI components — the existing Add provider picker renders the new catalog entries; proxy fallback is existing generic behavior, no server assumption added |
| 8   | Perf: SPA bundle growth must be justified                                                    | PASS             | No new dependencies; bundle delta is four small object literals plus one comparison in discovery parsing                                                         |
| 9   | Releases RC-first per `AGENTS.md`                                                            | N/A at plan time | Release mechanics handled at release time, not in this feature's scope                                                                                           |

**Post-Phase-1 re-check**: unchanged — the design (see `data-model.md`,
`contracts/router-templates.md`, `contracts/discovery-filtering.md`) adds catalog
instances on documented seams plus one conservative parsing rule inside the existing
discovery seam. No seam deviation, no new primitives.

## Project Structure

### Documentation (this feature)

```text
specs/008-inference-router-templates/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── router-templates.md
│   └── discovery-filtering.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/lib/ai/
├── registry.ts              # MODIFIED: +4 ProviderTemplate entries (positions 6–9, demand order)
├── registry.test.ts         # MODIFIED: new-entry shape tests; order test first-seven → first-eleven; length 13 → 17;
│                            #   integrity rules extended (requiresKey:false and http localhost exemptions for LiteLLM)
├── model-discovery.ts       # MODIFIED: parseModelIds skips entries with type === 'embedding' (FR-008)
├── model-discovery.test.ts  # MODIFIED: +embedding-exclusion cases (typed excluded, untyped/other-type kept)
├── types.ts                 # UNCHANGED (ProviderKind 'openai-compatible' reused)
├── sdk-factory.ts           # UNCHANGED (generic openai-compatible adapter)
└── sdk-fetch.ts             # UNCHANGED (keychain Bearer shim + proxy fallback; keyless = no auth header)

src/lib/agent/
├── capability.ts            # MODIFIED: +7 entries in KNOWN_GATEWAY_BASEURLS (incl. variant/alias spellings)
└── capability.test.ts       # MODIFIED: per-URL tool-capability resolution tests for the 7 additions

README.md                    # MODIFIED: provider list line names the four routers; self-hosted gateway
                             #   container address note (host.docker.internal) alongside the Ollama note
```

**Structure Decision**: Single existing-project layout — this feature modifies three lib
modules plus tests inside the current `src/lib/` tree and adds no new files. No
restructuring; no `server/` or `packages/` changes.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None — no constitution violations. The feature is deliberately scoped as catalog data on
existing seams plus one generic parsing rule (research 004's Pareto conclusion).
