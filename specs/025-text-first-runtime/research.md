# Research: 025-text-first-runtime

Phase 0 decisions for the enforceable text-first runtime tier. Facts below were verified
against the codebase on 2026-10-31 (via research pass over `eslint.config.js`,
`.github/workflows/ci.yml`, `.github/actions/ci/action.yml`, `src/lib/db/index.ts`,
`docs/reference/seams.qmd`, and a full boundary-violation scan).

## Context facts (verified)

- `eslint.config.js` is a flat config wrapped in `ts.config(...)` with **no import-boundary
  rules**; root `pnpm lint` (`eslint . && prettier --check .`) already sweeps `server/src`
  and `packages/*/src` (only `server/dist/`, `packages/*/dist/` etc. are ignored).
- Neither `eslint-plugin-import` nor `eslint-plugin-boundaries` is installed anywhere in
  the lockfile.
- CI (`ci.yml` → composite `.github/actions/ci/action.yml`) runs `pnpm lint` at the root
  as a merge-blocking step, then `pnpm check`, `pnpm test`, `pnpm build`.
- `src/lib/db/index.ts` is the sanctioned façade (header comment says so; exports
  `getDb`/`repos`/bootstrap fns/payload+search types). Real deep-import bypasses exist
  today: `src/routes/+layout.svelte:12,14` (`bootstrapDb`, `runSelfCheck`),
  3 components importing `uuid` from `$lib/db/ids`, and
  `src/lib/components/labs/LabRunner.svelte:6` (`labsRepo` direct from the repo module).
  ~15 files use type-only `import type ... from '$lib/db/schema'`; schema types are not
  re-exported through the façade. One **dynamic** `import('$lib/db/schema')` exists
  (`src/lib/components/chat/MessageList.svelte:44`).
- `src/lib/services/{db-import,db-backup,sandbox-backup}.ts` import `$lib/db/backup`;
  `src/lib/ai/generate/{quiz,lab}.ts` import types from `repositories/{quizzes,labs}`.
  `src/lib/stores/` is clean (all imports via `repos` from `$lib/db`).
- No `getDb`/drizzle-instance imports outside `src/lib/db/`; no server→web imports
  (`server/src` never references `$lib`).
- `docs/reference/seams.qmd` owns the boundary rule ("Components and stores call
  repositories only") but cites a stale path `src/lib/db/repos/` (actual:
  `src/lib/db/repositories/`). No agent's-map document exists; docs are Diátaxis-structured.
- Text harness: `useFileTestDb()` (`src/lib/db/driver/pg-test.ts`) seeds through `repos`
  into PGlite with real migrations; usage pattern is established in colocated tests.

## Decisions

### D1 — Enforcement mechanism: core ESLint rule, no new dependencies

- **Decision**: enforce the import boundary with the core `no-restricted-imports` rule
  (flat-config `files`-scoped blocks in `eslint.config.js`), plus a small dependency-free
  Node script (`scripts/check-dependency-direction.mjs`) as a CI backstop.
- **Rationale**: the boundary is one seam with a known façade; core rule + patterns needs
  zero new dev dependencies, keeps the wire inside `pnpm lint` (already a merge-blocking
  gate, satisfying FR-003 with no CI surgery for the lint half), and produces actionable
  messages (FR-004) via the rule's custom `message`.
- **Alternatives considered**:
  - `eslint-plugin-boundaries` — purpose-built element/dependency rules, but a new
    dependency and config taxonomy for what is one boundary; rejected (constitution
    frowns on unjustified dependency growth, even dev-side).
  - `eslint-plugin-import` — not installed, heavy, and its `no-unresolved`/ordering rules
    don't target this; rejected.
  - CI-only grep script without lint rules — loses per-file editor/lint feedback and the
    "merge-blocking via existing gates" property; rejected as primary, adopted as backstop.

### D2 — Boundary shape: façade-only, absolute, types included

- **Decision**: the rule covers all app-layer code — everything under `src/` except
  `src/lib/db/**` and sanctioned tooling (`**/*.test.ts`, `tests/**`) — and restricts
  imports of `$lib/db/*` deep paths entirely: app code may import **only** `$lib/db`
  (the façade). Type-only deep imports are covered too: the façade gains
  `export type * from './schema'` (plus the repo payload types used by
  `src/lib/ai/generate/*`), and the ~15 type-only deep imports are rewritten
  mechanically. `src/lib/db/**` gets a mirrored direction rule: db modules must not
  import app modules (`$lib/components`, `$lib/stores`, `$lib/services`, `$lib/ai`,
  routes) — no upward imports.
- **Rationale**: an absolute rule (no type-import exception) is the simplest to state,
  enforce, and extend — exceptions carve-outs are where lint rules rot. Types are
  contracts, not internals: re-exporting them through the façade costs one line and
  removes the entire near-façade gray zone.
- **Alternatives considered**:
  - Allow `import type` from `$lib/db/schema` as a licensed exception — rejected: two
    rule regimes to explain and drift; the MessageList dynamic import already shows how
    type reach-arounds accumulate.
  - Curated façade type exports instead of `export type *` — rejected as default (API
    gardening churn); tasks may curate later if the surface proves too broad.
- **Open detail for tasks**: `uuid` from `$lib/db/ids` — if `ids.ts` has no consumers
  inside `src/lib/db/`, move it out of the data layer (it is not storage logic); if db
  internals use it, re-export `uuid` from the façade. Either way app code ends at the
  façade; implementation picks by inspecting consumers.

### D3 — Day-one triage: fix every bypass, zero baselined escape hatches

