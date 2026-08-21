<!--
Sync Impact Report
- Version change: (unresolved template scaffold) -> 1.0.0
- Modified principles: none (initial ratification; no prior principles existed)
- Added sections: Core Principles I-IV, Quality Gates, Development Workflow & Compliance,
  Governance
- Removed sections: none
- Follow-up TODOs: none (all placeholders resolved)
-->

# Mayon Constitution

## Core Principles

### I. Code Quality

- Layering is inviolable: application code calls repositories only. Components, stores,
  and routes MUST NOT import `db` directly — it is private to `src/lib/db/`, exposed via
  `getDb()` / `repos`.
- The `StorageDriver` seam (`src/lib/db/driver/types.ts`: `query` / `batch` / `exec`) is
  the only storage boundary. Drivers MUST remain dumb SQL executors; repositories own all
  query logic.
- Every change MUST pass `pnpm check` (svelte-check) and `pnpm lint` (ESLint + Prettier)
  before merge. Toolchain pins (Node 22, pnpm 10) MUST be respected — no bun, no Rust.
- No secrets in `settings`: provider config holds non-secret handle fields only. API keys
  live in IndexedDB and are sent only in same-origin proxied requests.
- SvelteKit reserves the `+` filename prefix for routing; test files and other non-route
  files MUST NOT use it.

### II. Testing Standards

- `pnpm test` (Vitest with the pglite test driver) MUST pass before merge; server-side
  changes MUST additionally pass `pnpm --filter @mayon/server test`.
- Every bug fix MUST ship with a regression test that fails without the fix.
- New behavior in `src/lib/` and `server/src/` MUST be accompanied by tests. UI-only
  presentation changes SHOULD be verified via `pnpm check` plus manual smoke testing on
  the dev stack (`pnpm dev`).
- Full-text search columns (`search_vec`) are `GENERATED ALWAYS AS (...) STORED`. Tests
  MUST NOT write to them and MUST NOT introduce reindex or "rebuild search index" paths.

### III. User Experience Consistency

- UI MUST be composed from the existing Tailwind v4 + shadcn-svelte (bits-ui) component
  vocabulary. New components SHOULD extend established patterns before introducing new
  primitives, and MUST match existing visual conventions (spacing, typography, theming).
- Features MUST degrade progressively: runtime capabilities are detected at boot via
  `detectServer()` and features enable from advertised capabilities (`stdio-mcp`,
  `llm-proxy`, `sandbox-db`, `backup`, `pg`). UI code MUST NOT assume the server is
  present.
- User-facing operations MUST NOT cause downtime or server restarts. Backup/restore is
  in-place: while a restore runs, `/api/db/query` returns 503 and `/api/health` reports
  `restoring: true` — nothing else is disrupted.
- Expound/highlight selections MUST use raw-markdown offsets resolved via the source map
  (`src/lib/markdown/sourcemap.ts`) plus DOM alignment (`src/lib/chat/selection.ts`).
  Substring heuristics, `surroundContents`, and full-span fallbacks are prohibited.

### IV. Performance Requirements

- Performance-sensitive changes MUST be measured with the perf probe
  (`src/lib/perf/`, enabled via `window.__MAYON_PERF__ = 1`) before and after.
  Unmeasured performance claims are not accepted.
- Full-text search MUST rely on self-maintaining generated columns; synchronous
  reindexing passes and index-rebuild affordances MUST NOT be added.
- Database restore MUST preserve `pg_restore --single-transaction` atomicity semantics
  with the maintenance 503 flag; nuke-and-pave restore paths are prohibited.
- SPA bundle growth MUST be justified: adding heavy dependencies requires rationale in
  the spec review before adoption. `@mayon/shared` MUST be built before any consumer
  resolves its types, so build order is part of correctness, not optimization.

## Quality Gates

- Merge blockers, in order: `pnpm check`, `pnpm lint`, `pnpm test`, and (for server
  changes) `pnpm --filter @mayon/server test`. A red gate blocks the change regardless
  of review approval.
- Drizzle migrations MUST be generated via `pnpm db:generate` from
  `src/lib/db/schema.ts`; hand-edited migration SQL requires explicit justification in
  the PR.
- Releases follow the RC-first flow defined in `AGENTS.md`: `package.json` versions in
  all three files equal the tag base version, `CHANGELOG.md` contains the matching
  section, and every GitHub Release body (RC and stable) carries curated release notes
  sourced from `CHANGELOG.md`.

## Development Workflow & Compliance

- This constitution governs principles; `AGENTS.md` governs day-to-day mechanics
  (commands, topology, release steps). On conflict, this document wins for governance
  questions and `AGENTS.md` wins for mechanical detail.
- The authoritative as-is design lives in `docs/dev/architecture.qmd` and
  `docs/dev/seams.qmd`. Deviating from a documented seam requires a constitution
  amendment first.
- Reviewers MUST verify constitution compliance as part of every code review; complexity
  beyond documented seams MUST be justified in the PR description.

## Governance

- Amendments require: (1) a written proposal identifying the principle(s) affected,
  (2) a version bump per SemVer — MAJOR for principle removal or incompatible
  redefinition, MINOR for new principles or materially expanded guidance, PATCH for
  clarifications and wording, (3) a Sync Impact Report prepended to this file, and
  (4) a compliance plan for code affected by the change.
- Compliance is verified at code review time on every PR, and re-checked as part of each
  release cycle before tagging an RC.
- The ratification date records original adoption; the last-amended date updates with
  every accepted amendment. Both use ISO `YYYY-MM-DD`.

**Version**: 1.0.0 | **Ratified**: 2026-08-18 | **Last Amended**: 2026-08-18
