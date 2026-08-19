---
description: 'Task list for Brave Search MCP Service feature implementation'
---

# Tasks: Brave Search MCP Service

**Input**: Design documents from `/specs/001-brave-search-mcp/` (spec.md, plan.md, research.md, data-model.md, contracts/, quickstart.md)

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Included — constitution Principle II requires tests for new behavior in `src/lib/` and `server/src/`.

**Organization**: Tasks grouped by user story; each story is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story (US1, US2, US3)
- Exact file paths in every task

## Path Conventions

Web app repo: SPA in `src/` (SvelteKit), server in `server/src/` (Fastify), shared types in `packages/shared/src/`, compose stacks at repo root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Companion container + stack wiring so the server feature can be developed against a live upstream.

- [x] T001 Add `brave-search` service to `docker-compose.yml`: `profiles: ['brave-search']`, image = pinned `node:22-alpine` running `npx -y @brave/brave-search-mcp-server@<pinned-2.x> --transport http --host 0.0.0.0` (override var `BRAVE_SEARCH_IMAGE`), env `BRAVE_API_KEY`, no host port (internal only), `restart: unless-stopped`; add `BRAVE_SEARCH_URL: ${BRAVE_SEARCH_URL:-}` to the `server` service
- [x] T002 [P] Mirror the same `brave-search` service and `server`-service `BRAVE_SEARCH_URL` env into `docker-compose.dev.yml` (identical definition — dev/prod parity, FR-008)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Capability type, proxy route, and server wiring that every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T003 Add `'brave-search'` to the `ServerCap` union in `packages/shared/src/protocol.ts`, then rebuild shared (`pnpm --filter @mayon/shared build`) so consumers resolve types
- [x] T004 Create `server/src/brave-search.ts`: `registerBraveSearch(app, upstreamUrl)` — `ALL /api/brave-search/*` streaming passthrough following the `server/src/llm-proxy.ts` pattern (hijack reply, strip hop-by-hop headers both ways, forward full path suffix, pipe request/response bodies incl. `text/event-stream`, abort upstream on client disconnect, `cache: 'no-store'`, upstream failure → `502 {"error":...}` with no secrets, upstream status codes forwarded); per `contracts/server-capability-and-proxy.md`
- [x] T005 [P] Create `server/src/brave-search.test.ts` (Vitest, fastify `app.inject` + local fake upstream): JSON body passthrough, SSE response streamed unbuffered, `DELETE` forwarded, path suffix forwarded verbatim (`/api/brave-search/mcp` → upstream `/mcp`), `mcp-session-id` header passes both ways, upstream 4xx/5xx forwarded, upstream-down → 502, upstream URL not leaked in error body
- [x] T006 Wire into `server/src/server.ts`: parse `BRAVE_SEARCH_URL`; if set and valid `http(s)` URL → advertise `'brave-search'` in `/api/health` caps and call `registerBraveSearch`; if empty → no cap, no route (404); if set but invalid → log error and treat as off (never crash boot); extend `server/src/server.test.ts` base-caps test for both states

**Checkpoint**: Foundation ready — `docker compose --profile brave-search up` + `/api/health` shows the cap; proxy curl passes against the live companion.

---

## Phase 3: User Story 1 - Connect to a self-hosted Brave Search service (Priority: P1) 🎯 MVP

**Goal**: One-click connection from the app to the companion, gated on capability, no client-side secret.

**Independent Test**: With the companion running, Settings → MCP servers offers "Brave Search (self-hosted)"; add + trust + test connection lists Brave tools; with the cap absent the card shows guidance and the app is otherwise unaffected.

### Implementation for User Story 1

- [x] T007 [P] [US1] Extend `HttpMcpTransport.start()` validation in `src/lib/mcp/http.ts` to accept root-relative URLs (`/^\/[^/]/`) alongside absolute `^https?://`; pass relative URLs to `fetch` unchanged (same-origin by construction); no protocol-relative `//`
- [x] T008 [P] [US1] Add cases to `src/lib/mcp/http.test.ts`: root-relative accepted, protocol-relative `//host` rejected, bare path rejected; relative-URL request hits the expected same-origin path (fake fetch)
- [x] T009 [P] [US1] Add optional `requiresCap?: ServerCap` to `McpServerTemplate` in `src/lib/mcp/types.ts` (no behavior change elsewhere)
- [x] T010 [US1] Add the "Brave Search (self-hosted)" template to `src/lib/mcp/templates.ts`: `transport: 'http'`, `url: '/api/brave-search/mcp'`, `headers: {}`, `requiresTrust: true`, `requiresCap: 'brave-search'`, `platforms: ['web','desktop']`, description noting the API key stays in stack env; per `contracts/mcp-connection-template.md`
- [x] T011 [US1] Update `src/lib/components/mcp/McpServers.svelte` template gallery: honor `requiresCap` in `isTemplateAvailable()` — cap present → card active; cap absent → disabled card with enablement guidance (`.env` keys + `--profile brave-search`), matching the `stdio-mcp` gating pattern

