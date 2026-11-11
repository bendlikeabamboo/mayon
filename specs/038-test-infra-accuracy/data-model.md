# Data Model: Test-infrastructure accuracy fixes (038)

No entities, no schema, no migrations. This feature creates no data and
persists nothing; the only "model" is the input shape of the pure selector
(US1), recorded here so its contract has a home.

## Selector inputs (US1)

| Input | Shape | Source |
| --- | --- | --- |
| Project listing | `Array<{ Name: string; ConfigFiles: string }>` — `Name` is the compose project; `ConfigFiles` is a comma-joined list of absolute compose-file paths | `<engine> compose ls --format json` (`tests/e2e/image-round-trip.spec.ts`) |
| Runner base URL | URL string; only the port is load-bearing (5173 default; 5200+N shard) | `E2E_BASE_URL` env set by `scripts/dev-shard.mjs`, default in `playwright.config.ts` |
| Checkout compose files | absolute paths of `docker-compose.dev.yml` (+ `docker-compose.dev.shard.yml` for shards) | derived from the spec's cwd |

Validation rules (from FR-001/FR-002, enforced by the selector):

- Port 5173 ⇒ expected project `mayon-dev`, requiring only the base compose
  file in `ConfigFiles`.
- Port 5201-5299 ⇒ expected project `mayon-dev-shard-N` (N = port − 5200),
  requiring base + shard override files.
- Any other port, missing project, or `ConfigFiles` mismatch ⇒ thrown error
  naming the expectation (never a fallback to a sibling project).

## Everything else

- US2/US3/US4/US7 operate on existing code/test artifacts (source strings,
  toast singleton state, string-array merge, mock call counters) — no new
  shapes.
- US5/US6 are workflow/spec-tree text — no runtime data.
