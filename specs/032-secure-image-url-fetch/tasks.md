# Tasks: Secure image-URL fetching (credential containment + relay hardening)

**Input**: Design documents from `/specs/032-secure-image-url-fetch/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Requested explicitly — the issue's acceptance requires automated regression tests, and the constitution (II) requires every bug fix to ship a regression test that fails without the fix. Test tasks are written FIRST in each story and must be observed failing before the paired implementation task.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Web app layout: SPA in `src/`, server in `server/src/`, shared protocol package in `packages/shared/src/`.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The one wire-contract change everything else builds on.

- [x] T001 Add optional `authHost?: string` to `LlmProxyRequest` in `packages/shared/src/protocol.ts` (documented in `specs/032-secure-image-url-fetch/contracts/llm-proxy.md`), then rebuild the package with `pnpm --filter @mayon/shared build` so client and server type-check against it

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared host-normalization helpers and the server-side IP guard, needed by both stories.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T002 [P] Add `normalizeHostname(host: string): string` (lowercase, strip trailing `.`, strip IPv6 `[]`) and `sameHost(a: string, b: string): boolean` to `src/lib/ai/llm-target.ts`, with table-driven unit tests appended next to the existing `isLoopbackUrl` block in `src/lib/services/llm-proxy-fetch.test.ts`
- [x] T003 [P] Create `server/src/url-target-guard.ts` exporting `blockedAddressKind(ip: string): string | null` (v4 ranges `0.0.0.0/8`, `10/8`, `100.64.0.0/10`, `127/8`, `169.254/16`, `172.16/12`, `192.168/16`, `224.0.0.0/4`, `240.0.0.0/4`; v6 `::`, `::1`, `fe80::/10`, `fc00::/7`, `ff00::/8`, IPv4-mapped `::ffff:0:0/96` recursing the v4 table) and `assertPublicHttpTarget(url: string): Promise<void>` (IP-literal fast path via `node:net` `isIP`; otherwise `dnsPromises.lookup(hostname, { all: true })` from `import { promises as dnsPromises } from 'node:dns'`, validating every address; throws typed errors `BlockedTargetError(kind)` / resolver errors pass through)
- [x] T004 [P] Create `server/src/url-target-guard.test.ts`: table-driven classification (every blocked class in v4 + v6 + bracketed/mapped/`0x7f000001`-style literals vs public addresses like `93.184.216.34`, `2606:4700::6810:85e5`), plus `assertPublicHttpTarget` literal fast-path checks

**Checkpoint**: Foundation ready — user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - No provider credential leaks to non-provider hosts (Priority: P1) 🎯 MVP

**Goal**: The keychain/transport seams attach the provider key only when the request host matches the provider API host; image materialization buffers at most 32 MiB.

**Independent Test**: `pnpm test:low-spec src/lib/ai/sdk-fetch.test.ts src/lib/chat/images.test.ts src/lib/services/llm-proxy-fetch.test.ts` — the new cases fail before T007–T010 and pass after, with all pre-existing cases unchanged.

### Tests for User Story 1 (written FIRST, must FAIL)

> **NOTE**: Write these tests FIRST, ensure they FAIL before implementation

- [ ] T005 [P] [US1] Add regression tests to `src/lib/ai/sdk-fetch.test.ts`: with `authHost: 'api.provider.test'` and a stored key, fetching `https://attacker.example/x.png` sends NO auth header; with no stored key and a foreign host, NO `MissingKeyError` is thrown; fetching `https://api.provider.test/v1/x` still sends `Bearer sk-test` — the first two assertions must fail against the current unconditional attach
- [ ] T006 [P] [US1] Add size-cap tests to `src/lib/chat/images.test.ts`: a stubbed fetch whose streamed body exceeds `IMAGE_FETCH_MAX_BYTES` makes `fetchImageCandidate` return `null`; a body under the cap still materializes (stub via `new Response(new ReadableStream(...))`)

### Implementation for User Story 1

