# Phase 0 Research: Test Suite Tiering

**Feature**: `032-test-suite-tiering` | **Date**: 2026-11-10

## R1 — Tier naming and file discovery

**Decision**: Tier 1 remains `*.test.ts`; Tier 2 uses the new suffix `*.browser.test.ts`. Both are colocated with the subject. Tier 3 remains `tests/e2e/*.spec.ts`.

Vitest project globs:

```ts
// unit project
include: ['src/**/*.test.ts', '!src/**/*.browser.test.ts']
// browser project
include: ['src/**/*.browser.test.ts']
```

**Rationale**: `*.svelte.test.ts` already means "test of a `.svelte.ts` rune module" in this repository (`src/lib/stores/chat.svelte.test.ts`, `src/lib/stores/toasts.svelte.test.ts`, `src/lib/auth/state.svelte.test.ts`). Reusing that suffix for rendered components would silently move existing rune-module tests into a browser process and would make the tier of a file ambiguous from its name. A dedicated suffix keeps tier membership machine-checkable and preserves the existing convention.

**Alternatives considered**:

- `*.svelte.test.ts` for components (suggested in the brief) — rejected for the collision above unless all existing rune tests are renamed, which adds churn without value.
- A `tests/component/` directory — rejected: the repository colocates tests, and colocation makes the subject obvious.
- A Vitest `environment` comment per file — rejected: invisible from the filesystem and easy to forget.

## R2 — Real-browser component pipeline

**Decision**: Use Vitest 4 Browser Mode with the Playwright provider:

```ts
import { playwright } from '@vitest/browser-playwright';

browser: {
  enabled: true,
  headless: true,
  provider: playwright(),
  instances: [{ browser: 'chromium' }],
}
```

Components render through `vitest-browser-svelte`'s `render()` and are queried through `screen.getByRole()` / `getByTestId()` with `expect.element(...)` auto-retrying assertions.

**Rationale**: Vitest 4 moved providers into `@vitest/browser-<name>` packages and uses `browser.instances`; the project already depends on Playwright for end-to-end tests, so the browser binary and CI install step are shared. This exercises real focus, layout, pointer, and Svelte reactivity rather than a simulated DOM.

**Alternatives considered**:

- jsdom/happy-dom — rejected as the default for behavioral component tests: no real layout, incomplete pointer/focus/media-query behavior, and it is exactly the "simulated DOM" the brief calls out. Pure DOM-independent helpers stay in Tier 1.
- Playwright end-to-end for component behavior — rejected: it boots the whole app, server, and database for isolated state changes.
- `preview` provider — rejected: simulates events instead of using the browser protocol and is not recommended for CI.

**Version note**: pin `@vitest/browser-playwright` and `vitest-browser-svelte` to versions compatible with the installed Vitest 4.1 line; the browser-mode API is `provider: playwright()` + `instances`, not the older `browser.provider: 'playwright'` string form.

## R3 — Test project layout and commands

**Decision**: One root `vitest.config.ts` with `test.projects: [unit, browser]`. `pnpm test` runs both projects (`vitest run`). Add explicit tier commands (names in `contracts/test-commands.md`).

**Rationale**: A single config keeps the Svelte plugin, aliases, and capacity gate in one place while still letting each tier have its own environment. Running both by default preserves the AGENTS.md contract that `pnpm test` is the merge gate.

**Alternatives considered**:

- Two config files + two root scripts — rejected: duplicated Vite/Svelte setup and drift risk.
- Separate package for browser tests — rejected: adds workspace overhead for no isolation benefit.

## R4 — SvelteKit virtual modules in Tier 2

**Decision**: No library component imports `$app/*` today, so Tier 2 imports components directly. Route-level component tests that need navigation/state get explicit aliases in the browser project (`$app/navigation`, `$app/state`, `$app/environment`) to small test doubles under `tests/mocks/app/`.

**Rationale**: This is the smallest boundary that keeps components testable without booting the app. It is not a network stub, so MSW does not apply. Aliasing at the module boundary is acceptable for framework-injected navigation, and the brief's MSW preference targets HTTP, not SvelteKit virtual modules.

**Alternatives considered**: full SvelteKit plugin in the browser project — rejected because it pulls in routing/SSR assumptions and slows the pipeline; per-test `vi.mock('$app/...')` — rejected because it is repeated boilerplate and easy to forget.

## R5 — MSW boundary for network

**Decision**: Add `msw` as a dev dependency with shared handlers used by `setupServer` in Tier 1 and `setupWorker` in Tier 2. The service-worker asset is served only by the test Vite server (test-only public directory), not copied into the production build.

