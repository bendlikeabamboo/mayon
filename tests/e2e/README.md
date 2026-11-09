# E2E tests

Playwright suite (`pnpm test:e2e`, config in `playwright.config.ts`). It runs
against the dev stack's web app (default `http://127.0.0.1:5173`), with the
deterministic mock LLM from `tests/fixtures/mock-llm/` standing in for a real
provider — see that directory's README for the harness.

Per the [Agent's Map](../../docs/reference/agent-map.qmd), the browser is
for UI-only behavior, not for proving logic that text tests can prove. Each
spec is classified below by role; specs marked **migration candidate** prove
behavior that a logic-layer test (`useFileTestDb()` + seed via `repos` + assert
on text) could prove instead, and are opportunistic migration targets for a
later feature — no mass migration.

| Spec                          | Role                                   | Notes                                                                                                                                                                  |
| ----------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onboard.spec.ts`             | UI-only behavior                       | Onboarding flow, provider settings wiring, streaming-render markers.                                                                                                   |
| `provider-picker.spec.ts`     | UI-only behavior + migration candidate | Picker groups/search/empty state are UI-only; tool-capability trace and connection-coaching classification assert persisted/derived behavior a logic test could prove. |
| `prompt-contract.spec.ts`     | Migration candidate (mostly)           | Instructions persistence is repository behavior; the read-only contract region is UI-only.                                                                             |
| `quiz.spec.ts`                | Migration candidate                    | Generation, grading, and attempt persistence through the real proxy path.                                                                                              |
| `lab.spec.ts`                 | Migration candidate                    | Generation and checklist persistence; the `/lab/[id]` render is the UI part.                                                                                           |
| `mock-classification.spec.ts` | Migration candidate                    | Quiz/lab generation via the real proxy path; request-kind classification itself is probed manually (see comments in the spec).                                         |
| `render.spec.ts`              | UI-only behavior                       | Markdown/math/mermaid rendering, copy affordance, theme re-render; the expound selection→offset check needs the DOM alignment layer.                                   |
| `image-round-trip.spec.ts`    | UI-only behavior                       | Streamed image reply: live marker, pending placeholder, durable thumbnail, reload without provider contact (mock's stdout request log via `docker logs`).              |
| `backprop-tool.spec.ts`       | UI-only behavior                       | Approve/Decline UI, badges, reload-render persistence, breadcrumb; branch-offer flow wiring.                                                                           |
| `telemetry.spec.ts`           | Live-path                              | Stub delivery of telemetry over the real wire (relay → proxy → langfuse stub), boot re-read arming, title auto-fire timing, error-leg semantics.                       |

## Parity ledger — behavior invariants → fast tier

Dispositions for every assertion cluster touched by the text-first split
(feature 031; contract: `specs/031-split-text-e2e-tests/contracts/browser-inventory.md`).
Deleting a browser assertion requires its disposition to be `migrated →` or
`pruned-covered` (or `already-covered →`) first — coverage never dips.

### `backprop-tool.spec.ts`

| Cluster                                                                                                       | Disposition                                                                           |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Offer-turn durable-row counts (+2 rows, ask absence, offer-once, parent untouched)                            | `migrated → src/lib/chat/backprop-endstate.test.ts` (offer-turn describe, 2 cases)    |
| Declined-turn end-state (declined result persisted, `toolsRun` not invoked, never re-asked, parent untouched) | `migrated → src/lib/chat/backprop-endstate.test.ts` (declined-turn describe, 2 cases) |
| Root-trigger end-state (`propagate_unavailable` reply, 0 ask rows, tool set excludes `propagate_to_parent`)   | `migrated → src/lib/chat/backprop-endstate.test.ts` (root-trigger describe, 2 cases)  |
| Approve/Decline UI, badges, reload-render persistence, breadcrumb, live-path steps                            | `retained-ui`                                                                         |

### `provider-picker.spec.ts`

| Cluster                                                                                                        | Disposition                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool-capability toggle persisted-trace counts (Enabled offers tools / Disabled runs tool-less, state persists) | `migrated → src/lib/agent/loop.test.ts` ("capability flip ⇒ next turn's persisted agent trace records 0 tool iterations")                    |
| Discovery dialog → merged catalog in persisted provider record                                                 | `migrated → src/lib/ai/connection-test.test.ts` ("discovery → persisted settings merge")                                                     |
| `/models` parsing, sort/dedupe/embedding filter, empty initial providers setting                               | `already-covered → src/lib/ai/model-discovery.test.ts`, `src/lib/ai/connection-test.test.ts`, `src/lib/db/repositories/repositories.test.ts` |
| Card UI, status text, discovery dialog wiring, Saved-state/reload persistence, live fetch                      | `retained-ui`                                                                                                                                |

### `telemetry.spec.ts`

| Cluster                                                                                                              | Disposition                                                                                |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Per-turn record fields (session/model/usage/outcome, prompt completion, abort outcome, no-error-detail)              | `migrated → src/lib/telemetry/telemetry.test.ts` ("capture + relay pipeline", 3 new cases) |
| Metadata-mode payload carries no conversation text                                                                   | `migrated → src/lib/telemetry/telemetry.test.ts` (metadata-mode case)                      |
| Span-name/`langfuse.session.id` → OTel mapping, ingest                                                               | `already-covered → server/src/telemetry.test.ts`, `server/src/telemetry-ingest.test.ts`    |
| Stub delivery over the real wire, boot re-read arming after reload, title auto-fire on turn one, error-leg semantics | `retained-live-path`                                                                       |

### `image-round-trip.spec.ts`

| Cluster                                                              | Disposition                                                                                                                                                                                   |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reload serves the image from the persisted row (no provider contact) | `migrated → src/lib/stores/chat.svelte.test.ts` ("reload hydration serves the image from the persisted row"); the e2e mock-log zero-request scrape was deleted after the fast home went green |
| `image_reply +1` request-count scrape                                | `retained-live-path` (wire composition: the turn issues exactly one classified completion through the proxy)                                                                                  |
| Live marker, pending placeholder, durable thumbnail render           | `retained-ui`                                                                                                                                                                                 |

No spec is currently camera-style (none takes screenshots for visual review).
When a visual check is needed, keep it screenshot-plus-review and occasional —
it confirms appearance and does not double as a behavior test.