- [ ] T007 [US1] Implement the `authHost` gate in `src/lib/ai/sdk-fetch.ts`: add `authHost?: string` to `KeychainFetchAuth`; compute `const isAuthTarget = !auth.authHost || sameHost(new URL(url).hostname, auth.authHost)`; only read the key store / throw `MissingKeyError` / set the header when `isAuthTarget`; pass `auth.authHost` as the second argument to `getLlmFetch(url, …)` (depends T002, T005)
- [ ] T008 [US1] Supply `authHost` in `src/lib/ai/sdk-factory.ts`: `providerFetchFor` computes it as `normalizeHostname(new URL(config.baseUrl).hostname)` (guarded try/catch — unparseable baseUrl omits the gate, preserving legacy behavior) for the openai-compatible / anthropic / gemini branches (depends T007)
- [ ] T009 [US1] Extend `getLlmFetch(url: string, authHost?: string)` in `src/lib/services/llm-proxy-fetch.ts` so `createProxyFetch` includes `authHost` in the POSTed JSON body; update `src/lib/services/llm-proxy-fetch.test.ts` to assert the field is forwarded verbatim and absent when not provided (depends T001)
- [ ] T010 [US1] Bound image materialization in `src/lib/chat/images.ts`: export `IMAGE_FETCH_MAX_BYTES = 32 * 1024 * 1024`; in `fetchImageCandidate` replace `res.arrayBuffer()` with a `res.body.getReader()` loop that accumulates chunks and returns `null` past the cap (fall back to `arrayBuffer()` + length check only when `res.body` is unavailable) (depends T006)

**Checkpoint**: Client-side credential leak closed; `chat.svelte.ts` untouched

---

## Phase 4: User Story 2 - The server relay refuses unsafe targets and bounds transfers (Priority: P2)

**Goal**: The relay strips credential headers for absent/mismatched `authHost`, rejects non-public destinations with 403, refuses redirects, and caps streamed responses at 64 MiB; every legit producer declares its host.

**Independent Test**: `pnpm --filter @mayon/server test src/llm-proxy.test.ts src/url-target-guard.test.ts` — strip/403/redirect/cap cases fail before T013–T015 and pass after.

### Tests for User Story 2 (written FIRST, must FAIL)

> **NOTE**: Write these tests FIRST, ensure they FAIL before implementation

- [ ] T011 [P] [US2] Add credential-strip tests to `server/src/llm-proxy.test.ts`: a request with `authorization`/`x-api-key` headers and NO `authHost` (or a mismatched one, e.g. url `https://other.example/x` vs `authHost: 'api.provider.test'`) reaches the stubbed upstream with those headers deleted; a matching `authHost` forwards them unchanged
- [ ] T012 [P] [US2] Add target-safety tests to `server/src/llm-proxy.test.ts` (default-stub `dnsPromises.lookup` to a public IP so existing cases keep passing): `http://127.0.0.1:4319/api/health` and a hostname resolving to `192.168.1.1` → `403 {"error":"blocked target"}` with the fetch stub NOT called; unresolvable hostname → 502; upstream fetch is invoked with `redirect: 'error'`; a stubbed response stream larger than `MAX_PROXY_RESPONSE_BYTES` (build chunks over the exported constant without allocating more than a few MiB, e.g. many repeated `Buffer.alloc(1024*1024)` re-emits) is cut off mid-body

### Implementation for User Story 2

- [ ] T013 [US2] Enforce the credential rule in `server/src/llm-proxy.ts`: export `CREDENTIAL_HEADERS = ['authorization', 'x-api-key', 'x-goog-api-key']` (compared case-insensitively); delete them from a copy of `body.headers` unless `body.authHost` is a string whose normalized hostname equals the target's (local re-implementation of the T002 normalization — the server cannot import SPA code) (depends T001, T011)
- [ ] T014 [US2] Wire `assertPublicHttpTarget` into the relay in `server/src/llm-proxy.ts` after URL parsing: `BlockedTargetError` → `403 {"error":"blocked target","detail":kind}` with no upstream fetch; resolver failures fall into the existing 502 handler (depends T003, T012)
- [ ] T015 [US2] Add `redirect: 'error'` to the upstream fetch options and a streaming byte cap in `server/src/llm-proxy.ts`: export `MAX_PROXY_RESPONSE_BYTES = 64 * 1024 * 1024`; count bytes while piping (`nodeStream.on('data', …)` destroy past the cap — the existing error handler destroys the reply) (depends T012)
- [ ] T016 [P] [US2] Declare `authHost` in the remaining credential producers: `src/lib/ai/http-transport.ts` (`HttpStreamRequest.authHost?: string`, attach/`MissingKeyError` gated on `sameHost(req.url, authHost)` like T007, pass to `getLlmFetch`), `src/lib/ai/copilot-fetch.ts` (`normalizeHostname(new URL(target).hostname)`), `src/lib/ai/model-discovery.ts` (baseUrl host for the `req.auth` call, session-endpoint host for the inline Copilot headers call); extend `src/lib/ai/http-transport.test.ts` and `src/lib/ai/model-discovery.test.ts` expectations accordingly (depends T002, T009; land with or before T013 so enforcement never strips legit traffic)

**Checkpoint**: Relay hardened; all legitimate flows declare their host

---

