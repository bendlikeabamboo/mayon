# Contract: E2E stack wiring

How the mock, the compose stack, the suite, and CI fit together. Contract-level facts
only; implementation detail belongs in `tasks.md`.

## Compose service contract (`docker-compose.dev.yml`)

New service `mock-llm` (project `mayon-dev`):

- Image: `node:22-alpine` (matches existing dev images), command runs
  `tests/fixtures/mock-llm/server.mjs` (bind mount `./tests/fixtures/mock-llm:…:ro`)
- Networking: **no `networks:` key** (compose default network, like every existing
  service); reachable as hostname `mock-llm` from `server`; `expose:` only — no host
  port mapping
- Healthcheck: TCP probe on the mock's port (style consistent with `db`'s
  healthcheck); nothing `depends_on` it (it is inert unless a test onboards it)
- Effect on `pnpm dev`: none observable — the service idles unless addressed

## Provider endpoint contract

The suite onboards the provider with:

- Base URL: `http://mock-llm:<port>/v1` (resolvable **inside `server`**, the proxy hop)
- Default model: `mock-sink` (matches the mock's `/models` payload)
- Key: placeholder via the real "Save key" flow → IndexedDB (never `settings`)

## Suite contract (`playwright.config.ts` + `tests/e2e/`)

- Runner: `@playwright/test` (root devDependency), browsers: Chromium (single project;
  multi-browser expansion later is out of scope)
- `baseURL`: `E2E_BASE_URL` env override, default `http://127.0.0.1:5173` (dev `web`
  container; pinned to IPv4 — Node's DNS ordering can resolve `localhost` to `::1`);
  the suite assumes the stack is up (`pnpm dev:up`) and the mock is reachable from
  `server` — it never calls the mock itself
- Local isolation: to run against this checkout without hijacking a `mayon-dev` stack
  mounted from another checkout, use the `mayon-e2e` compose project
  (`docker-compose.e2e.yml` override, web on host 5174) — see `docs/dev/building.qmd`
- Boot discipline: tests wait for BootGate resolution before interacting (fresh
  browser context = zero providers, zero keys)
- Shared test fixture: onboarding (add provider → edit base URL/model → save key →
  set active → create chat) is a reusable Playwright fixture so both spec files start
  from an onboarded state without duplicating UI steps
- Scripts: `pnpm test:e2e`; Vitest config and scripts remain untouched
- Determinism: no retries-as-flake-masking in the committed config (`retries: 0`
  locally; CI MAY set `retries: 1` for infra noise only, and any retry that changes
  the verdict on identical code is treated as a bug per SC-002)

## CI contract (`.github/workflows/ci.yml`)

New job `e2e` (sibling of `web`, `ubuntu-latest`, Docker available):

1. Checkout + pnpm + Node 22 (same setup steps as `web`)
2. `pnpm install --frozen-lockfile` + `pnpm --filter @mayon/shared build`
3. Install Playwright Chromium (`playwright install --with-deps chromium`)
4. Bring up the stack: `pnpm dev:up` (builds dev images if needed) and wait for
   `web` :5173 + `mock-llm` healthy
5. `pnpm test:e2e`
6. Upload Playwright report/traces on failure (artifacts)

Guarantees: no secrets configured; no traffic leaves the runner (only image pulls);
zero per-run LLM cost; existing `web` job remains the merge gate unchanged (`pnpm
check`/`lint`/`test`/build/docker builds) — the `e2e` job is additive.
Validated: CI run 33667386655 on PR #21 — `e2e` pass in 2m52s.

## Out of scope (recorded boundaries)

- Other provider dialects (anthropic/gemini/ollama/github-copilot)
- Multi-browser coverage, visual regression snapshots
- Auth flows (none exist yet); when in-app auth ships (ideas/002 decision), this
  contract gains a login setup step — a follow-up, not a redesign