**Rationale**: One handler set covers both tiers and prevents per-test fetch stubs from drifting. MSW intercepts at the network boundary, so component code keeps its real fetch/transport path.

**Alternatives considered**: `vi.stubGlobal('fetch', ...)` — rejected: bypasses the transport shape and duplicates per file. `msw/native` — not needed for this stack.

**Implementation caveat**: SvelteKit sets `publicDir` to `static/`. The browser project must either override `publicDir` to `tests/mocks/public` or serve `mockServiceWorker.js` through a tiny plugin. The chosen mechanism is recorded in the tier-placement contract and verified by a smoke test; the asset must not land in `build/`.

## R6 — Hardware capability gate

**Decision**: A single `scripts/test-capacity.mjs` module exports `readCapacity()` (I/O) and `resolveCapacity(readings)` (pure). It reads:

- logical CPUs from `os.availableParallelism()` (fallback `os.cpus().length`);
- host memory from `os.totalmem()`;
- Linux cgroup v2 limits (`/sys/fs/cgroup/cpu.max`, `/sys/fs/cgroup/memory.max`, `.high`) and v1 files when present;
- the minimum of host and cgroup signals, since either can be the real constraint.

Thresholds: capable only when logical CPUs ≥ 8 **and** usable RAM ≥ 8 GiB. Below either, or when a reading is unknown, default to one worker and `fileParallelism: false`. Overrides: `MAYON_TEST_PARALLEL=on|off|auto` and `MAYON_TEST_MAX_WORKERS=<n>`; overrides are printed with the resolved reason.

**Rationale**: Matches the AGENTS.md low-spec boundary and the spec clarification. Containerized dev stacks frequently expose host CPU counts with a smaller memory cap, so using only `os.cpus()` would oversubscribe and thrash.

**Alternatives considered**: a static low-spec env file only — rejected because developers forget to set it; always serial — rejected because it wastes capable CI runners; always parallel — rejected by the user requirement.

**Per-runner policy**: Vitest sets `maxWorkers`/`fileParallelism`; Playwright sets `workers` and `fullyParallel`; shard scripts refuse to start more shards than the machine can sustain and pass the same capability decision to each shard process.

## R7 — Tier budgets and reporting

**Decision**: CI uses two owners. `pnpm test:ci` executes Tier 1, Tier 2, and the server suite with JSON reporters, writes `test-results/tier-durations.json` (tier3 deferred), and runs `scripts/check-test-budget.mjs --tiers=tier1,tier2,server`. `pnpm test:e2e:ci --shard=<n>/<total>` runs the e2e shard, writes `test-results/tier3-shard-<n>.json`, and checks that shard's 120 s budget. Local `pnpm test` does not enforce budgets.

**Rationale**: Budgets must be visible and blocking in CI, but failing a developer's fast iteration on a loaded laptop is hostile. The wrapper keeps the enforcement policy separate from the runner configuration.

**Alternatives considered**: custom Vitest reporter — rejected as more surface area than needed; CI timing from job duration — rejected because it conflates install, build, and test steps.

## R8 — End-to-end session state and seeding

**Decision**: Playwright gets a `setup` project that runs once per run and writes `test-results/.auth/state.json`. The `chromium` project depends on it and sets `storageState`. Setup also seeds the shared mock provider and dismisses the first-run security gate. Provider-mutating specs use a worker-indexed provider id (`e2e-provider-${workerIndex}`). Chats are created per test through the cheapest available seam (direct `/api/db/query` when the schema allows, otherwise the New chat action), never through the first-run gate.

**Rationale**: `localStorage` carries `mayon_setup_dismissed` and cookies carry the auth session, so `storageState` covers both. The setup journey is the expensive part (wait for boot, skip setup, start chatting); moving it out of `beforeEach` removes it from every test. Worker-indexed provider ids preserve parallelism without a database per worker.

**Alternatives considered**:

- Per-worker Postgres databases — rejected for now: the dev stack has one database, and provisioning/migrating a database per worker costs more than the isolation it buys.
- No setup project, seed only via API — rejected: the client boot gate still needs a one-time dismissal and auth state.
- Serializing the whole suite to keep global settings stable — rejected by the parallelism requirement.

