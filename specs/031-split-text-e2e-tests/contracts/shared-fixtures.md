# Contract: Shared Text Fixtures (mock-llm ↔ both test tiers)

Phase 1 output. The interface contract between the mock LLM fixture server and every
test that asserts on its served text (FR-005, research D3).

## Purpose

Guarantee that an identical text change in the mock fixture fails both tiers identically.
Before this feature, `tests/e2e/fixtures/kitchen-sink.ts` hand-mirrored fixture-only
strings from the mock server with no drift guard, and the fast tier had no access at all.

## Source of truth

- Module family: `tests/fixtures/mock-llm/` (plain Node `.mjs`, importable by
  `server.mjs`, which runs outside the tsconfig program).
- Existing precedent: `markers.mjs` already owns the classification markers
  (`GRADING_MARKER`, `QUIZ_CONTRACT_MARKER`, `LAB_CONTRACT_MARKER`, `BRIEF_MARKER`, …)
  and is drift-guarded by `src/lib/ai/generate/classification-markers.test.ts`.
- This feature adds the fixture-only assertion strings to the same family (extend
  `markers.mjs` or a sibling `strings.mjs` — implementation choice, same rules):
  `PROPAGATE_TRIGGER`, `PROPAGATE_UNAVAILABLE_REPLY`, `OFFER_TRIGGER`, `OFFER_REPLY`,
  the grading `LEVER_TRIGGER_*` pair, and the `IMAGE_*` fixture strings, at minimum.

## Consumer rules

| Consumer | Import mechanic | Rule |
| --- | --- | --- |
| Mock server (`server.mjs`) | static `.mjs` import | serves exactly the constants; defines no inline copies of served assertion text |
| E2E specs | via `tests/e2e/fixtures/kitchen-sink.ts` re-export | kitchen-sink re-exports; **hand-mirroring a served string is a violation** |
| Fast-tier tests | dynamic import (`fileURLToPath`) — `tests/fixtures` is tsconfig-excluded; precedent `classification-markers.test.ts` | import, never redefine |

## Drift guard (mandatory)

A fast-tier test (beside or extending `classification-markers.test.ts`) MUST fail when:

1. a constant's value diverges from what the mock actually serves (server response
   templates reference the constants, so divergence = serving inline copies — also a
   violation), or
2. `kitchen-sink.ts` contains a hand-mirrored copy of any exported constant.

## Invariants

- Single definition: each served assertion string exists as exactly one exported
  constant; zero inline duplicates across `server.mjs`, `kitchen-sink.ts`, or any test.
- Both tiers assert against the same constant object; changing a fixture's text changes
  both tiers' expectations atomically (no tier-specific mirrors to update).
- The contract covers fixture **text** only; DOM selectors, URLs, and timing windows are
  e2e-local and stay in `kitchen-sink.ts`.
