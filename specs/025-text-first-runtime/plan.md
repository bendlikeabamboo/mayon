# Implementation Plan: Enforceable Text-First Runtime Tier

**Branch**: `025-text-first-runtime` | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/025-text-first-runtime/spec.md`

## Summary

Freeze and machine-enforce Mayon's existing two-tier boundary (data + logic behind the
repository/driver seams; web UI as thin passenger) so agent-driven feature work is
steered to text-first verification instead of browser automation. The wire is the core
ESLint `no-restricted-imports` rule (façade-only `$lib/db` imports for the app tier, no
upward imports for the data tier) plus a dependency-free Node direction-check script in
CI covering dynamic imports. All six day-one façade bypasses and ~15 type-only deep
imports are fixed mechanically (façade gains type re-exports and the few needed runtime
re-exports), so the rule goes live absolute with **zero escape hatches**. A one-page
agent's map (`docs/reference/agent-map.qmd`) states the placement policy, the
text-first proving path (`useFileTestDb()` + `repos`), and the browser-as-camera
allowance. No new dependencies, no runtime changes, no new client surface — naming,
freezing, wiring, and mapping, not re-architecture.

## Technical Context

**Language/Version**: TypeScript throughout; Node 22 (`.nvmrc`), pnpm 10; SvelteKit/Svelte 5 SPA + Node server.

**Primary Dependencies**: none added. Existing: ESLint flat config (typescript-eslint `ts.config` wrapper), Vitest + PGlite harness, GitHub Actions composite CI, Quarto docs. Enforcement uses the core `no-restricted-imports` rule and a stdlib-only Node script (research.md D1/D4).

**Storage**: N/A — no schema change, no migration; Postgres stays behind the untouched `StorageDriver` seam.

**Testing**: Vitest (`pnpm test`, PGlite driver) with the established `useFileTestDb()` → seed via `repos` → assert-on-text pattern; the enforcement wire itself gets fixture-tree self-tests under Vitest (quickstart V5).

**Target Platform**: dev tooling + CI (GitHub Actions) + Quarto-rendered docs site; zero runtime/platform surface.

**Project Type**: web-app monorepo (SPA + server + shared package); this feature is repository governance tooling and documentation inside it.

**Performance Goals**: N/A — dev-time only; no runtime code paths added (façade additions are type re-exports plus existing functions; `uuid` handling is code motion or a re-export).

**Constraints**: zero new npm dependencies; wire must go live with all merge-blocking gates green (hence the day-one fixes, research.md D3); no per-file inline disables for boundary rules; map must reference, never duplicate, authoritative docs.

**Scale/Scope**: 1 ESLint config block set + 1 script (~tens of lines) + 1 CI step + 1 docs page + seams.qmd path fix + AGENTS.md link; ~6 runtime import fixes, ~15 mechanical type-import rewrites, façade export additions; 0 escape hatches.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
| --- | --- | --- |
| I. Layering inviolable (repos only; `db` private to `src/lib/db/`) | **Strengthens** | The feature enforces this exact principle; day-one fixes remove 6 real bypasses (+ ~15 type reach-arounds) |
| I. Gates `pnpm check` / `pnpm lint` respected, toolchain pins | Pass | Wire lives inside existing `pnpm lint`; no new toolchain, no bun/Rust, no new deps |
| II. Tests for new behavior in `src/lib/` | Pass | Enforcement ships with fixture self-tests (quickstart V5); mechanical rewrites keep existing suites green |
| III. UX consistency / progressive enhancement | Pass | No UI behavior change; only import-path rewrites inside components |
| IV. Performance / bundle growth justified | Pass | No runtime dependencies; type-only façade re-exports don't affect the bundle |
| Quality gates: drizzle via `pnpm db:generate` | N/A | No schema change |
| Deviating from a documented seam requires amendment first | Pass | No seam deviates; `seams.qmd` is updated (stale `repos/` path fix) to stay authoritative |

**Verdict**: PASS — no violations; the feature operationalizes Core Principle I rather than touching it. Post-Phase-1 re-check: design adds only dev-time artifacts and docs; still PASS.

## Project Structure

### Documentation (this feature)

```text
specs/025-text-first-runtime/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions D1–D8, verified codebase facts
├── data-model.md        # Phase 1 — governance entities (rule set, hatch, façade, map)
├── quickstart.md        # Phase 1 — V1–V7 validation scenarios
├── contracts/
│   ├── enforcement.md   # boundary rules R1–R4, message/gate/hatch contracts
│   └── agents-map.md    # required sections + style constraints for the map page
└── tasks.md             # Phase 2 ($speckit-tasks — NOT created by this command)
```

### Source Code (repository root)

```text
eslint.config.js                          # R1/R3 blocks + escape-hatch section (launch: empty)
scripts/check-dependency-direction.mjs    # R2/R4 backstop (stdlib-only) + fixture self-test
package.json                              # root script wrapping the direction check
.github/actions/ci/action.yml             # direction-check step after `pnpm lint`
src/lib/db/index.ts                       # façade: export type * from './schema', backup ops,
                                         #   runSelfCheck; uuid per research.md D2
src/lib/ids.ts                            # (only if ids.ts has no db-internal consumers) moved
src/                                      # ~6 façade-bypass fixes + ~15 type-import rewrites
docs/reference/agent-map.qmd              # the one-page agent's map
docs/reference/seams.qmd                  # repos/ → repositories/ fix + enforcement cross-link
docs/index.qmd, _quarto.yml               # sidebar/entry wiring for the map
AGENTS.md                                 # "Where to look" pointer to the map
```

**Structure Decision**: no new directories or packages — the feature weaves into the
existing tree (lint config, one script, one CI step, one docs page, mechanical import
fixes), matching the "ratify the present" scope. All artifacts are dev-time; nothing
ships to the SPA bundle or server image.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations — nothing to justify.