## Phase 5: User Story 3 - Regression verification and unchanged legitimate behavior (Priority: P3)

**Goal**: Both issue acceptance cases locked by fail-first tests; zero legitimate-flow regressions; the relay contract documented.

**Independent Test**: Full suites green + quickstart.md scenarios A–D pass.

- [ ] T017 [US3] Record fail-first evidence and run the quickstart in `specs/032-secure-image-url-fetch/quickstart.md`: confirm scenarios A/B/C were observed failing before their paired implementation tasks (T005/T006/T011/T012) and pass after; note results in the PR description
- [ ] T018 [P] Document the hardened relay contract in `docs/reference/seams.qmd` (the "No secrets in settings" section's proxy paragraph): credentials ride same-origin to the relay as before, but the relay forwards them only to the client-declared provider host, refuses non-public destinations and redirects, and caps responses at 64 MiB — link `specs/032-secure-image-url-fetch/contracts/llm-proxy.md`

**Checkpoint**: All user stories independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Merge gates.

- [ ] T019 Run all quality gates one process at a time: `pnpm --filter @mayon/shared build` (if not already current), `pnpm check`, `pnpm lint`, `pnpm test:low-spec`, `pnpm --filter @mayon/server test`; fix fallout (e.g. prettier wrapping in touched files)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 blocks everything (wire type + rebuild).
- **Foundational (Phase 2)**: T002 blocks T007/T016; T003–T004 block T014. T002/T003/T004 are mutually parallel.
- **User Stories (Phases 3–5)**: US1 (client gate) and US2 (relay) both depend only on Phase 1–2 and can proceed in parallel; US3 depends on US1+US2.
- **Polish (Phase 6)**: after everything.

### User Story Dependencies

- **User Story 1 (P1)**: after T001–T002 — the client-side leak stop; delivers the MVP alone.
- **User Story 2 (P2)**: after T001–T004 — relay enforcement; T016 must land with or before T013 to keep legit traffic working.
- **User Story 3 (P3)**: after US1+US2 — verification sweep + docs.

### Within Each User Story

- Tests first, observed failing, then implementation
- Seam helpers (T007) before their callers (T008)
- Within US2: strip (T013), target guard (T014), redirect+cap (T015) are independent of each other once their tests exist

### Parallel Opportunities

- T002 ∥ T003 ∥ T004 (Phase 2)
- T005 ∥ T006 (US1 tests, different files); T011 ∥ T012 (US2 tests, same file — run as one writer if dispatching agents)
- T016 parallel with T013–T015 (different files)

---

## Parallel Example: User Story 1

```bash
# Launch US1 test tasks together (different files):
Task: "T005 regression tests in src/lib/ai/sdk-fetch.test.ts"
Task: "T006 size-cap tests in src/lib/chat/images.test.ts"

# Then implementation in dependency order:
Task: "T007 authHost gate in src/lib/ai/sdk-fetch.ts"
Task: "T008 providerFetchFor authHost in src/lib/ai/sdk-factory.ts"
Task: "T009 getLlmFetch authHost in src/lib/services/llm-proxy-fetch.ts"
Task: "T010 bounded read in src/lib/chat/images.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (T001) + Phase 2 (T002–T004)
2. Complete Phase 3 (US1) — **the credential leak is closed here**
3. **STOP and VALIDATE**: `pnpm test:low-spec src/lib/ai/sdk-fetch.test.ts src/lib/chat/images.test.ts src/lib/services/llm-proxy-fetch.test.ts`

### Incremental Delivery

1. Foundation → US1 (client containment, MVP) → US2 (relay hardening, defense-in-depth) → US3 (verification + docs) → gates
2. Each story adds containment without breaking the previous one

### Parallel Team Strategy

1. Team completes T001–T004 together
2. Implementer A: US1; Implementer B: US2 (disjoint files: `src/lib/ai|services|chat` vs `server/src/*` — T009/T016 touch client files inside US2, sequence B after A's T009 or coordinate)
3. US3 + gates as a final single-owner sweep

---

## Notes

- [P] = different files, no dependency on incomplete tasks; keep dispatched subgroups ≤6 tasks.
- Test tasks fail first (constitution II); every story's regression coverage lives with the story.
- No new dependencies, no schema migration, no `db`/repository changes, no changes to `chat.svelte.ts` (research R-1).
- `@mayon/shared` must be rebuilt (T001) before any `pnpm check`/test that resolves its types; after merging, the dev Docker images need `pnpm dev:build` (orchestrator follow-up, outside this fleet's scope).
- Verify tests fail before implementing; commit after each task or logical group (orchestrator owns commits in this fleet).