> **Amended at implementation (2026-10-31)**: the zero-hatch invariant holds for the
> app→façade direction (R1/R2) — all 6 runtime bypasses and ~15 type-only deep imports
> were indeed fixable mechanically. The pre-scan missed db→app upward imports (R3):
> `db/driver/client` + `db/self-check` → `$lib/stores/db`, `db/driver/pg` →
> `$lib/services/client`, repositories → `$lib/chat/{kinds,brief,expound-instructions}`,
> `repositories/mcp` → `$lib/mcp/types`. These are design straddlers, not mechanical
> fixes — per the spec edge case they launch as explicit baselined per-file hatches
> and migrate opportunistically. R3 therefore covers the full app-module list from day
> one rather than being narrowed.

- **Decision**: all 6 runtime bypasses and the ~15 type-only deep imports are fixed
  before the wire goes live (`bootstrapDb` → façade; `runSelfCheck` re-exported via
  façade; `uuid` per D2; `labsRepo` → `repos.labs`; services' `$lib/db/backup` use
  satisfied by façade re-exports of the backup operations they call). Launch state:
  **zero escape hatches**.
- **Rationale**: the counts are small and mechanical; a clean tree at launch makes the
  rule absolute (FR-005's "no unlisted violation passing") instead of shipping a
  baseline list that immediately reads as debt. Matches the spec's edge case "enforcement
  must not go live failing the whole tree".
- **Alternatives considered**: baseline-and-escape existing violations (standard
  lint-adoption practice) — rejected: baseline entries for fixable mechanical issues
  bury the policy in exceptions at birth.

### D4 — Direction backstop: tiny Node script wired into the CI composite

- **Decision**: `scripts/check-dependency-direction.mjs` (dependency-free, ~tens of
  lines) scans `src/` for (a) dynamic `import('...$lib/db/...')` calls that dodge the
  lint rule — the `MessageList.svelte:44` pattern — and (b) `src/lib/db/**` importing
  app modules. It runs in `.github/actions/ci/action.yml` immediately after `pnpm lint`
  and gets a self-test fixture tree under Vitest so the wire itself is tested
  (constitution: new behavior ships with tests).
- **Rationale**: core `no-restricted-imports` does not reliably cover dynamic
  `import()`; the spec names "CI dependency-direction checks" explicitly, and a
  self-tested script satisfies both without new dependencies.
- **Alternatives considered**:
  - Rely on ESLint alone — rejected: known dynamic-import gap.
  - `dependency-cruiser` — powerful direction engine, but a new dependency for a
    two-rule check; rejected.

### D5 — Agent's map home: `docs/reference/agent-map.qmd`, linked from AGENTS.md

- **Decision**: the one-page map lives in `docs/reference/` (Diátaxis reference —
  normative "where things live / what's allowed"), wired into the Quarto sidebar and
  `docs/index.qmd`, and linked from `AGENTS.md`'s "Where to look" section (agents enter
  via AGENTS.md; the docs site stays authoritative). `seams.qmd` gets the stale
  `src/lib/db/repos/` → `src/lib/db/repositories/` fix plus a cross-link to the
  enforcement rules.
- **Rationale**: FR-001 requires the declaration to live in existing architecture docs
  (seams.qmd already owns it) and FR-006 requires the map to reference, not duplicate,
  them; reference is the correct Diátaxis home for a policy/map page.
- **Alternatives considered**:
  - `docs/explanation/` — rejected: the map is normative steering, not narrative.
  - AGENTS.md as the map's home — rejected: unrendered, not user-facing, duplicates the
    docs site; a pointer is enough.

### D6 — Escape hatches: scoped config block, justification mandatory

- **Decision**: the only escape mechanism is a dedicated, clearly-commented overrides
  block in `eslint.config.js` (or the script's config): file-scoped, one entry per
  exception, each with an inline justification. No inline-disable mechanism is
  permitted to survive: the boundary rules are configured `reportUnusedDisableDirectives`
 -style tight — disables for boundary rules are treated as failures. Any hatch is a
  visible, reviewable diff line.
- **Rationale**: FR-005 requires explicit, centralized, justified exceptions with no
  blanket-disable path; eslint config-as-code gives exactly that for free.
- **Alternatives considered**: allow per-file `eslint-disable-next-line` — rejected:
  silent, unreviewable, and scatters exceptions across the tree.

### D7 — Server scope: verified, not extended

- **Decision**: no new server boundary is invented. Verified fact recorded instead:
  `server/src` never imports web `$lib` code, so no rule is needed there today; the
  existing server gates stand. Out-of-scope observation logged for the maintainer:
  `ci.yml` never runs the server test suite (`pnpm --filter @mayon/server test` — only
  `pnpm test:all` runs it locally); this feature does not change that.
- **Rationale**: FR/spec edge case says the wire governs the app's tier separation;
  inventing server rules with zero violations to catch is speculative machinery.

### D8 — Text harness and live doors: documented, not rebuilt

- **Decision**: FR-008/FR-009 are satisfied by documentation: the agent's map names
  `useFileTestDb()` + `repos` seeding as the default proving path (pointing at an
  exemplar test) and names `/api/health` + `/api/db/query` as the RC-time live-stack
  doors. No harness code changes.
- **Rationale**: the bet "ratifies the present" — the harness exists and works; the new
  work is naming, freezing, wiring (D1–D4), and mapping.

## Resolved NEEDS CLARIFICATION

None — the Technical Context carries no unknowns; every choice above was decidable from
verified codebase facts plus the constitution.
