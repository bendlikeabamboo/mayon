# Contract: Browser-Suite Inventory & Parity Ledger (`tests/e2e/README.md`)

Phase 1 output. The classification + parity contract for the browser tier (FR-002/FR-003/
FR-004/FR-008, research D1/D4/D5/D8).

## Purpose

Keep "what is this browser test for?" answerable at a glance and reviewable at addition
time, and record where every migrated behavior invariant now lives. The inventory is the
parity ledger's home — one artifact, maintained in the repo, traveling with the code.

## Table contract

`tests/e2e/README.md` MUST carry one row per spec file in `tests/e2e/` (all 10 today,
including `backprop-tool` and `telemetry`, currently missing). Columns:

| Column | Content |
| --- | --- |
| Spec | file name (`*.spec.ts`) |
| Classification | `ui-only`, `live-path`, or `ui-only + live-path` |
| UI residue — what it still proves | one line: rendering / wiring / reload-render persistence / live dispatch |
| Behavior invariants → fast-tier home | per assertion cluster: `already-covered → <file>` / `migrated → <file>` / `retained-ui` / `retained-live-path` / `pruned-covered` |

### Classification vocabulary

- **ui-only**: the spec's surviving assertions prove rendered DOM, wiring, or
  reload-render persistence (boot/hydration path).
- **live-path**: the spec exercises the full browser → `/api/llm/proxy` → mock-llm
  request path (real sockets, CORS preflight, key storage → header assembly). Proxy
  mechanics themselves are already proven in-process by `server/src/llm-proxy.test.ts`
  — live-path rows exist for the wire, not the mechanics.
- **data-logic** (ledger clusters only, never a spec-level classification): a cluster
  whose sole purpose is a behavior invariant; after this feature every data-logic
  cluster's disposition is `migrated → …`, `already-covered → …`, or `pruned-covered`.

## Policy statements (MUST appear in the README)

1. Every new browser spec ships with its inventory row filled in the same change; an
   unclassified spec is a policy mismatch.
2. The row must state a `ui-only`/`live-path` purpose; a browser test whose stated
   purpose is proving text-generation behavior is a policy mismatch — the invariant
   belongs in the fast tier (`useFileTestDb()` → seed via `repos` → assert on text).
3. Deleting a browser assertion requires its ledger disposition to be `migrated →` or
   `pruned-covered` **before** deletion (coverage never dips — FR-008).
4. Hand-mirroring mock-served strings instead of importing the shared fixture constants
   violates the [shared-fixtures contract](./shared-fixtures.md).

## Pruning boundary (review rubric, from research D8)

An e2e assertion may be deleted only when its fast-tier home is green **and** its sole
purpose was one of: durable-row counts; absence windows (no-approval-ask / no-toast /
no-re-ask sweeps); persisted-trace iteration counts; mock-log request scrapes. Render
checks, reload-render persistence checks, navigation checks, and live-path steps are
retained-ui / retained-live-path and stay.