**Checkpoint**: US1 fully functional and testable independently (quickstart.md steps 1–3).

---

## Phase 4: User Story 2 - Fresh, source-backed answers via external validation (Priority: P2)

**Goal**: Consulted sources render as links under tool rows in chat, derived from already-persisted metadata.

**Independent Test**: Ask a question requiring current info with the connection enabled; the tool row beneath the reply lists result links; reload persists them (rendered from stored `messages.metadata`).

### Implementation for User Story 2

- [x] T012 [P] [US2] Create `src/lib/mcp/sources.ts`: pure `extractSources(detail: unknown): { title: string; url: string }[]` per `contracts/tool-result-sources.md` — parse `content[].text` as JSON, collect string `url` fields matching `^https?://` with `title` fallback to URL/host, dedupe by URL preserving order, cap at 10, raw-text URL scan fallback, never throws
- [x] T013 [P] [US2] Create `src/lib/mcp/sources.test.ts`: Brave-shaped web/news payloads, image payloads (v2 URL-only), nested/odd shapes, unparseable text (fallback scan), no-content detail, dedupe, cap enforcement, non-URL fields ignored, empty result for foreign tools
- [x] T014 [P] [US2] Create `src/lib/components/chat/ToolSources.svelte`: renders `{ title, url }[]` as muted external links (`text-xs`, muted-foreground vocabulary, `target="_blank" rel="noopener noreferrer"`), hidden when list empty
- [x] T015 [US2] Integrate into `src/lib/components/chat/MessageRow.svelte`: for visible `role='tool'` rows, parse `message.metadata` and render `ToolSources` under the existing summary label (no changes to hidden-row logic or `present_choices`)

**Checkpoint**: US1 + US2 both independently functional (quickstart.md step 4).

---

## Phase 5: User Story 3 - Dependable operation and graceful degradation (Priority: P3)

**Goal**: Failure, recovery, and toggle behavior verified as requirements — mostly existing machinery, locked in with regression tests.

**Independent Test**: `docker compose stop brave-search` mid-session → turns complete with a notice; restart → next turn searches again with no app/stack restart; per-chat toggle off → no search attempts.

### Implementation for User Story 3

- [x] T016 [P] [US3] Add degradation tests to `src/lib/mcp/http.test.ts`: unreachable upstream → classified error (not a hang) via `classifyFetchError`; `callTimeoutMs` expiry → abort + error; 404-with-session → session reset and clean failure
- [x] T017 [US3] Add recovery test to `src/lib/mcp/lifecycle.test.ts`: a failed/killed transport in one turn does not prevent `connectSession` from creating a fresh healthy transport the next turn (no cached failure state) — locks in SC-005/recovery-without-restart

**Checkpoint**: All stories independently functional (quickstart.md step 5).

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Docs, end-to-end validation, full quality gates.

- [x] T018 [P] Document enablement in `README.md` (troubleshooting/features section): `.env` keys `BRAVE_API_KEY` + `BRAVE_SEARCH_URL`, `COMPOSE_PROFILES=brave-search` / `--profile brave-search` for both stacks, key-rotation = edit env + recreate companion only, link to specs docs
- [x] T019 Run the full `specs/001-brave-search-mcp/quickstart.md` validation on the dev stack, including the R-5 endpoint-path check (confirm upstream serves `/mcp`; fix the template suffix in `src/lib/mcp/templates.ts` if not) and the degradation + recovery drills
- [x] T020 Full quality gates: `pnpm check && pnpm lint && pnpm test && pnpm --filter @mayon/server test`, plus `pnpm dev:build` (shared protocol change) — all green

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (proxy needs the container to test against live); BLOCKS all user stories
- **User Stories (Phases 3–5)**: Depend on Phase 2; can proceed in parallel or sequentially P1 → P2 → P3
- **Polish (Phase 6)**: Depends on all completed stories it validates

