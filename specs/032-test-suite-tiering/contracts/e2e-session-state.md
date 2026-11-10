# Contract: End-to-End Session State

**Feature**: `032-test-suite-tiering` | **Status**: Draft

## Setup project

`playwright.config.ts` defines two projects:

```ts
projects: [
  {
    name: 'setup',
    testMatch: /global-setup\.ts/,
    teardown: 'teardown'
  },
  {
    name: 'chromium',
    use: { browserName: 'chromium', storageState: 'test-results/.auth/state.json' },
    dependencies: ['setup']
  }
]
```

The setup project runs once per Playwright invocation. It:

1. Clears only the settings rows it owns (`providers`, `activeProvider`) through `/api/db/query`.
2. Seeds the mock provider and active-provider settings through the same API seam used today.
3. Navigates to `/chat`, waits for the boot gate or app shell, dismisses the first-run setup (`Skip`) if offered, and records the dismissal.
4. Saves cookies and `localStorage` to `test-results/.auth/state.json`.
5. Fails loudly if the server is unreachable or the seed is rejected.

The artifact is generated, not committed, and is never reviewed as source.

## Fixture contract

A shared fixture (not `beforeEach` inline code) exposes:

```ts
type E2EContext = {
  page: Page;
  workerIndex: number;
  providerId: string;   // `e2e-provider-${workerIndex}`
  chatId: string;       // seeded or created once per test
};
```

Rules:

- The fixture must not perform the full first-run journey.
- Provider ids and any mutated settings are worker-scoped.
- Chats are created through the cheapest seam available: direct `/api/db/query` insert when the rows are sufficient, otherwise the New chat action. The first-run gate is never part of per-test setup.
- No test may depend on a chat created by another spec.

## Parallelism

- `fullyParallel: true` and `workers` derive from the capacity gate.
- Spec files must be independent: no ordering, no cross-spec shared mutable state, no fixed ports.
- Specs that intentionally clear all provider settings run in a dedicated `serial` project (`fullyParallel: false`, `workers: 1`) or use worker-scoped cleanup. The reason is a comment next to the test.
- The telemetry spec must no longer require the host-side langfuse stub; its protocol coverage moves to Tier 1/2 (see research R10).

## Network policy

A shared auto-fixture:

- allows the app origin, the mock LLM origin, and the in-process test origin;
- aborts third-party fonts, analytics, and external CDN/asset requests;
- lets MSW handlers answer API routes before any blanket abort;
- fails on a request to a non-allowed origin that is neither allowed nor classified.

`page.route` must not be used to mock first-party API behavior that MSW owns.

## Wait hygiene

- `page.waitForTimeout`, `setTimeout`-based sleeps, and `test.setTimeout` used as a substitute for readiness are forbidden.
- Readiness is asserted with web-first expectations (`await expect(locator).toBeVisible()`), `expect.poll`, or request waits tied to a condition.
- Long-running flows may use an explicit, justified per-test timeout only when the operation is genuinely long (for example a real streaming completion), never to paper over a race.

## Auth states

| Server state | Expected behavior |
|---|---|
| Open, setup offered | Setup project dismisses once; state reused |
| Open, setup already closed | Setup project proceeds without the gate |
| Locked (auth required) | Setup project performs the login handshake once and stores cookies |
| Session expired mid-run | One recapture, then fail with the state file and trace attached |

## Failure handling

- Missing/stale state file: the setup project recaptures once.
- Seed rejection: fail before any test runs.
- Network abort; never fall back to live third-party traffic.
- Any retry is bounded and visible in the report.
