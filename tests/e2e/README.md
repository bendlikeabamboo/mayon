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

No spec is currently camera-style (none takes screenshots for visual review).
When a visual check is needed, keep it screenshot-plus-review and occasional —
it confirms appearance and does not double as a behavior test.
