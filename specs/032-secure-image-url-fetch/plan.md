# Implementation Plan: Secure image-URL fetching (credential containment + relay hardening)

**Branch**: `fix/issue-69-image-url-credential-leak` | **Date**: 2026-11-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/032-secure-image-url-fetch/spec.md` (GitHub issue #69, P1 security)

## Summary

Stop the credential leak and SSRF in the 030 image-output finalize path with two aligned layers.
**Client**: the credential-bearing fetch seams (`createKeychainFetch`, the streaming HTTP
transport) learn the provider's *auth host* (hostname of the provider `baseUrl`) and attach the
API key only when the request's URL host matches it; model-supplied image URLs therefore
materialize credential-free. **Server**: the LLM relay learns the same `authHost` declaration on
the wire, strips credential headers for any mismatched/undeclared host, resolves and validates
the target (rejecting loopback/link-local/private/unique-local/unspecified/CGNAT addresses with
403), refuses redirects (`redirect: 'error'`), and caps streamed responses at 64 MiB. The client
image materialization path additionally caps buffering at 32 MiB via a chunked read. Both issue
acceptance cases are locked by regression tests that fail pre-fix. `chat.svelte.ts` itself needs
no change — the fix lands in the fetch seams it already calls.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 22 (`.nvmrc`), pnpm 10. No new dependencies.

**Primary Dependencies**: Existing only — SvelteKit 2 / Svelte 5 (SPA, no SSR), `@ai-sdk/*`
providers, Fastify (server), `@mayon/shared` (workspace, tsup → `dist`), Vitest.

**Storage**: Postgres via the `StorageDriver` seam — **untouched** (no schema change, no
migration, no repository changes).

**Testing**: Vitest. Client: `pnpm test:low-spec` (pglite profile; this machine: 12 CPU / 7.1 GiB
RAM → low-spec profile, one test process at a time). Server: `pnpm --filter @mayon/server test`.
Gates: `pnpm check`, `pnpm lint`.

**Target Platform**: Browser SPA (static `build/`) + Node server container (Docker).

**Project Type**: web app (SvelteKit SPA `src/` + Fastify server `server/src/` + shared protocol
package `packages/shared/`).

**Performance Goals**: No hot-path changes; the image-fetch path gains bounds (strict
improvement). No SPA bundle growth (zero new deps; guard code is small).

**Constraints**: All AGENTS.md invariants hold — app code calls repositories only (no `db`
imports added); `StorageDriver` remains the only storage seam (untouched); no secrets in
`settings` (`authHost` is a non-secret hostname, and the API key still lives only in
IndexedDB/headless key store); server remains authoritative for provider network calls.

**Scale/Scope**: One wire-contract field, one new server guard module, four client seam files,
three test files extended + two test files added/extended on the server, one docs file.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
| --- | --- | --- |
| I. Layering (repos only, no `db` imports) | PASS | No storage-layer changes at all. |
| I. No secrets in `settings` | PASS | Keys stay in the key store; the new `authHost` wire field is a non-secret hostname. |
| I. `pnpm check` + `pnpm lint` | PLANNED | Final-phase gate tasks T018–T019. |
| II. Regression test that fails without the fix | PASS | FR-010 / SC-001–002 drive T005–T006, T012–T013 (tests written first). |
| II. Server changes pass `pnpm --filter @mayon/server test` | PLANNED | Gate task T019. |
| III. Progressive degradation / no server restart | PASS | Relay hardening is request-scoped; no boot/restart paths touched. Blocked images degrade to the existing inline notice (FR-008). |
| IV. No unjustified bundle growth / new deps | PASS | Zero new dependencies; guard is hand-rolled IP range logic (R-7). |
| Docs authority (`seams.qmd`) | PASS | The relay contract is refined, not deviated from: secrets still ride same-origin to the relay; the relay now constrains where they may continue. `docs/reference/seams.qmd` updated in the same change (T017). |

Post-Phase-1 re-check: design adds one optional wire field and one server module; no gate
violations; **Complexity Tracking** section omitted (no violations to justify).

## Project Structure

### Documentation (this feature)

```text
specs/032-secure-image-url-fetch/
├── plan.md              # This file
├── research.md          # Phase 0 output — verified code map + decisions R-1..R-7
├── data-model.md        # Phase 1 output — wire-protocol extension (only "data" touched)
├── quickstart.md        # Phase 1 output — runnable validation guide
├── contracts/
│   └── llm-proxy.md     # Phase 1 output — relay request/response contract
├── checklists/
│   ├── requirements.md  # specify-phase quality checklist (complete)
│   └── security.md      # reviewer-owned security requirements checklist (unchecked)
└── tasks.md             # Phase 2 output ($speckit-tasks)
```

### Source Code (repository root)

```text
packages/shared/src/protocol.ts            # LlmProxyRequest gains optional authHost?: string

src/lib/ai/llm-target.ts                   # + normalizeHostname()/sameHost() host helpers
src/lib/ai/sdk-fetch.ts                    # KeychainFetchAuth.authHost; host-gated attach
src/lib/ai/sdk-factory.ts                  # providerFetchFor passes authHost from baseUrl
src/lib/ai/http-transport.ts               # HttpStreamRequest.authHost; gated attach; passthrough
src/lib/ai/copilot-fetch.ts                # declares authHost = host of retargeted endpoint
src/lib/ai/model-discovery.ts              # declares authHost for both auth styles
src/lib/services/llm-proxy-fetch.ts        # getLlmFetch(url, authHost?); body gains authHost
src/lib/chat/images.ts                     # fetchImageCandidate chunked read + 32 MiB cap

server/src/url-target-guard.ts             # NEW: IP range table + target validation
server/src/llm-proxy.ts                    # authHost strip, SSRF guard, redirect:'error', cap

src/lib/ai/sdk-fetch.test.ts               # + foreign-host regression tests
src/lib/services/llm-proxy-fetch.test.ts   # + authHost forwarding tests
src/lib/chat/images.test.ts                # + size-cap regression test
server/src/url-target-guard.test.ts        # NEW: range-table unit tests
server/src/llm-proxy.test.ts               # + strip/403/redirect/cap regression tests

docs/reference/seams.qmd                   # relay contract note (same change)
```

**Structure Decision**: Single repo, existing three-package layout (`src/` SPA, `server/src/`
Fastify, `packages/shared/` protocol). No new packages or top-level directories; the only new
file is `server/src/url-target-guard.ts` (+ its test), colocated with `llm-proxy.ts`.

## Complexity Tracking

> Not applicable — no Constitution Check violations.
