# Implementation Plan: Automatic Model Context Lengths

**Branch**: `024-model-context-length` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/024-model-context-length/spec.md`

## Summary

Capture each model's context-window size automatically when the app fetches a provider's
model listing, so users never look up or hand-enter window sizes. Discovery parsers read
top-level `context_length` / `context_window` (positive integers only) and return entries
`{ id, contextWindow? }` instead of bare IDs; captured values persist as
`ProviderConfig.modelContextWindows` (model id → tokens) inside the existing `providers`
settings KV — no schema migration. The 023 context gauge gains one precedence rung
(user-declared → **provider-listed** → static catalog → unknown, `limitSource:
'model-listing'`), and the settings model picker shows each captured window as muted
secondary text. Unknown stays unknown everywhere; discovery failures change nothing.

## Technical Context

**Language/Version**: TypeScript on Node 22 (`.nvmrc`); Svelte 5 runes for UI.

**Primary Dependencies**: existing only — SvelteKit static SPA, drizzle + settings KV
repository, bits-ui/shadcn-svelte command palette (model-select). No new dependencies.

**Storage**: existing `providers` settings KV (Postgres `settings` table via `repos.settings`);
new optional `ProviderConfig.modelContextWindows?: Record<string, number>`. No migration.

**Testing**: Vitest (`pnpm test`, pglite driver) — parser unit tests, registry normalization
tests, `context-usage.test.ts` precedence cases, source-text contract tests
(`ContextGauge.contract.test.ts`, model-select). No server-side changes → no
`@mayon/server` gate expected.

**Target Platform**: browser SPA (desktop-capable); no server involvement — the server proxy
is payload-opaque for `/models`.

**Project Type**: web app (SPA + optional server container).

**Performance Goals**: none new — discovery cadence, request count, and payload handling are
unchanged; settings blob grows by ≤ one number per listed model.

**Constraints**: harvest must be additive (listing results/errors byte-identical in shape to
today); no invented windows (unknown is a first-class state); user-declared values always
win; no secrets in settings.

**Scale/Scope**: ~6 source files touched (`model-discovery.ts`, `types.ts`, `registry.ts`,
`client.ts`/`connection-test.ts` adapters, `+page.svelte` one-liner, `model-select.svelte` +
subcomponents, `context-usage.ts`, `ContextGauge.svelte`, `ProviderConfig.svelte`) plus
tests; no schema, no server, no new packages.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle (constitution) | Status | How |
|---|---|---|---|
| I | Layering: app code calls repositories only; `db` private | PASS | New data rides `saveProviders` → `repos.settings` (existing seam); no component touches `db`. |
| I | `StorageDriver` is the only storage seam | PASS | No new storage path; settings KV unchanged. |
| I | `pnpm check` + `pnpm lint` before merge; toolchain pins | PASS | Planned as merge gates; no new toolchain. |
| I | No secrets in `settings` | PASS | Context lengths are non-secret handle data (same class as `contextWindow`). |
| I | No `+`-prefixed non-route files | PASS | No new route files. |
| II | `pnpm test` before merge; new `src/lib/` behavior ships with tests | PASS | Parser, normalization, precedence, contract, and merge tests specified in contracts' test obligations. |
| II | Bug fixes ship regression tests | N/A | Feature, not bug fix. |
| III | UI composed from existing Tailwind v4 + shadcn-svelte vocabulary | PASS | Picker hint = muted secondary text via existing model-select subcomponents; gauge uses existing humanized-label path. |
| III | Progressive degradation (no server assumption) | PASS | Entirely client-side; server proxy untouched. |
| III | Expound offset invariants | N/A | No markdown/selection changes. |
| IV | Perf claims measured | PASS | No new perf-sensitive paths; settings blob growth bounded (number per model, pruned on normalization). |
| IV | Full-text search / restore invariants | N/A | Untouched. |
| IV | Bundle growth justified | PASS | Zero new dependencies. |

**Gate evaluation**: no violations; no Complexity Tracking entries required.

**Post-Phase-1 re-check**: design adds no schema, no dependency, no new seam — all data
flows through existing, documented seams (`model-discovery`, `registry` normalization,
`deriveContextGauge`, settings KV). Still PASS.

## Project Structure

### Documentation (this feature)

```text
specs/024-model-context-length/
├── plan.md                        # This file
├── research.md                    # Phase 0 — decisions D1–D5, provider reality table
├── data-model.md                  # Phase 1 — modelContextWindows entity + refresh states
├── quickstart.md                  # Phase 1 — validation scenarios
├── contracts/
│   ├── model-listing-harvest.md   # wire input → DiscoveredModel → persistence rules
│   └── context-window-resolution.md # gauge precedence + picker display (023 update)
└── tasks.md                       # Phase 2 output ($speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/lib/ai/
├── model-discovery.ts             # D1: parsers return {id, contextWindow?} entries
├── model-discovery.test.ts        #   wire-field accept/reject, dedupe determinism
├── types.ts                       # D2: ProviderConfig.modelContextWindows?, DiscoveredModel
├── registry.ts                    # D2: normalizeProviderConfig validates + prunes map
├── client.ts                      # adapter: discoverProviderModels returns entries
└── connection-test.ts             # adapter: probe maps entries → ids (behavior unchanged)
src/lib/chat/
├── context-usage.ts               # D4: listedWindow input, 'model-listing' limitSource
└── context-usage.test.ts          #   precedence ladder cases
src/lib/components/ai/
├── ProviderConfig.svelte          # D3: merge/rebuild map on refresh; pass map to picker
├── model-select/model-select.svelte       # D5: optional contextWindows prop
├── model-select/model-select-name.svelte  #   (or sibling) muted window hint
└── (model-select contract test)   #   presentational assertion
src/lib/components/chat/
└── ContextGauge.svelte            # D4: humanized label for the new source
src/routes/chat/[id]/
└── +page.svelte                   # D4: listedWindow from activeConfig map (one line)
```

**Structure Decision**: single-repo SPA layout (existing); all changes fall under the
established `src/lib/ai` + `src/lib/chat` + component seams — no new top-level directories,
no server or packages/shared changes (nothing about model listings is shared with the
server today, and the feature stays client-side).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations.
