# Data Model: 031-split-text-e2e-tests

Phase 1 output. This feature changes no database schema and no runtime entities — its
"data model" is the governance artifact set that makes the two-tier split durable.
All entities are files/records in the repository, not rows in Postgres.

## Entities

### TestTier

The two separated artifact groups (FR-001).

| Field | Fast tier | Browser tier |
| --- | --- | --- |
| id | `fast` | `browser` |
| artifacts | `src/**/*.test.ts`, `server/src/**/*.test.ts` | `tests/e2e/*.spec.ts` |
| purpose | text-generation behavior: seed state via `repos` (`useFileTestDb()`), run logic, assert on text/rows | UI-only wiring, rendering, visual behavior; explicitly-classified live-path dispatches |
| run profile | `pnpm test` / `pnpm --filter @mayon/server test`; in-process; no browser, no containers | `pnpm test:e2e`; full docker dev stack + mock-llm + chromium |
| gate | `web` CI job (merge-blocking) | `e2e` CI job (merge-blocking) |
| may assert | persisted rows, reply text, trace shape, emitted records, absence invariants | rendered DOM, reload-render persistence, live request-path outcomes |

Validation: an assertion belongs to exactly one tier (FR-001); a browser-tier assertion
whose sole purpose is fast-tier-covered behavior is invalid (FR-003).

### BehaviorInvariant

A single provable statement about text-generation behavior (FR-002).

- **statement**: the invariant in one sentence (e.g. "an offer turn persists exactly two
  durable rows and never an approval ask").
- **tier**: always `fast` after this feature.
- **home**: the test file (and case) proving it.
- **provenance**: either `migrated` (names the e2e spec + assertion cluster it came
  from) or `native` (born in the fast tier).

Validation: exactly one home (no dual homes after pruning); migrated invariants must have
`provenance` set — that is the parity trail.

### ParityLedgerEntry

One row per e2e assertion cluster touched by the split (FR-002/FR-008). Lives as the
parity column of the `tests/e2e/README.md` inventory (D4).

- **spec**: the `tests/e2e/` spec file.
- **cluster**: the assertion group (e.g. "offer-turn no-approval-ask sweeps").
- **class**: `data-logic` | `ui-only` | `live-path` (triage vocabulary).
- **disposition**: one of
  - `already-covered → <existing fast-tier home>` (no build needed),
  - `migrated → <new fast-tier home>` (D2 build),
  - `retained-ui` (render/wiring purpose),
  - `retained-live-path` (explicit classification, D5),
  - `pruned-covered` (assertion deleted; coverage pre-existed).
- **ordering rule (state transition)**: `migrated` entries go
  `proposed → fast-home-exists → e2e-pruned`; the e2e assertion may be deleted only in
  the final state (FR-008 — coverage never dips).

Validation: every spec in `tests/e2e/` has at least one ledger row; zero clusters in
`proposed` at completion.

### BrowserClassification

The inventory entry stating a spec's purpose (FR-004). Lives in `tests/e2e/README.md`.

- **spec**: file name (one row per spec — 10 rows today, including `backprop-tool` and
  `telemetry`, currently missing).
- **purpose label**: `ui-only` or `live-path` (or combined `ui-only + live-path`).
- **ui residue**: one line naming what the spec still proves after pruning.
- **parity column**: link into ParityLedgerEntry dispositions.

Validation: 100% of `tests/e2e/*.spec.ts` classified; additions without a stated purpose
are policy mismatches.

### SharedTextFixture

A deterministic expected-text constant asserted by both tiers (FR-005, D3).

- **name/value**: exported constant (e.g. `OFFER_REPLY`, `PROPAGATE_UNAVAILABLE_REPLY`).
- **source module**: single source of truth in `tests/fixtures/mock-llm/` (the mock
  server's own module family).
- **consumers**: mock server (`server.mjs`), e2e assertions (`kitchen-sink.ts` re-export),
  fast-tier tests (dynamic-import precedent).
- **drift guard**: the fast-tier test asserting exported constants equal what the mock
  serves / what each tier asserts against.

Validation: no hand-mirrored copies of a served string may exist outside the source
module; every consumer imports (not redefines).

## Relationships

```text
BrowserClassification 1—* ParityLedgerEntry *—1 BehaviorInvariant (when disposition = migrated)
SharedTextFixture *—* BehaviorInvariant (invariants asserting on fixture text)
TestTier 1—* BehaviorInvariant (all fast, post-split)
```

## Notes

- No drizzle migration, no `db:generate`, no schema-version bump — storage untouched.
- The ledger and classification are markdown records reviewed in PRs; machine-linting
  them is explicitly deferred (D4 rationale), matching 025's review-discipline stance.