**Serial exceptions**: specs that intentionally clear all provider settings (for example the provider picker's "empty state") run in a `serial` project or use worker-scoped cleanup, because they mutate global settings by design. This is documented next to the test, per FR-015.

## R9 — Network blocking and third-party traffic

**Decision**: A shared auto-fixture aborts requests to untrusted external hosts and static asset types not served by the app/mock server. Fonts bundled by the app remain allowed. Mock-LLM and API traffic must never be blocked.

**Rationale**: The app is local-first and serves its own assets; external fonts/analytics are not part of any critical path. Blocking them makes tests deterministic and removes real-network flake without masking app behavior.

**Alternatives considered**: `page.route('**/*.{png,jpg,...,woff2}')` — rejected as too broad because it would also abort app-served images and fonts under test. The fixture allowlists the app origin and the mock server origin, and aborts everything else classified as a third-party asset.

## R10 — Telemetry spec and shard port ownership

**Decision**: Retire the external langfuse-stub end-to-end assertions. Keep protocol/ingest coverage at Tier 1 (`server/src/telemetry-ingest.test.ts` already covers ingest) and add a Tier 2 test that asserts the client emits the expected payload through an MSW-intercepted fetch. Remove the 9998 port ownership logic from `scripts/dev-shard.mjs`.

**Rationale**: The external receiver is the only reason shards need to coordinate a host port. Moving the assertion to the network boundary removes cross-shard state, a 120-second per-test timeout, and a fixed sleep, and still proves the client-to-payload contract.

**Alternatives considered**: keep the stub but give each shard its own port — possible but retains a real external process and container for a contract that is already unit-testable. Only use this fallback if the MSW emission test cannot reproduce the payload path.

## R11 — Source-text component tests

**Decision**: Classify all 32 files into three dispositions and record each in the migration ledger:

1. **Convert to Tier 2** when the source text stands in for behavior a user can observe (drawer open/close, spinner visibility, collapse state, keyboard handling, responsive structure, copy affordance, empty state).
2. **Delete as redundant** when the assertion duplicates a compile-time fact or another test with no behavioral claim (for example pure class-presence checks that add no user-visible guarantee).
3. **Promote to a static invariant check** when the guarantee is genuinely static and machine-checkable (dependency direction, reserved `+` prefix, no forbidden APIs/constructs, required `onMount` instrumentation).

Each ledger row records: current file, subject, claimed behavior, disposition, replacement path, and rationale. No file is removed without a ledger row.

**Rationale**: The current files report component coverage without rendering; simply keeping them as "contract tests" would preserve a false signal. The three-way split prevents both blind deletion and unnecessary browser cost.

**Alternatives considered**: convert every file to a browser test — rejected: some assertions are not behavior and would produce brittle tests; delete every file — rejected: some guard real invariants worth keeping.

## R12 — Server-handler test harness

**Decision**: Standardize a `server/src/testing/build-app.ts` helper that constructs the Fastify app with injected dependencies and returns it for `app.inject(...)`. Convert `app.listen(...)` + real-socket tests to `inject` unless the socket/transport is the subject (the LLM proxy upstream-server test keeps a real listener). Move the live-provider integration file to an `*.integration.test.ts` suffix excluded from the default include and behind `pnpm test:integration`.

**Rationale**: The server package mostly uses `inject` already; a helper removes per-file app wiring and makes the boundary explicit. Keeping real listeners only for transport tests matches FR-003. The integration file is currently globbed into the default suite even when inert, which is a selection bug.

**Alternatives considered**: supertest against `listen` — rejected: slower and redundant with Fastify's built-in inject.

## R13 — Guardrails

**Decision**: `scripts/check-test-tiers.mjs` enforces, with stable IDs:

- `TT-001` no browser imports or browser project includes in Tier 1;
- `TT-002` no `waitForTimeout` or sleep-based `setTimeout` in Tier 3;
- `TT-003` no `fs.readFileSync` source assertions in `*.browser.test.ts` and no source-text assertions classified as component tests;
- `TT-004` no first-run setup journey in a Tier 3 spec outside the setup project;
- `TT-005` every Tier 3 spec imports a shared session fixture and has no hard-coded credentials;
- `TT-006` parallelism must be capability-gated in both runner configs.

A small allowlist file with mandatory justifications handles deliberate exceptions, mirroring `scripts/check-dependency-direction.mjs`.

**Rationale**: A one-off cleanup will regress without a gate. Stable IDs make failures legible in CI and let the escape-hatch policy be reviewed.

**Alternatives considered**: ESLint-only — rejected because project membership and runner config are not lintable as ordinary code; a custom Vitest reporter — rejected as excessive.

## R14 — Docs and contributor guidance

**Decision**: Update AGENTS.md's commands table and testing section, the architecture/seams docs where they mention test execution, and the contribution guide with the tier table, suffixes, gate behavior, and migration policy.

**Rationale**: FR-022 and the constitution's workflow section require guidance to match the enforced commands. Without it, new tests will land in the wrong tier.

**Alternatives considered**: a standalone `docs/testing.qmd` only — rejected: contributors read AGENTS.md first; both are updated, with AGENTS.md linking to the detailed guide.
