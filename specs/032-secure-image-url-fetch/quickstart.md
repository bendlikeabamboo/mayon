# Quickstart — validate 032 secure-image-url-fetch

Runnable proof that the fix works end-to-end without real network access. All stubs are
in-process (stubbed `fetch`, spied DNS) — no Docker stack needed.

## Prerequisites

- Deps installed and `@mayon/shared` built (worktree bootstrap already done).
- Machine profile: 12 CPU / 7.1 GiB RAM → **always `pnpm test:low-spec`** (never plain
  `pnpm test`), **one** test/check process at a time.
- After any change to `packages/shared/`, rebuild before checks/tests:
  `pnpm --filter @mayon/shared build`.

## Scenario A — foreign-host image URL observes no credential (issue acceptance #1)

1. `pnpm test:low-spec src/lib/ai/sdk-fetch.test.ts`
   - Expect the new cases: keychain fetch built with `authHost: 'api.provider.test'` + a stored
     key, fetching `https://attacker.example/x.png`, sends **no** `Authorization` header (and
     does not throw when no key is stored); fetching the provider host still sends it.
2. `pnpm test:low-spec src/lib/services/llm-proxy-fetch.test.ts`
   - Expect: the declared `authHost` is present in the JSON body POSTed to `/api/llm/proxy`.

## Scenario B — relay rejects non-public targets (issue acceptance #2)

1. `pnpm --filter @mayon/server test src/url-target-guard.test.ts`
   - Expect: every blocked class (loopback/private/link-local/CGNAT/unspecified/UL/multicast/
     reserved, v4 + v6 + IPv4-mapped + literal forms) classifies as blocked; public addresses
     pass.
2. `pnpm --filter @mayon/server test src/llm-proxy.test.ts`
   - Expect: `http://127.0.0.1:4319/...` and a DNS name resolving to `192.168.1.1` → `403
     {"error":"blocked target"}` with **zero** upstream fetch calls; a declared-host request
     keeps its `authorization` header and an undeclared/mismatched one loses it; the upstream
     fetch is invoked with `redirect: 'error'`; an oversized streamed body is cut off.

## Scenario C — bounded image materialization degrades to the notice

1. `pnpm test:low-spec src/lib/chat/images.test.ts`
   - Expect: a stubbed fetch streaming more than `IMAGE_FETCH_MAX_BYTES` yields `null` from
     `fetchImageCandidate` (→ the existing "[Image could not be loaded…]" notice path in
     `composeAssistantParts`); sizes under the cap still materialize.

## Scenario D — no legitimate-flow regressions

1. `pnpm test:low-spec` (full client suite — model discovery, connection-test, copilot,
   transport, chat tests must all pass unchanged).
2. `pnpm --filter @mayon/server test` (full server suite).
3. `pnpm check && pnpm lint`.

## Expected outcome

A–C pass green post-fix; A(fs1) and B(fs2) fail if the fix is reverted (that is the regression
guarantee, FR-010); D passes throughout.
