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

| Spec                          | Classification          | UI residue — what it still proves                                                                          | Behavior invariants → fast tier (ledger)                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onboard.spec.ts`             | `ui-only`               | Onboarding flow, provider settings wiring, streaming-render markers.                                       | Seed/conversation persistence beyond the first turn is repository behavior; this spec only wires first-boot state. No migrated clusters — `retained-ui` throughout.                                                                                                                                                                                                                                     |
| `provider-picker.spec.ts`     | `ui-only`               | Picker groups/search/empty state, card UI, status text, discovery dialog, live fetch.                      | Tool-capability trace counts (`migrated → src/lib/agent/loop.test.ts`) · discovery catalog merge (`migrated → src/lib/ai/connection-test.test.ts`) · `/models` parsing, sort/dedupe, empty-providers seed (`already-covered → src/lib/ai/model-discovery.test.ts`, `src/lib/ai/connection-test.test.ts`, `src/lib/db/repositories/repositories.test.ts`) · remaining card/persistence UI `retained-ui`. |
| `prompt-contract.spec.ts`     | `ui-only`               | Read-only contract region rendering; instructions editor wiring.                                           | Instructions persistence is repository behavior (`already-covered → src/lib/db/repositories/repositories.test.ts` settings CRUD); only the render/edit wiring stays.                                                                                                                                                                                                                                    |
| `quiz.spec.ts`                | `ui-only` + `live-path` | Quiz render, grading UI, attempt display over the real proxy path.                                         | Generation/grading/attempt persistence (`already-covered → src/lib/agent/generative-tools.test.ts`, `src/lib/stores/quizzes.svelte.test.ts`); live dispatch remains `retained-live-path`.                                                                                                                                                                                                               |
| `lab.spec.ts`                 | `ui-only` + `live-path` | Lab render and checklist UI over the real proxy path.                                                      | Generation and checklist persistence (`already-covered → src/lib/agent/generative-tools.test.ts`, `src/lib/stores/labs.svelte.test.ts`); live dispatch remains `retained-live-path`.                                                                                                                                                                                                                    |
| `mock-classification.spec.ts` | `ui-only` + `live-path` | Render of classification-served replies over the real proxy path.                                          | Request-kind classification logic (`already-covered → src/lib/ai/generate/generate.test.ts`, `generate-quiz.test.ts`); the browser row exists for the wire path (`retained-live-path`).                                                                                                                                                                                                                 |
| `render.spec.ts`              | `ui-only`               | Markdown/math/mermaid rendering, copy affordance, theme re-render; expound selection→offset DOM alignment. | Pure rendering/markup logic (`already-covered → src/lib/markdown/*.test.ts`, `src/lib/chat/*.test.ts` where colocated); the DOM alignment layer is the retained UI proof.                                                                                                                                                                                                                               |
| `image-round-trip.spec.ts`    | `ui-only` + `live-path` | Live marker, pending placeholder, durable thumbnail render.                                                | Reload-serves-from-row (`migrated → src/lib/stores/chat.svelte.test.ts`; e2e mock-log zero-request scrape deleted after the fast home went green) · `image_reply +1` request-count scrape `retained-live-path` (wire composition: the turn issues exactly one classified completion through the proxy) · render `retained-ui`.                                                                          |
| `backprop-tool.spec.ts`       | `ui-only`               | Approve/Decline UI, tool badges, reload-render persistence, breadcrumb, branch wiring.                     | Offer-turn end-state (`migrated → src/lib/chat/backprop-endstate.test.ts`) · declined-turn end-state (`migrated → src/lib/chat/backprop-endstate.test.ts`) · root-trigger end-state (`migrated → src/lib/chat/backprop-endstate.test.ts`) · approvals/parent-artifact data rows `retained-ui`/`pruned-covered`.                                                                                         |
| `telemetry.spec.ts`           | `live-path`             | Arming after reload, one thin delivery check per stub path.                                                | Per-turn record fields incl. abort + metadata-no-text (`migrated → src/lib/telemetry/telemetry.test.ts`) · span/OTel mapping and ingest (`already-covered → server/src/telemetry.test.ts`, `server/src/telemetry-ingest.test.ts`) · stub delivery, boot re-read arming, title auto-fire, abort-leg `retained-live-path`.                                                                                |

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
