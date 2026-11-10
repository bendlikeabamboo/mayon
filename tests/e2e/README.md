# E2E tests

Playwright suite (`pnpm test:e2e`, config in `playwright.config.ts`). It runs
against the dev stack's web app (default `http://127.0.0.1:5173`), with the
deterministic mock LLM from `tests/fixtures/mock-llm/` standing in for a real
provider — see that directory's README for the harness.

Per the [Agent's Map](../../docs/reference/agent-map.qmd), the browser is for
UI-only behavior and explicitly-classified live-path dispatches, not for
proving text-generation behavior. Feature 031 enacted this split on the test
artifacts: every composed data/loop invariant below has a fast-tier home
(`useFileTestDb()` → seed via `repos` → assert on text/rows, colocated
`src/**/*.test.ts`), and this inventory is the parity ledger for the split
(contract: `specs/031-split-text-e2e-tests/contracts/browser-inventory.md`).

## Inventory & parity ledger

One row per `tests/e2e/*.spec.ts`. "Behavior invariants → fast-tier home"
gives the disposition per touched assertion cluster: `already-covered →`
(no build needed), `migrated →` (031 build), `retained-ui` (render/wiring
purpose), `retained-live-path` (explicit wire classification), or
`pruned-covered` (assertion deleted; coverage pre-existed).

| Spec                       | Classification          | UI residue — what it still proves                                             | Behavior invariants → lower tier (ledger)                                                                                                                                                                                                 |
| -------------------------- | ----------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onboard.spec.ts`          | `ui-only` + `live-path` | One seeded-provider round trip: live streaming markers, durable reply, proxy. | Catalog discovery/live fetch (`src/lib/components/ai/ProviderConfig.browser.test.ts`, `src/lib/ai/model-discovery.test.ts`) · LM Studio keyless add (`ProviderConfig.browser.test.ts`) · seeding/dismissal (`tests/e2e/global-setup.ts`). |
| `quiz.spec.ts`             | `ui-only` + `live-path` | Quiz generation over the real proxy, every question type, results score.      | Wrong-answer grading lever (`src/lib/ai/generate/generate-quiz.test.ts`, `src/lib/stores/quizzes.svelte.test.ts`); the retained case also proves the correct branch.                                                                      |
| `lab.spec.ts`              | `ui-only` + `live-path` | Lab generation over the real proxy, checklist completion, reload persistence. | Generation and checklist persistence (`already-covered → src/lib/agent/generative-tools.test.ts`, `src/lib/stores/labs.svelte.test.ts`); live dispatch `retained-live-path`.                                                              |
| `render.spec.ts`           | `ui-only`               | Streamed markdown structure + mermaid diagram; expound selection→offset rows. | Math, mermaid theme flip, and copy affordance (`src/lib/components/chat/Markdown.render.browser.test.ts`); pure render logic (`src/lib/markdown/*.test.ts`). The DOM alignment/DB row is the retained integration proof.                  |
| `image-round-trip.spec.ts` | `ui-only` + `live-path` | Live marker, pending placeholder, durable thumbnail render, reload redisplay. | Reload-serves-from-row (`migrated → src/lib/stores/chat.svelte.test.ts`) · `image_reply +1` request-count scrape `retained-live-path` (one classified completion through the proxy) · render `retained-ui`.                               |
| `backprop-tool.spec.ts`    | `ui-only` + `live-path` | Branch → tool approval → continuation stream → parent artifact, via real UI.  | Offer/declined/root end states (`already-covered → src/lib/chat/backprop-endstate.test.ts`); the retained case keeps the real approval→artifact integration path.                                                                         |

## Policy

1. Every new browser spec ships with its inventory row filled in the same
   change; an unclassified spec is a policy mismatch.
2. The row must state a `ui-only`/`live-path` purpose; a browser test whose
   stated purpose is proving text-generation behavior is a policy mismatch —
   the invariant belongs in the fast tier (`useFileTestDb()` → seed via
   `repos` → assert on text).
3. Deleting a browser assertion requires its ledger disposition to be
   `migrated →` or `pruned-covered` **before** deletion (coverage never
   dips).
4. Hand-mirroring mock-served strings instead of importing the shared fixture
   constants violates the
   [shared-fixtures contract](../../specs/031-split-text-e2e-tests/contracts/shared-fixtures.md)
   (import rules: `tests/fixtures/mock-llm/README.md`).

No spec is currently camera-style (none takes screenshots for visual review).
When a visual check is needed, keep it screenshot-plus-review and occasional —
it confirms appearance and does not double as a behavior test.

## Retired specs

- `telemetry.spec.ts` (032 T042) required an external stub receiver and a
  fixed polling sleep. Ingest/protocol coverage lives in
  `server/src/telemetry-ingest.test.ts`; the client-emission payload shape is
  asserted at the MSW boundary by
  `src/lib/telemetry/emission.browser.test.ts`. The e2e suite no longer needs
  that external receiver.
- `provider-picker.spec.ts` (032 T043): picker grouping/search/empty state moved
  to `src/lib/components/ai/provider-template-picker.browser.test.ts`;
  tool-capability persistence and connection coaching moved to
  `src/lib/components/ai/ProviderConfig.browser.test.ts`; classification and
  catalog merge stay in `src/lib/ai/connection-test.test.ts` and
  `src/lib/ai/model-discovery.test.ts`.
- `prompt-contract.spec.ts` (032 T044): the read-only contract region and
  instructions editor moved to
  `src/lib/components/generation/GenerationPromptConfig.browser.test.ts`; the
  effective system-prompt assembly remains at Tier 1 in
  `src/lib/ai/generate/generate.test.ts` and `generate-quiz.test.ts`.
- `mock-classification.spec.ts` (032 T045): request-kind classification is Tier 1
  (`src/lib/ai/generate/generate.test.ts`, `generate-quiz.test.ts`,
  `classification-markers.test.ts`); its round-trip/quiz/lab wire cases
  duplicated the retained `onboard`, `quiz`, and `lab` journeys.
- Removed cases from retained specs (032 T043–T045) are enumerated in
  `specs/032-test-suite-tiering/migration-ledger.md` with their replacement
  path or retirement rationale.
