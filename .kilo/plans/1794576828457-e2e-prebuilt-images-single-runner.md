# E2E: prebuilt dev images + single-runner parallel suite

## Goal

Cut e2e wall time and runner cost by:

1. Building the two dev images **once per commit** and sharing them via GHCR.
2. Removing the shared-provider race in `provider-picker-coaching.spec.ts`.
3. Running the whole e2e suite on **one runner, one dev stack**, with Playwright workers in parallel.

Fork PRs are explicitly out of scope for e2e (user decision): the `web` job still runs for forks, but `build-e2e-images` and `e2e` are skipped.

## Baseline (run 43412593691, shard 1/4)

| Step | Time |
| --- | --- |
| Build dev web image | 121.1s |
| Build dev server image | 124.5s |
| Boot one shard stack (`dev:shard:up`) | 23.9s |
| Run that shard's tests | 33.4s |
| Stack down | 10.5s |

Four shards rebuild the same two images in parallel. Total test time across all four shards is ~99s; one stack with four workers should stay under the existing 120s tier3 budget.

## Decisions

- **Registry:** GHCR, tags `sha-<github.sha>`, same-repo PRs + `main` + tags only.
- **Build:** a matrix job with one leg per image (`mayon-dev-web`, `mayon-dev-server`), so the two builds run in parallel.
- **Run:** one `ubuntu-latest` runner, one stack via `pnpm dev:shard:up 1/1` (project `mayon-dev-shard-1`, web `:5201`), `E2E_BASE_URL=http://127.0.0.1:5201`.
- **Parallelism:** `fullyParallel` remains capacity-driven; add an explicit `MAYON_E2E_WORKERS` override and start CI at 4 workers.
- **Provider isolation:** the provider-picker file gets its own provider; the shared seeded provider is read-only.
- **Budget:** keep `tier3: 120`; measure the one-stack run and only adjust with a recorded rationale.

## Tasks

### 1. Pin dev base images and stabilize the Docker cache

- In `Dockerfile.dev:5` and `server/Dockerfile.dev:5`, pin the Node base by digest: `FROM node:22.23.4-alpine@sha256:<digest>`.
- Resolve the digest from the current base with
  `docker buildx imagetools inspect node:22.23.4-alpine`
  and add a short comment that the digest must move with the Node pin.
- Verify the second image build reports `CACHED` for the `apk add` / `pnpm install` layers. The 73s `pnpm install` step in the baseline is a cache miss; if it persists after pinning, stop and fix the cache before proceeding (fallbacks: BuildKit cache mounts for apk/pnpm, or a shared deps base image).

### 2. Add the shared dev-image build job

In `.github/workflows/ci.yml`:

- Add `build-e2e-images` before `e2e` with:
  - `strategy.matrix.include` for `{ image: mayon-dev-web, dockerfile: Dockerfile.dev, scope: e2e-dev-web }` and `{ image: mayon-dev-server, dockerfile: server/Dockerfile.dev, scope: e2e-dev-server }`.
  - `if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository`.
  - `permissions: { contents: read, packages: write }`.
  - `docker/setup-buildx-action@v3`.
  - `docker/login-action@v3` with `registry: ghcr.io`, `username: ${{ github.actor }}`, `password: ${{ secrets.GITHUB_TOKEN }}`.
  - `docker buildx build --push --cache-from type=gha,scope=<scope> --cache-to type=gha,mode=max,scope=<scope> -t ghcr.io/${{ github.repository_owner }}/<image>:sha-${{ github.sha }} -f <dockerfile> .`
- Do not run `pnpm install` in this job; the Dockerfiles install inside the image.
- Use per-image cache scopes so a web cache miss does not invalidate the server index and vice versa.

### 3. Convert e2e to one runner, one stack

In `.github/workflows/ci.yml` replace the `e2e` matrix job:

- Add `needs: build-e2e-images` and the same fork `if` condition.
- `permissions: { contents: read, packages: read }`.
- Keep checkout, pnpm setup, Node setup, `pnpm install --frozen-lockfile`, `pnpm --filter @mayon/shared build`, and `pnpm exec playwright install --with-deps chromium`.
- Remove `docker/setup-buildx-action` and both `Pre-build shard ...` steps.
- Add `docker/login-action@v3` and pull/retag:
  - `docker pull ghcr.io/${{ github.repository_owner }}/mayon-dev-web:sha-${{ github.sha }}`
  - `docker tag ... mayon-dev-shard-1-web`
  - the same for `mayon-dev-server` → `mayon-dev-shard-1-server`
  - keep the image path lowercase (Docker rejects uppercase repository names).
- Run `pnpm dev:shard:up 1/1`.
- Before the suite, remove stale shard reports (`rm -f test-results/tier3-shard-*.json`) so `check-test-budget` cannot read an old shard 2–4 report.
- Run the suite with:
  - `E2E_BASE_URL: http://127.0.0.1:5201`
  - `MAYON_E2E_WORKERS: 4`
  - `pnpm test:e2e:ci --shard=1/1`
- Always run `pnpm dev:shard:down 1`.
- Upload the report as `tier3-shard-1` and Playwright failure artifacts as `playwright-artifacts` (drop the `-shard-<n>` suffix).
- Update the stale comment claiming four runners are safe because specs are independent; the new invariant is one stack with provider isolation.

### 4. Add the Playwright worker override

In `playwright.config.ts`:

- Read `MAYON_E2E_WORKERS` as an optional positive integer.
- Use it for `workers` when set; otherwise keep `capacity.workers ?? undefined`.
- Keep `fullyParallel: capacity.fullyParallel`.
- Document the variable in `AGENTS.md` and `docs/how-to/building.qmd`.

### 5. Add a stable provider-card test hook

In `src/lib/components/ai/ProviderConfig.svelte:547`, add `data-provider-id={p.id}` to the provider `<li>`.

This lets tests target a specific provider card without relying on `#providers li` order.

### 6. Isolate `provider-picker-coaching.spec.ts`

Current problem: `tests/e2e/provider-picker-coaching.spec.ts:42-65` mutates the single seeded provider in `settings.providers` (`toolCapability: 'auto'`, `baseUrl: localhost`), and every other spec uses that provider. It is only safe today because each shard has its own database.

Changes:

- Add `test.describe.configure({ mode: 'serial' })` at the top of the file so its provider additions cannot race each other on the shared stack.
- Rewrite the “tool capability toggle” test to use the `session` fixture (not `onboarded`) and add its **own** provider row via `/api/db/query`:
  - unique `id`/`name` per worker, e.g. `e2e-toolcap-${workerIndex}`;
  - `kind: 'openai-compatible'`, `baseUrl: MOCK_BASE_URL`, `defaultModel: MODEL_ID`, `models: [MODEL_ID, ...]`, `discoverable: false`, `toolCapability: 'on'`;
  - do not change `activeProvider`;
  - merge idempotently into the existing `providers` JSON as `{ ...providers, [id]: config }` (never delete/reorder), so the seeded provider stays first and repeated local runs do not collide.
- Navigate to `/settings#providers` and target `#providers li[data-provider-id="<id>"]`.
- Flip the select, assert saved and reload persistence, then update **that** provider’s row by id to `toolCapability: 'auto'` and `baseUrl: 'http://localhost:9999/v1'` for the legacy normalization assertion.
- Keep the connection-coaching `addLocalProvider`/`last()` flow; serial mode makes it deterministic.
- Confirm no remaining test references `SHARED_PROVIDER_ID` for mutation or `#providers li.first()` for a mutable card.

### 7. Fix the serial-project dependency

In `playwright.config.ts:40-49`, add `dependencies: ['setup', 'chromium']` to the `serial` project. Today it only depends on `setup`, so a `*.serial.spec.ts` would still run concurrently with the chromium project. There are no serial specs right now, but the mechanism is meant for global mutations and should be correct.

