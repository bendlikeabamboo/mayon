# Contract: Tier Placement

**Feature**: `032-test-suite-tiering` | **Status**: Draft

## Tier definitions

| Tier | Environment | File pattern | Command | Builds app | Browser | Server + DB |
|---|---|---|---|---|---|---|
| 1 — logic/handler | Node (in-process) | `**/*.test.ts`, excluding `**/*.browser.test.ts` | `pnpm test:unit` | No | No | No (transport-subject tests excepted) |
| 2 — component | Chromium via Vitest browser | `**/*.browser.test.ts` | `pnpm test:browser` | No | Yes | No |
| 3 — integration | Full stack via Playwright | `tests/e2e/**/*.spec.ts` | `pnpm test:e2e` | Yes | Yes | Yes |

Server-package tests (`server/src/**/*.test.ts`) belong to Tier 1 behaviorally but keep their own package command as required by the constitution.

## Placement rules

A test belongs to the lowest tier that can prove its claim:

1. Pure function, mapper, reducer, repository, or server handler → **Tier 1**.
2. Rendered markup, user click/keyboard/pointer interaction, focus, responsive state, or Svelte reactivity → **Tier 2**.
3. Real streaming, real persistence, multi-page navigation, hydration, auth/setup handshake, or provider transport → **Tier 3**.

If a claim can be proven at two tiers, it goes to the lower tier and the higher-tier copy is removed.

## Allowed imports by tier

| Tier | Allowed | Forbidden |
|---|---|---|
| 1 | Production modules, `node:*`, pglite, MSW `setupServer`, framework `inject` helpers | `@vitest/browser*`, `vitest-browser-svelte`, real sockets (except transport subjects) |
| 2 | Production components/modules, `vitest/browser`, `vitest-browser-svelte`, MSW `setupWorker`, `$app/*` test doubles | Application server, Postgres, docker compose, Playwright `page.goto` against the dev stack |
| 3 | Production app via a real browser, server, and DB, shared fixtures | Source-text assertions, fixed waits, per-test onboarding |

## Naming rules

- Tier 2 files MUST end in `.browser.test.ts`.
- `.svelte.test.ts` continues to mean a test of a `.svelte.ts` rune module and stays Tier 1.
- No test or helper file may start with `+` (SvelteKit reserves the prefix).
- Tier 3 fixtures live under `tests/e2e/fixtures/`; shared mocks live under `tests/mocks/`.

## Migration dispositions

Every existing source-text component/route test gets exactly one disposition:

| Disposition | When | Required artifact |
|---|---|---|
| `convert` | Text stands in for observable behavior | New `*.browser.test.ts` that renders the subject |
| `promote-static` | Guarantee is genuinely static and machine-checkable | Named check under `scripts/` or an ESLint rule |
| `delete` | Assertion duplicates a compile-time fact or another behavioral test | Ledger rationale naming the replacement coverage |
| `retain` | Legitimately static and already correctly named as an invariant | Ledger row explaining why it is not a component test |

A file may not be deleted without a ledger row. A file may not be relabeled as a "contract test" to avoid rendering when it claims behavior.

## Example placement

```text
src/lib/chat/tree.test.ts                         Tier 1
src/lib/chat/tree.browser.test.ts                 Tier 2 (if interaction is the claim)
server/src/auth-gate.test.ts                      Tier 1 (Fastify inject)
tests/e2e/provider-picker.spec.ts                 Tier 3 (multi-step flow)
src/lib/components/chat/Breadcrumb.browser.test.ts Tier 2 (replaces Breadcrumb.render.test.ts)
```

## Enforcement

`scripts/check-test-tiers.mjs` (see `guardrails.md`) verifies the glob/import/naming rules. CI runs it as part of `pnpm test:ci`.