### User Story Dependencies

- **US1 (P1)**: After Phase 2 — no story dependencies (MVP)
- **US2 (P2)**: After Phase 2 — independent of US1 code-wise (citations work for any MCP tool result); usable demo requires US1's connection
- **US3 (P3)**: After Phase 2 — test-only phase hardening US1 machinery; no code dependency on US2

### Within Each User Story

- Tests alongside implementation tasks marked [P] where files differ
- Transport/type changes before template/UI wiring (T007–T009 before T010–T011)
- Extractor before renderer before integration (T012–T013 before T014–T015)

### Parallel Opportunities

- T001 ∥ T002 (different compose files)
- T004 ∥ T005 route + tests (T005 written against the contract, run after T004)
- T007 ∥ T008 ∥ T009 (http.ts, http.test.ts, types.ts — distinct files)
- T012 ∥ T013 ∥ T014 (sources.ts, sources.test.ts, ToolSources.svelte)
- T016 ∥ T017 ∥ T018 (distinct files)
- After Phase 2: US1, US2, US3 phases can run in parallel across contributors

---

## Parallel Example: User Story 1

```bash
# After Phase 2 checkpoint — launch together (distinct files):
Task: T007 "Extend HttpMcpTransport root-relative URLs in src/lib/mcp/http.ts"
Task: T008 "Add http.test.ts relative-URL cases"
Task: T009 "Add requiresCap to McpServerTemplate in src/lib/mcp/types.ts"

# Then sequential wiring:
Task: T010 "Add self-hosted template in src/lib/mcp/templates.ts"
Task: T011 "Gate template in src/lib/components/mcp/McpServers.svelte"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (compose)
2. Complete Phase 2 (cap + proxy + wiring)
3. Complete Phase 3 (US1: template + gating + relative URL)
4. **STOP and VALIDATE**: quickstart.md steps 1–3 — healthy connection, tools listed, guidance state when cap absent
5. Ship-able MVP: private, self-hosted search connection

### Incremental Delivery

1. Setup + Foundational → proxy live, cap advertised
2. - US1 → usable connection (MVP)
3. - US2 → source-backed, citable answers
4. - US3 → degradation/recovery locked by tests
5. Polish: docs + full-stack validation + gates → ready for RC flow per AGENTS.md

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- No DB migrations, no new npm deps, no third image — do not introduce any (plan.md constitution check)
- The API key lives ONLY in compose env (`BRAVE_API_KEY` on the companion); never add it to app settings, URLs, headers, or logs (amended FR-002)
- After `packages/shared` changes: rebuild shared, then `pnpm dev:build` in the Docker dev flow
- Commit after each task or logical group; RC-first release flow per AGENTS.md when shipping

---

## Phase 7: Revision — credential custody in the app keystore (2026-08-19, research.md R-9)

**Purpose**: User decision — all credentials in one place (web app secret store); companion-container path removed.

- [x] T021 Revise spec.md custody model (US1, FR-001/FR-002/FR-005, Key Entities, SC-001, edge cases, assumptions)
- [x] T022 Add research.md R-9 addendum; delete contracts/server-capability-and-proxy.md; rewrite contracts/mcp-connection-template.md for stdio+keystore
- [x] T023 Revise data-model.md + quickstart.md; add plan.md revision note
- [x] T024 Replace HTTP template in src/lib/mcp/templates.ts with stdio "Brave Search" template (pinned @2.0.85, BRAVE_API_KEY secretRef)
- [x] T025 Remove requiresCap from src/lib/mcp/types.ts; revert McpServers.svelte gating/hint to stdio-only pattern
- [x] T026 Delete server/src/brave-search.ts + brave-search.test.ts; revert server/src/server.ts wiring and server.test.ts cap tests
- [x] T027 Revert ServerCap union in packages/shared/src/protocol.ts + rebuild shared; remove compose brave-search services/env from both files; delete .env
- [x] T028 Rewrite README.md Brave section (in-app key, rotation in settings, nothing to deploy)
- [x] T029 Quality gates green: pnpm check/lint/test (1016) + server tests (80)
- [x] T030 Dev-stack refresh: removed companion, `pnpm dev:build && pnpm dev:up`, verified /api/health lacks brave-search, stdio child smoke (npx initialize inside server container) succeeded

**Retained from the container iteration**: citations extractor/UI, degradation/recovery tests, root-relative URL support in HttpMcpTransport (all transport-agnostic).
