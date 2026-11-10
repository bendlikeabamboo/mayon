# Contributing to Mayon

Thank you for your interest in contributing! This guide covers the essentials for getting set up and submitting changes.

## Development Setup

### Prerequisites

| Tool            | Version | Notes                                              |
| --------------- | ------- | -------------------------------------------------- |
| Node            | 22      | `.nvmrc` — use `nvm use`                           |
| pnpm            | 10      | `packageManager` field in `package.json`           |
| Docker / Podman | —       | Required to run Postgres + server (Docker default) |

> **Podman contributors:** the dev commands run under Podman too. Set
> `MAYON_DEV_ENGINE=podman` to force it, or rely on auto-detection (with
> neither engine overridden, Docker is preferred when both are installed).
> Dev images, caches, and the dev database volume are engine-scoped — switching
> engines mid-stream resets the dev database and requires `pnpm dev:build`.
> Shell aliases (`docker` → `podman`) are not consulted by the scripts.

### Install

```bash
pnpm install
```

### Development Commands

| Command              | Description                                                               |
| -------------------- | ------------------------------------------------------------------------- |
| `pnpm dev`           | All-Docker dev stack: web HMR (:5173) + server + db (project `mayon-dev`) |
| `pnpm dev:build`     | Rebuild dev images (after deps, config, or `@mayon/shared` changes)       |
| `docker compose up`  | Full stack: web SPA + server + Postgres (web on :8080)                    |
| `pnpm test`          | Tiers 1+2 (Node + Chromium), capability-gated; local merge gate           |
| `pnpm test:unit`     | Tier 1: in-process logic, repositories, and server handlers               |
| `pnpm test:browser`  | Tier 2: real-Chromium component tests                                     |
| `pnpm test:e2e`      | Tier 3: Playwright against a running stack                                |
| `pnpm test:low-spec` | Serial mode for low-spec machines; still runs every test                  |
| `pnpm test:watch`    | Watch mode for Tiers 1+2                                                  |
| `pnpm check:tests`   | Tier guardrails (`TT-001`–`TT-008`)                                       |
| `pnpm check`         | `svelte-check` type-checking                                              |
| `pnpm lint`          | ESLint + Prettier check                                                   |
| `pnpm format`        | Prettier write                                                            |
| `pnpm build`         | Production SPA build into `build/`                                        |
| `pnpm db:generate`   | Generate drizzle migration from schema                                    |

## Code Style

This project uses ESLint (flat config) and Prettier for consistent formatting.

- Run `pnpm lint` before every commit to verify style.
- Run `pnpm format` to auto-fix formatting issues.
- CI will block PRs that fail `pnpm lint` or `pnpm check`.

## Branch and Commit Conventions

### Branches

Create a feature branch from `main`:

```bash
git checkout main
git pull
git checkout -b feat/your-feature-name
```

### Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add Ollama provider template
fix: resolve race condition in database initialization
docs: update CONTRIBUTING with new prerequisites
refactor: extract StorageDriver seam from db module
test: add streaming adapter unit tests
chore: bump drizzle-orm to 0.36
```

## Pull Request Checklist

Before submitting a PR, ensure:

- [ ] `pnpm lint` passes with no errors
- [ ] `pnpm check` passes with no type errors
- [ ] `pnpm test` passes (all tests green)
- [ ] `pnpm build` succeeds
- [ ] If you changed `src/lib/db/schema.ts`: you ran `pnpm db:generate` and committed the results
- [ ] Placement: boundary-placeable logic sits behind the repository seam and is proven by text-first logic tests — see the [placement review checklist](docs/how-to/contributing.qmd#placement-review-checklist)
- [ ] No secrets, API keys, or credentials are committed
- [ ] Commit messages follow Conventional Commits

## Testing

Tests are split into three capability-gated tiers. Place each test at the lowest
tier that can prove its claim:

1. Pure logic, mappers, repositories, or server handlers → **Tier 1**:
   colocated `*.test.ts`, run in Node with `pnpm test:unit`.
2. Rendered markup, clicks/keys/focus, responsive state, or Svelte reactivity →
   **Tier 2**: colocated `*.browser.test.ts`, run in real Chromium with
   `pnpm test:browser`.
3. Real streaming, persistence, multi-page navigation, hydration, or auth/setup →
   **Tier 3**: `tests/e2e/*.spec.ts`, run with `pnpm test:e2e` against a running
   stack.

If two tiers can prove the same claim, keep the lower-tier test and delete the
higher-tier copy. `pnpm test` runs Tiers 1+2 and is the local merge gate;
`pnpm --filter @mayon/server test` runs the server-package Tier 1 suite.

- `*.svelte.test.ts` is a rune-module test and stays Tier 1; Tier 2 uses
  `*.browser.test.ts`.
- Tier 1 must not import browser-mode packages or start a browser or listener.
- Tier 2 supplies `$app/*` and store dependencies at the module boundary and
  mocks `fetch` with MSW (`tests/mocks/handlers.ts`); it must not need the app
  server, Postgres, or docker compose.
- Tier 3 reuses captured session state (`tests/e2e/global-setup.ts`) and has no
  per-test onboarding or fixed waits. Before keeping an end-to-end case, check
  whether Tier 1 or Tier 2 can prove it; remove the duplicate and record the
  replacement in `specs/032-test-suite-tiering/migration-ledger.md`.
- No test or helper file may start with `+` (SvelteKit reserves the prefix).
- `pnpm check:tests` enforces tier placement (`TT-001`–`TT-008`); CI also
  enforces per-tier budgets from `test-budgets.json` via `pnpm check:budget`.

The capability gate parallelizes only at ≥8 logical CPUs and ≥8 GiB usable RAM;
low-spec or unreadable machines run serially. Use `pnpm test:low-spec` on
low-spec machines (it sets `MAYON_TEST_PARALLEL=off` and a 500 MB heap) and
`MAYON_TEST_MAX_WORKERS` to cap a capable machine. The gate changes concurrency,
never test selection.

## Release Candidate Testing

> ⚠️ Backup data before executing.

Replace your production instance with the RC release:

```sh
# Example for 0.2.1-rc1, could be for any rc release
cd ~/.mayon
MAYON_VERSION=0.2.1-rc1 docker compose pull
MAYON_VERSION=0.2.1-rc1 docker compose up -d
```

To roll-back:

```sh
MAYON_VERSION=0.2.0 docker compose pull && MAYON_VERSION=0.2.0 docker compose up -d
```

## AI-Assisted Contributors

If you are contributing with the help of an AI coding agent, please read `AGENTS.md` for architecture boundaries, build commands, and acceptance criteria. That file is the authoritative reference for how the codebase is structured and what constitutes a correct implementation.

## Questions?

Open a [GitHub Discussion](https://github.com/bendlikeabamboo/mayon/discussions) for questions that are not bug reports or feature requests.
