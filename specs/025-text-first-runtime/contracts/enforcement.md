# Contract: The Enforcement Wire

**Audience**: implementers, reviewers, and the implementing agents the wire steers.
This is the behavioral contract for FR-001..FR-005 of
[spec.md](../spec.md). Mechanism decisions live in [research.md](../research.md) (D1–D4).

## The boundary being enforced

Two tiers, one direction:

1. **Data + logic tier** — everything in `src/lib/db/**` (schema, driver, repositories).
2. **App tier (UI passenger + feature logic)** — everything else under `src/`, including
   `src/lib/components`, `src/lib/stores`, `src/lib/services`, `src/lib/ai`, `src/lib/chat`,
   and `src/routes`.

Allowed dependency direction: **app → façade only**. The façade is `import ... from '$lib/db'`
(module `src/lib/db/index.ts`). Every deeper path (`$lib/db/schema`,
`$lib/db/driver/client`, `$lib/db/repositories/*`, `$lib/db/ids`, `$lib/db/backup`,
`$lib/db/self-check`, ...) is an internal of the data tier. The data tier never imports
app modules (no upward imports).

## Rule contract

| # | Rule | Scope | Violation examples (all real, all fixed at launch) |
| --- | --- | --- | --- |
| R1 | Static & type-only imports of `$lib/db/*` deep paths are errors | app tier | `+layout.svelte` → `$lib/db/driver/client`; `LabRunner.svelte` → `$lib/db/repositories/labs`; `import type { chats } from '$lib/db/schema'` |
| R2 | Dynamic `import('...$lib/db/...')` of deep paths is an error | app tier | `MessageList.svelte` dynamic `import('$lib/db/schema')` |
| R3 | `src/lib/db/**` must not import app modules (`$lib/components`, `$lib/stores`, `$lib/services`, `$lib/ai`, `$lib/chat`, `$lib/mcp`) | launch baseline: known straddlers (`db/driver/client`, `db/self-check` → `$lib/stores/db`; `db/driver/pg` → `$lib/services/client`; repositories → `$lib/chat/*`; `repositories/mcp` → `$lib/mcp/types`) are hatched per-file; new violations fail |
| R4 | Every live exception appears in the escape-hatch block with a justification | whole repo | — |

Sanctioned tooling is exempt from R1/R2: `**/*.test.ts` and `tests/**` (they import
`$lib/db/driver/pg-test` and fixtures by design).

## Message contract (FR-004)

Every violation report MUST contain: the offending **file**, the **rule** broken, and the
**sanctioned alternative**. Shape (eslint custom message / script output):

```
Boundary violation ({rule}): app code must import only from '$lib/db' (the repository
façade), never '$lib/db/<deep path>'. See docs/reference/seams + docs/reference/agent-map.
```

Aim: an implementing agent self-corrects without asking a human.

## Gate wiring (FR-003)

- R1/R3 run inside `pnpm lint` (ESLint) — already merge-blocking in CI
  (`.github/actions/ci/action.yml`) and runnable locally.
- R2/R4-backstop run via `scripts/check-dependency-direction.mjs` as a CI step
  immediately after `pnpm lint`, exposed as a root `pnpm` script for local runs.
- The wire is self-tested: fixture trees (violating and clean) are committed and run
  under Vitest, so the enforcement itself has regression coverage (SC-001).

## Escape-hatch contract (FR-005)

- The **only** exception mechanism is the dedicated overrides block in the enforcement
  config: `{ fileScope, ruleId, justification }` per data-model.md.
- Per-file inline disables of boundary rules are prohibited and treated as violations.
- No blanket disable (whole-repo, whole-directory, or "skip this run") may exist.
- Launch state: **zero hatches on R1/R2**; R3 launches with the pre-existing db→app
  straddlers baselined as per-file hatches (spec edge case "baselined escape hatches" —
  they migrate opportunistically, per the stragglers policy). Each future hatch is a
  reviewable diff line (SC-002).

## Documentation contract (FR-001)

- `docs/reference/seams.qmd` remains the authoritative boundary declaration; it gains the
  enforcement cross-link and the `repos/` → `repositories/` path fix.
- The agent's map (contracts/agents-map.md) references — never duplicates — both.
