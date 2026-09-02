# Implementation Plan: Mock-LLM Chat Test Suite

**Branch**: `017-mock-llm-chat-tests` | **Date**: 2026-09-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/017-mock-llm-chat-tests/spec.md`

## Summary

Add Playwright E2E coverage of the full chat experience — onboarding, send/receive,
rendering — powered by a tests-owned mock LLM service (`mock-llm`) that speaks the
OpenAI chat-completions protocol (SSE streaming + non-streaming + `/models`) and always
returns one deterministic kitchen-sink reply. The service joins the all-containerized
dev/test compose stack (`docker-compose.dev.yml`); a new CI job runs the suite on every
PR with zero secrets and zero external network. **Zero product codebase changes** — all
work lands in the test stack, test fixtures, and CI.

## Technical Context

**Language/Version**: TypeScript (Node 22 per `.nvmrc`, pnpm 10.15.0 per `packageManager`); mock fixture is dependency-free `node:http` (`.mjs`, matching `tests/fixtures/stub-mcp-server.mjs` precedent)

**Primary Dependencies**: `@playwright/test` (new devDependency, test-only); product stack under test unchanged — `ai@^7.0.4` + `@ai-sdk/openai-compatible@^3.0.2` client, `/api/llm/proxy` server forwarder (`server/src/llm-proxy.ts:13-82`)

**Storage**: none added. Mock is stateless; product stores unchanged (Postgres `settings` for provider config, IndexedDB `mayon/providerKeys` for the placeholder key — exercised, not modified)

**Testing**: New Playwright E2E suite (`tests/e2e/`); existing Vitest suites untouched and still gating (`pnpm test`, `pnpm --filter @mayon/server test`)

**Target Platform**: All-containerized dev/test stack (project `mayon-dev`): `web` :5173 (Vite HMR), `server` :4319 (internal), `db` :5432 (internal), new `mock-llm` (internal only); Playwright runs on host/CI runner against `http://localhost:5173`

**Project Type**: web app (SvelteKit SPA + companion server); this feature is test-stack-only

**Performance Goals**: Full suite completes in under 10 minutes in CI; zero intermittent failures across repeated runs on identical code (SC-002)

**Constraints**: empty product `src/`+`server/src/` diff for the core capability (SC-005); no LLM secrets, no external network, no per-run cost (FR-008); openai-compatible dialect only (FR-010); mock reachable from the `server` container, never from the browser directly (FR-003)

**Scale/Scope**: 1 mock service (compose + fixture), 1 kitchen-sink fixture document, 1 Playwright config + e2e directory, 1 new CI job, e2e specs covering: onboarding round trip, rendering coverage (markdown structure, math, diagrams, copy affordance, expound alignment)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status | Notes |
|------|--------|-------|
| I. Layering (repos only, no direct `db`) | ✅ Pass | No product code touched; tests drive the real UI, which already respects layering |
| I. Toolchain pins (Node 22, pnpm 10, no bun/Rust) | ✅ Pass | Playwright runs on Node 22/pnpm 10; mock fixture is plain Node `http` |
| I. No secrets in `settings` | ✅ Pass | Placeholder key goes through the real IndexedDB path; no secret lands anywhere else |
| I. No `+`-prefixed non-route files | ✅ Pass | New files live under `tests/` with no `+` prefix |
| II. Vitest gates still pass | ✅ Pass | Additive change; existing suites untouched. E2E suite is a separate runner (`test:e2e`), not merged into Vitest |
| III. Progressive capability model | ✅ Pass | Suite runs the all-containerized stack where `llm-proxy` is advertised; test asserts the real path rather than bypassing it |
| III. Expound offsets via source map + DOM alignment | ✅ Pass | Alignment tests assert through `src/lib/chat/selection.ts` machinery against a fixture authored to be alignment-safe; injected chrome (`.md-copy-btn`, `.katex`, `code.language-mermaid`, …) stays excluded via `EXCLUDED_CHROME_SELECTORS` (`src/lib/chat/selection.ts:27-36`) |
| IV. SPA bundle growth justified | ✅ Pass | `@playwright/test` is a devDependency — never enters the SPA bundle |
| IV. Perf probe for perf-sensitive changes | ✅ N/A | No perf-sensitive product change; CI wall-time goal tracked as SC-001/SC-002 instead |
| Quality gates (`pnpm check`/`lint`/`test`) | ✅ Pass | New files must satisfy ESLint+Prettier flat config; verified in tasks phase |

**Post-Phase-1 re-check**: No violations introduced. The only new dependency is
dev-only; the only product-adjacent edits are `docker-compose.dev.yml` (new inert
service) and `.github/workflows/ci.yml` (new job) — both outside `src/`/`server/src/`.

## Project Structure

### Documentation (this feature)

```text
specs/017-mock-llm-chat-tests/
├── plan.md              # This file
├── research.md          # Phase 0 output: decisions + verified wire-protocol facts
├── data-model.md        # Phase 1 output: entities of the test stack
├── quickstart.md        # Phase 1 output: bring-up + run + expected outcomes
├── contracts/
│   ├── mock-llm-api.md  # HTTP contract the mock must serve (SSE, JSON, /models)
│   └── e2e-stack.md     # Compose service + CI job + suite configuration contract
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
tests/
├── fixtures/
│   └── mock-llm/
│       ├── server.mjs           # Dependency-free node:http OpenAI-protocol mock
│       └── kitchen-sink.md      # The deterministic reply document (fixture body)
└── e2e/
    ├── fixtures/                # Playwright fixtures: onboarded-provider context
    ├── onboard.spec.ts          # P1: onboard → send → receive → render
    └── render.spec.ts           # P2: kitchen-sink rendering assertions

playwright.config.ts             # Root config; baseURL http://localhost:5173
docker-compose.dev.yml           # + `mock-llm` service (expose-only, healthcheck)
package.json                     # + devDependency @playwright/test, script test:e2e
.github/workflows/ci.yml         # + `e2e` job (sibling of `web`)
```

**Structure Decision**: Test-stack-only layout. The mock lives under
`tests/fixtures/mock-llm/` (tests-owned, per the `stub-mcp-server.mjs` precedent) and is
wired into the existing dev compose stack as an inert sibling service — the browser
never reaches it; only the `server` container does, by service-name DNS on the compose
default network. The E2E suite lives under `tests/e2e/` with a root
`playwright.config.ts`. No product source directories are created or modified.

## Complexity Tracking

> No constitution violations — table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
