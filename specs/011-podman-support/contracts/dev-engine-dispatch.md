# Contract: Dev-Command Engine Dispatch (`scripts/dev-compose.mjs`)

**Feature**: `011-podman-support` | **Date**: 2026-08-23
**Module**: `scripts/dev-compose.mjs` (NEW) + `package.json` dev script bodies. Implements FR-010, FR-014, US4; engine-neutral `docker-compose.dev.yml` and `Dockerfile.dev`/`server/Dockerfile.dev` are untouched.

## Public interface

```bash
node scripts/dev-compose.mjs <compose-args…>   # e.g.: up | up -d | down | build

MAYON_DEV_ENGINE=docker|podman   # env override (optional)
```

Forwarding is verbatim: everything after the script name is passed to `$ENGINE compose` unchanged, so the contract stays stable for any future dev subcommand (`logs`, `pull`, …) without script changes.

## Resolution order (FR-010, SC-006)

1. `MAYON_DEV_ENGINE` exported (values: `docker|podman`; empty/unset ⇒ skip; anything else ⇒ `die` with usage, listing valid values) → source `override`
2. Auto-detect: `command -v docker` (via `node:child_process spawnSync` on `--version`, or equivalent availability probe) succeeds ⇒ docker (source `detected`)
3. `command -v podman` succeeds ⇒ podman (source `detected`)
4. Neither ⇒ exit non-zero with a message naming **both** options and where to get each (mirror installer copy, dev-flavored)

No fallback between engines when the selected one *fails mid-command*: if `$ENGINE compose up` errors, the error is surfaced as-is (a compose failure is not grounds to silently re-target another engine and its volumes).

## Execution

```js
// pseudocode of the whole script
const [engine, source] = resolveEngine();      // order above
console.log(`Using engine: ${engine} (source: ${source})`);
spawn(engine, ['compose', '-p', 'mayon-dev', '-f', 'docker-compose.dev.yml', ...args], { stdio: 'inherit' });
process.exit(code);
```

- The `-p mayon-dev -f docker-compose.dev.yml` prefix is owned by the script (single source of truth; identical to the current npm scripts).
- Exit code of the child is forwarded; script adds no other output beyond the engine line.
- ZERO npm dependencies — `node:child_process` / `node:fs` builtins only (plan Technical Context).

## Statelessness (deliberate)

Nothing is persisted: no config file, no recorded engine, no lock. Re-detection happens on every invocation; the override is per-invocation. Rationale documented in research.md R9: dev has no install-of-record, and engine-scoped volume/cache resets on switch are the accepted documented caveat, not something to gate on interactively.

## Usage surface (docs)

- `CONTRIBUTING.md` dev section: documents `MAYON_DEV_ENGINE`, the detection default (Docker preferred), and the switch caveat ("switching engines resets the dev database volume and image caches — run `dev:build` after switching").
- `AGENTS.md` command table rows for `pnpm dev`, `dev:up`, `dev:down`, `dev:build` gain "(Docker or Podman via `MAYON_DEV_ENGINE`)".

## Invariants

- Docker-default behavior unchanged when Docker present and no override (US4 acceptance 4: identical behavior, only the engine line added to output).
- No reliance on shell aliases (FR-012): resolution probes real binaries via spawn; works identically under `pnpm dev` from any shell (or none).
- No changes to CI, `docker-compose.build.yml`, Dockerfiles, or release packaging (FR-010 fence).
- Project name (`mayon-dev`) and compose-file argument stay hard-coded — exactly one place defines them.
