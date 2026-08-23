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
| `pnpm test`          | Vitest suite (pglite Postgres test driver)                                |
| `pnpm test:low-spec` | Vitest with the tracked low-spec profile                                  |
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
- [ ] No secrets, API keys, or credentials are committed
- [ ] Commit messages follow Conventional Commits

## Testing

The test suite runs against a pglite (Postgres-compatible) test driver via Vitest:

```bash
pnpm test          # run once
pnpm test:watch    # watch mode during development
```

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

Tests live alongside source files (`*.test.ts` / `*.test.js` / `*.spec.ts`).

## AI-Assisted Contributors

If you are contributing with the help of an AI coding agent, please read `AGENTS.md` for architecture boundaries, build commands, and acceptance criteria. That file is the authoritative reference for how the codebase is structured and what constitutes a correct implementation.

## Questions?

Open a [GitHub Discussion](https://github.com/bendlikeabamboo/mayon/discussions) for questions that are not bug reports or feature requests.
