# Contract: Test Guardrails

**Feature**: `032-test-suite-tiering` | **Status**: Draft

`scripts/check-test-tiers.mjs` implements the rules below. Each failure names the rule ID and the offending file. The script runs in CI as part of `pnpm test:ci` and locally via `pnpm check:tests`.

## Rules

| ID | Rule | Scope | Failure message |
|---|---|---|---|
| `TT-001` | Tier 1 must not import browser-mode packages or real-browser helpers | `src/**/*.test.ts`, excluding `*.browser.test.ts`; `server/src/**/*.test.ts` | `TT-001: <file> imports a browser-only package; move it to *.browser.test.ts` |
| `TT-002` | Tier 3 must not use fixed-duration waits | `tests/e2e/**/*.spec.ts` | `TT-002: <file>:<line> uses a fixed wait; assert a condition instead` |
| `TT-003` | Component tests must render; source-text assertions cannot claim component behavior | `src/**/*.browser.test.ts`, `src/**/*.test.ts` claiming `render`/`mount`/`anatomy` behavior | `TT-003: <file> asserts component source text; render the component or use a static invariant check` |
| `TT-004` | Tier 3 must not perform the first-run setup journey outside the setup project | `tests/e2e/**/*.spec.ts` and fixtures | `TT-004: <file> replays setup; use the shared session state fixture` |
| `TT-005` | Tier 3 specs must use the shared session fixture and contain no hard-coded credentials | `tests/e2e/**/*.spec.ts` | `TT-005: <file> does not use the shared E2E fixture` |
| `TT-006` | Runner configs must routes parallelism through the capability gate | `vitest.config.ts`, `playwright.config.ts`, `scripts/dev-shard.mjs` | `TT-006: <file> sets concurrency without the capability gate` |
| `TT-007` | Tier 2 must not require the application server, primary database, or docker compose | `src/**/*.browser.test.ts` | `TT-007: <file> depends on the full stack; move it to tests/e2e` |
| `TT-008` | `*.integration.test.ts` must be excluded from the default Tier 1 include | `vitest.config.ts`, integration files | `TT-008: <file> is selected by the default suite; exclude it or rename it` |

## Exemptions

Exemptions live in `scripts/test-tier-exemptions.json`:

```json
[
  {
    "file": "tests/e2e/telemetry.spec.ts",
    "rule": "TT-002",
    "justification": "Temporary: waiting for the external receiver to acknowledge; remove when R10 lands."
  }
]
```

Rules:

- An exemption without a non-empty `justification` is itself a `TT-000` violation.
- An exemption must name a file and a rule ID.
- Exemptions are removed when the underlying issue is fixed; they are not a permanent allowlist.
- New anti-patterns get a new ID; existing IDs and their meaning are never rewritten.

## Static invariants promoted from source-text tests

The following existing source-text checks move to dedicated, named checks rather than browser tests:

| Invariant | Destination |
|---|---|
| Dependency direction (`db` façade only) | existing `scripts/check-dependency-direction.mjs` + ESLint |
| Reserved `+` filename prefix | `check-test-tiers.mjs` naming rule |
| No `surroundContents` / substring-offset heuristics | existing markdown/selection tests or a named ESLint rule |
| No writes to `search_vec` | existing repository/schema tests |
| Required `onMount` render instrumentation | named check in `check-test-tiers.mjs` only if it guards a real perf contract; otherwise delete as redundant |

## Failure behavior

- Exits `2` on any violation.
- Prints one line per violation, sorted by file then rule ID.
- Prints the count of scanned files and rules.
- Never auto-fixes.
- Runs in under 10 seconds on the repository.
