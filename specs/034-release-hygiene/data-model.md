# Data Model — 034 release-hygiene

No database entities. The feature manipulates document/record structures; their shapes
are the "data model" and are normative for the tasks.

## Release record (`CHANGELOG.md` + manifests)

| Field | Shape | Rules |
|---|---|---|
| `version` (×3 manifests) | `"0.10.0"` | Exactly the tag base; equal in `package.json`, `server/package.json`, `packages/shared/package.json`. CI-enforced (`docker-publish.yml:63-69`). |
| `## [Unreleased]` | header only, no entries | Sits above `## [0.10.0]`; stays empty until the stable tag exists. |
| `## [0.10.0]` header | `## [0.10.0] - 2026-11-10` | One section; `### Added` (027, 028, 029, 030, 031) then `### Fixed` (#69, #70, PR #77). Entry inventory is normative: research.md D9. |

State transitions: `Unreleased(populated) → 0.10.0(open, accumulating) → [tagged] →
Unreleased(next cycle)`. Only the first transition is this feature's work; the tag is
the maintainer's.

## Idea tombstone record (`ideas/history-map.md`)

| Field | Shape | Rules |
|---|---|---|
| sentinel | `**Last used idea number: 013**` | Equals the highest idea directory number; "do not reuse retired numbers". |
| directory table | `# \| slug \| resulting spec \| history entry` | Pre-existing rows 001–008 restored verbatim from `84389bf^`. |
| loose-file retirement table (new) | `file \| status \| disposition` | Two rows: `llm-mocks.md` (delivered → mock-llm fixture, specs 017/020), `security-scan.md` (partially delivered → 019 history, #69; open remainder re-homed to `ideas/dependency-vulnerability-backlog.md`). |

## Langfuse stub fault surface (`tests/fixtures/langfuse-stub/server.mjs`)

| Element | Shape | Rules |
|---|---|---|
| body read | settles on end/error/abort | An aborted body is an ordinary failure (no unsettled promise, no process-level handler). |
| malformed/aborted body at `/api/public/otel/v1/traces` | `400 {"error":"malformed JSON body"}` | Only when the socket is still writable; never write to a dead socket. |
| process handlers | none | No `process.on('uncaughtException'/'unhandledRejection')` in the fixture. Genuine faults crash visibly. |
| `clientError` | per-connection 400 + socket end | Unchanged (`server.mjs:96-99`). |

## Validation fields (verification-only, US6)

| Field | Expected |
|---|---|
| engine resolution in `image-round-trip.spec.ts` | `resolveEngine()`-derived; zero hardcoded `docker` invocations |
| ledger completeness | row count == `tests/e2e/*.spec.ts` count; `backprop-tool.spec.ts` row present |
