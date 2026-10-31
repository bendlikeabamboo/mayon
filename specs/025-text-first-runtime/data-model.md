# Data Model: 025-text-first-runtime

This feature adds **no database entities** — no schema change, no migration. Its "data"
is a set of governance artifacts. They are modeled here because they have structure,
validation rules, and relationships the implementation must respect.

## Entities

### EnforcementRuleSet

Where it lives: the flat-config blocks in `eslint.config.js` plus the rule table in
`scripts/check-dependency-direction.mjs`.

| Field | Content |
| --- | --- |
| `scope` | File globs the rule applies to (app layer: `src/**` minus `src/lib/db/**`, `**/*.test.ts`, `tests/**`; data layer: `src/lib/db/**`) |
| `restriction` | App layer: no import (static, type-only, or dynamic) of `$lib/db/*` — only the façade `$lib/db` is allowed. Data layer: no import of app modules (`$lib/components`, `$lib/stores`, `$lib/services`, `$lib/ai`, routes) |
| `message` | Names the broken rule and the sanctioned alternative (see contracts/enforcement.md for the exact shape) |
| `severity` | error (merge-blocking via `pnpm lint` / CI) |

**Validation**: for every violation class covered, a planted fixture fails the gate and
a clean fixture passes (self-test under Vitest; SC-001).

### EscapeHatch

Where it lives: a dedicated overrides block in `eslint.config.js` (or the script's rule
table). One entry per exception.

| Field | Content |
| --- | --- |
| `fileScope` | Exact file or minimal glob the exception applies to |
| `ruleId` | The boundary rule being excepted |
| `justification` | Inline comment: why the exception is legitimate |

**Validation**: any violation not matching a hatch entry fails; hatch entries without
justification fail review (SC-002). **Launch state: zero entries** (see research.md D3).

**State transitions**: `proposed` (diff adds an entry) → `reviewed` (PR merge) →
`active`; any entry may be removed, returning the file to rule coverage.

### Façade surface (`src/lib/db/index.ts`)

The only import surface app-layer code may use. Runtime exports stay as-is
(`getDb`, `repos`, bootstrap fns, driver handle) **plus** the additions needed to close
day-one bypasses: `runSelfCheck`, the backup operations used by `src/lib/services/*`,
and `export type * from './schema'` (+ repo payload types used by
`src/lib/ai/generate/*`). `uuid` is satisfied per research.md D2 (move `ids.ts` out of
the data layer if db-internal, else façade re-export).

**Validation**: after the mechanical rewrites, no app-layer file imports any `$lib/db/*`
deep path (the rule set proves it); `pnpm check` + `pnpm test` stay green.

### AgentsMap (`docs/reference/agent-map.qmd`)

One page; structure contract in contracts/agents-map.md.

| Field | Content |
| --- | --- |
| sections | Placement policy / proving path / browser allowance / escape hatches & enforcement pointers |
| references | Links to `seams.qmd`, `architecture.qmd`, the enforcement config — never a duplicate |
| entry points | Quarto sidebar + `docs/index.qmd` + `AGENTS.md` "Where to look" |

**Validation**: an agent with no other context plans a sampled feature correctly
(SC-003); page renders in the docs site.

## Relationships

- `EnforcementRuleSet` → protects the `Façade surface` (the rule references the façade
  as the sanctioned alternative in every message).
- `EscapeHatch` → excepts files from exactly one `EnforcementRuleSet` rule.
- `AgentsMap` → references `EnforcementRuleSet` location and the `Façade surface`
  contract; never embeds their content (anti-drift, FR-006).

## Invariants (mapped to spec)

- No unlisted violation passes (FR-002/FR-005) — enforced by rule-set + hatch design.
- Gates stay green at launch (spec edge case) — enforced by zero-hatch launch state.
- No new runtime surface (FR-010) — all entities are dev-time artifacts.
