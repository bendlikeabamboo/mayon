# Fix: server Docker build cannot resolve `@mayon/schema`

## Problem

`docker compose build server` fails at `RUN pnpm --filter @mayon/server build`:

```
✘ [ERROR] Could not resolve "@mayon/schema"
    src/pg.ts:6:24
```

## Root cause

- `server/src/pg.ts:6` does `import * as schema from '@mayon/schema'`.
- `@mayon/schema` is **not** a package dependency. It is a **path alias** wired only in:
  - `server/tsconfig.json:14` → `"@mayon/schema": ["../src/lib/db/schema.ts"]`
  - `server/vitest.config.ts:7` → resolve alias → `../src/lib/db/schema.ts`
- That target is the **SPA's** schema file `src/lib/db/schema.ts` (repo root), which lives **outside** the `server/` workspace dir.
- tsup reads `server/tsconfig.json` `paths`, so the alias resolves and the **local** build passes (verified: `dist/server.js` builds cleanly).
- `server/Dockerfile` only `COPY`s `packages/shared` and `server` — it **never copies** `src/lib/db/schema.ts`. In the image the alias resolves to `/app/src/lib/db/schema.ts`, which does not exist → esbuild error.

## Confirmed facts (no surprises downstream)

- `src/lib/db/schema.ts` is **self-contained**: only imports `drizzle-orm` / `drizzle-orm/pg-core` (real deps in `node_modules`). No local imports → nothing else needs copying.
- tsup **bundles** the schema into `dist/server.js`, so the runtime image (which copies only `dist`) is unaffected — no schema source needed at runtime.
- No other server source file imports out of `server/` or `packages/shared` except this alias and the real `@mayon/shared` dep (copied) → no second failure after this fix.
- `.dockerignore` does **not** exclude `src/`, so the file is present in the build context.
- The **web** Dockerfile (root `Dockerfile`) is unaffected (it does `COPY . .`).

## Chosen approach

Minimal fix: copy the schema file into the server image before the build step (mirrors how local dev already resolves the alias). Accepted trade-off documented under Risks.

## Tasks

### T1 — Copy schema source into the server build image

File: `server/Dockerfile`

Add one line immediately **before** the existing build step (current line 14), keeping the source copies grouped:

```dockerfile
COPY packages/shared packages/shared
COPY src/lib/db/schema.ts src/lib/db/schema.ts
COPY server server
RUN pnpm --filter @mayon/server build
```

- `COPY` source path `src/lib/db/schema.ts` is relative to the build context root (`.` per `docker-compose.yml`).
- Dest path `src/lib/db/schema.ts` is relative to `WORKDIR /app` → resolves to `/app/src/lib/db/schema.ts`, exactly matching the tsconfig alias target `../src/lib/db/schema.ts` (from `/app/server/`).
- Copy the **single file**, not the directory (avoids pulling browser-only `src/lib/db/*` code).

No changes to: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, root `Dockerfile`, `docker-compose.yml`.

## Validation

1. `pnpm --filter @mayon/server build` (root) — still green (sanity; already passes locally).
2. `docker compose build server` — succeeds (was failing).
3. `docker compose build` — both `web` and `server` build; `web` unchanged.
4. `docker compose up` then check server logs for `pg: ready` and `pg: migrations applied`; `GET /api/health` returns `caps` including `'pg'` (per AGENTS.md P-pg-2 manual gate).
5. (Optional regression) `pnpm lint && pnpm check && pnpm --filter @mayon/server test` — green (no source/logic change expected).

## Risks / notes

- **Fragility (accepted):** the cross-tree path alias is the underlying smell. If `src/lib/db/schema.ts` ever gains a local import (e.g. `./ids`), the Docker build breaks again until that file is also copied. The durable fix is to promote `@mayon/schema` to a real `packages/schema` workspace package (rejected this round for scope). Add a comment in the Dockerfile noting the dependency on this single file.
- Runtime behavior unchanged; migrations still load from the separately-copied `./drizzle` folder (`server/Dockerfile:25`).