### 8. Update docs and budget metadata

- `AGENTS.md`: update the e2e command description and tier table to describe one stack with parallel workers; document `MAYON_E2E_WORKERS`; note that local sharding via `dev:shard` still works.
- `docs/how-to/building.qmd:163-178`: replace “CI runs four shards” with the new one-stack model; keep the local sharding instructions.
- `test-budgets.json`: update the unused `tier3Scope`/`totalTier3WorkSeconds` fields to match a single run (e.g. `"single-run"` / `120`), or remove them.
- `CHANGELOG.md` under `[Unreleased]`: describe the prebuilt-image and single-runner e2e change.

## Validation

Local:

```bash
pnpm install
pnpm --filter @mayon/shared build
pnpm exec playwright install --with-deps chromium
pnpm dev:shard:up 1/1
E2E_BASE_URL=http://127.0.0.1:5201 MAYON_E2E_WORKERS=4 pnpm test:e2e:ci --shard=1/1
pnpm dev:shard:down 1
```

- Run the suite twice; both runs must pass and stay under the 120s tier3 budget.
- Verify the provider-picker test leaves the seeded provider untouched (other tests still get the mock provider).
- Run `pnpm check:tests`, `pnpm check:budget --tiers=tier3` (for the e2e report; run `pnpm test:ci` first if checking tiers 1/2/server), `pnpm lint`, and `pnpm check`.

CI:

- Same-repo PR: `build-e2e-images` pushes both SHA-tagged images; `e2e` pulls, boots one stack, runs all tests, uploads `tier3-shard-1`, and passes the budget.
- Second run with a warm cache: confirm the dependency layers are `CACHED` and record the build and e2e durations.
- Fork PR: `build-e2e-images` and `e2e` are skipped; the `web` job still runs.
- `main` push: images are pushed and e2e runs.

## Success criteria

- All 12 e2e tests pass on one stack with `MAYON_E2E_WORKERS=4`, twice in a row locally.
- `tier3-shard-1.json` is under the 120s budget on CI.
- After a warm image cache, the e2e job (pull + boot + tests + down) is roughly ≤2.5 minutes, and total CI is not worse than the ~6.3-minute baseline.
- The seeded provider is unchanged after `provider-picker-coaching`; other specs still use the mock provider.
- Same-repo PRs, `main`, and tags run e2e; fork PRs skip only the image-build and e2e jobs.

## Risks / rollback

- **GHCR permissions/visibility:** if pulls fail, check job-level `packages: read`, package visibility, and the `docker login` step. Revert to the old per-shard build path if the registry path blocks merging.
- **Cache still misses:** the baseline 73s `pnpm install` is a layer-cache miss. Pin the base digest first; if it persists, add BuildKit cache mounts or a shared deps base image before relying on the prebuilt-image job.
- **Shared-stack races:** any test that mutates global provider settings will now flake. The provider-picker isolation and the two consecutive local runs are the guard; treat a flake here as a blocker, not a retry.
- **Shared mock-llm log:** `image-round-trip.spec.ts` counts only `image_reply` entries in the one stack's mock log. Do not add another image-reply test without per-worker isolation or a per-test mock; otherwise that assertion becomes order-dependent.
- **Budget:** one stack with four workers may be slower than the sum of independent shards due to shared server/DB contention. If the measured run is over 120s, reduce/increase workers or adjust the reference budget with the measurement recorded.
- **GHCR growth:** one image pair per SHA. Add a retention/cleanup policy in a follow-up; do not leave unbounded package versions.
- **Fork coverage:** fork PRs no longer get e2e. This is the chosen trade-off; keep the `web` job as the fork merge gate.

## Out of scope

- Moving e2e cases down to Tier 1/Tier 2.
- Merge-queue or nightly-only e2e scheduling.
- E2E coverage for fork PRs.
- A shared dev-dependency base image (only if the pinned-digest cache still misses).
- Multi-stack single-agent execution (safe today but needs a much larger runner and per-shard auth/output paths).
