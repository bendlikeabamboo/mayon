# Implementation Plan: Local-First Grouped Provider Picker

**Branch**: `021-local-provider-picker` | **Date**: 2026-09-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/021-local-provider-picker/spec.md`

## Summary

Give the provider picker a spine and give local inference a first-class path. Concretely: (1) the provider template catalog is organized into four fixed groups — Local, Cloud APIs, Gateways, Custom — with a search box filtering across all groups; (2) LM Studio (`http://localhost:1234/v1`) and vLLM (`http://localhost:8000/v1`) join the catalog as `openai-compatible`, key-free, discovery-first entries in the Local group; (3) an explicit "Test connection" flow classifies failures (server not running vs cross-origin blocked vs timeout vs auth vs wrong path) into coached messages, using a browser-direct `no-cors` disambiguation probe; (4) the URL-allowlist tool-capability guess is retired: `toolCapability` becomes an explicit `'on' | 'off'` assertion defaulting to **on** for all providers (owner ruling 2026-09-06), with read-time normalization preserving every legacy config's prior effective behavior; (5) loopback targets bypass the LLM proxy so local traffic stays browser-direct (the server container cannot reach the host's loopback).

Everything rides existing machinery: the `openai-compatible` adapter, `/models` discovery, `classifyFetchError`, the settings KV (`providers` key), and the Settings UI component vocabulary. No schema migration, no new dependencies, no `@mayon/shared` changes.

## Technical Context

**Language/Version**: TypeScript 5.x, Node 22 (`.nvmrc`), SvelteKit SPA (Svelte 5 runes, `@sveltejs/adapter-static`, no SSR); pnpm 10.

**Primary Dependencies**: `ai` + `@ai-sdk/openai-compatible` + `ollama-ai-provider-v2` (adapters); Tailwind v4 + shadcn-svelte / bits-ui (UI vocabulary: `Command`, `Input`, `Button`, `Collapsible`); drizzle (untouched — no new tables/columns).

**Storage**: Postgres `settings` KV via `settingsRepo` (`providers` key: `{[id]: ProviderConfig}`, non-secret); API keys stay in IndexedDB `KeyStore`. Config changes are JSON field additions — optional fields, no stamped schema migration (matches the 007/008/009 precedent).

**Testing**: Vitest (`pglite` test driver; co-located `*.test.ts`) + Playwright (`tests/e2e/`, chromium, mock-LLM fixtures in `tests/e2e/fixtures/`).

**Target Platform**: Browser SPA (fetch-based, CORS-bound) with optional companion Node server (proxy/auth — this feature only *bypasses* the proxy for loopback targets).

**Project Type**: Web application (SPA + companion server).

**Performance Goals**: SC-003 — search results under 1s for a 25+ entry catalog. Not perf-sensitive: client-side filter over ~20 catalog entries, no new bundle weight.

**Constraints**: Zero new runtime dependencies. Local traffic browser-direct (no proxying through the server container). No runtime probing/auto-detection (user-initiated test only). Silent tools-off bug class eliminated. Constitution quality gates: `pnpm check`, `pnpm lint`, `pnpm test` (server package untouched → server suite unaffected but still green).

**Scale/Scope**: Provider catalog 18 → 20 templates; one settings surface (`ProviderConfig.svelte`); 4 fixed groups; lib changes confined to `src/lib/ai/`, `src/lib/agent/capability.ts`, `src/lib/services/llm-proxy-fetch.ts`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status | Notes |
|------|--------|-------|
| **I. Layering** (components → `client.ts` → repos only) | ✅ PASS | Picker/test UI reads templates from `$lib/ai/registry` and provider state via `$lib/ai/client` (`listProviders`/`saveProviders` → `settingsRepo`). No direct `db` imports. `StorageDriver` seam untouched. |
| **I. No secrets in settings** | ✅ PASS | New fields (`group`, `requiresKey`) are non-secret handles. The `no-cors` disambiguation probe attaches no credentials and sends no key. Keys remain IndexedDB-only, same-origin/proxied requests only. |
| **I. Toolchain pins / gates** | ✅ PASS | Node 22 / pnpm 10; plan includes `pnpm check` + `pnpm lint` + `pnpm test` as merge gates. |
| **II. Tests for new `src/lib/` behavior** | ✅ PASS | Pure additions get co-located Vitest suites: grouping/normalization (`registry.test.ts`, `capability.test.ts` rewrite), connection-test classification matrix (`connection-test.test.ts` with fake transport), proxy-bypass (`llm-proxy-fetch.test.ts`), timeout classification (`errors.test.ts`). Regression test for the silent-tools-off class (spec SC-005) rides `capability.test.ts` + an e2e toggle scenario. Server package untouched → no server-suite changes required. |
| **III. UX consistency** | ✅ PASS | Grouped picker + search reuse existing vocabulary (`Command`-based search per `SettingsSearch`/`ModelSelect` precedents, same Card/Input/Button patterns in `ProviderConfig.svelte`). Progressive degradation *improves*: loopback bypass means locals work with or without the server detected. No downtime-affecting paths. |
| **IV. Performance** | ✅ PASS | Not perf-sensitive (n≈20 filter); zero new dependencies → no bundle justification needed. No `search_vec` writes, no restore-path changes, no `@mayon/shared` changes. |
| **Quality gates / migrations** | ✅ PASS | No drizzle migration (JSON field additions on an existing settings value). RC-first release flow applies at release time (out of scope here). |

**Post-Phase-1 re-check**: PASS — design adds no violations. The `'auto'` → explicit tool-capability normalization is a *read-time, client-side* data migration of one JSON settings value, following the `keysMigrated` lazy-normalization precedent (`src/lib/ai/keystore/migrate.ts`); no server-side stamped migration is needed because nothing in the stored shape is removed and old values remain readable.

## Project Structure

### Documentation (this feature)

```text
specs/021-local-provider-picker/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions & rationale
├── data-model.md        # Phase 1 output — entities, fields, migration mapping
├── quickstart.md        # Phase 1 output — end-to-end validation guide
├── contracts/
│   ├── provider-registry.md   # Template/config field contract, group taxonomy, legacy normalization
│   ├── connection-test.md     # Test-connection probe algorithm + failure-classification matrix
│   └── picker-ui.md           # Grouped, searchable picker behavior contract
└── tasks.md             # Phase 2 output ($speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/lib/ai/
├── registry.ts               # + group on ProviderTemplate; + LM Studio & vLLM templates; group assignment for all templates
├── types.ts                  # + ProviderGroup; ProviderConfig +group?/requiresKey?; +TimeoutError; toolCapability normalized to 'on'|'off'
├── client.ts                 # requiresKey-aware key gating (replaces kind-only switch); config normalization on read
├── errors.ts                 # classifyFetchError: Timeout branch; formatProviderError: coached messages for new classes
├── model-discovery.ts        # (existing) reused by the connection test
├── connection-test.ts        # NEW: testProviderConnection + no-cors disambiguation probe
├── llm-target.ts             # NEW (tiny): isLoopbackUrl / same-origin helpers shared by proxy bypass + coaching
├── sdk-factory.ts            # template-copied fields flow through (no structural change expected)
├── registry.test.ts          # per-group order invariants; discovery-first template invariants
├── capability.test.ts        # rewritten: explicit-only resolution + legacy normalization table
├── connection-test.test.ts   # NEW: classification matrix with fake transport
├── errors.test.ts            # + timeout/mixed-content branches
└── llm-proxy-fetch/…         # see services below

src/lib/agent/
├── capability.ts             # retire 'auto' from resolution; keep legacy default table for read-time normalization only
├── loop.ts                   # read normalized toolCapability (one code path)
└── capability.test.ts        # (above)

src/lib/services/
└── llm-proxy-fetch.ts        # getLlmFetch(url): loopback targets bypass the proxy (browser-direct)

src/lib/components/ai/
├── ProviderConfig.svelte     # grouped + searchable template picker; Test connection button + coaching status;
│                             # Tool capability select becomes on/off; local cards skip silent background discovery
└── (optional) ProviderTemplatePicker.svelte  # extraction of the picker section if it outgrows the card

tests/e2e/
├── onboard.spec.ts           # existing flow, updated for grouped picker
└── provider-picker.spec.ts   # NEW: groups, search, tools toggle, coached failure (mock LLM fixtures)
```

**Structure Decision**: No new top-level directories. The feature extends the existing `src/lib/ai` seam (registry, types, errors, discovery), the `src/lib/agent` capability gate, the `llm-proxy-fetch` service, and the existing Settings surface in `src/lib/components/ai/ProviderConfig.svelte`. Two new small modules (`connection-test.ts`, `llm-target.ts`) stay inside the established `src/lib/ai` seam; UI tests go in the existing `tests/e2e` Playwright project.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None — no constitution violations.
