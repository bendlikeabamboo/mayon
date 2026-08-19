# Implementation Plan: Brave Search MCP Service

**Branch**: `001-brave-search-mcp` | **Date**: 2026-08-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-brave-search-mcp/spec.md`

## Summary

Give self-hosters an optional Brave Search companion container running the official
`@brave/brave-search-mcp-server` in streamable-HTTP mode, reached from the SPA through a
new same-origin streaming proxy on the Mayon server, gated by a new `brave-search`
capability. The app gains a "Brave Search (self-hosted)" connection template (relative
URL, no client-side secret — the API key lives only in the companion's stack env), and
chat gains source citations rendered from already-persisted MCP tool-result metadata.
Zero DB schema changes, zero new images in the release contract, opt-in via a compose
profile. Research and rationale: [research.md](./research.md) — note it documents a
**spec amendment** (FR-002/US1): the official server accepts the API key only at process
startup, so the key is deployment configuration and the app never handles it.

> **Post-implementation revision (2026-08-19, research.md R-9)**: credential custody
> moved back to the app's secret store via the existing stdio spawn machinery; the
> companion container, proxy route, and capability were removed. The summary above
> describes the superseded iteration and is retained for history; the contract in
> `contracts/mcp-connection-template.md` describes the shipped design.

## Technical Context

**Language/Version**: TypeScript, Node 22 (`.nvmrc`), pnpm 10. Svelte 5 runes SPA + Node/Fastify server.

**Primary Dependencies**: existing only — Fastify (server), SvelteKit/Tailwind v4/shadcn-svelte (SPA), official npm package `@brave/brave-search-mcp-server@2.x` (pinned) running in the companion container. No new npm dependencies in any workspace package.

**Storage**: Postgres via existing schema — **no migrations**. Connections persist in `settings['mcpServers']` (`mcpRepo`); citations derive from `messages.metadata` (already persisted); per-chat toggles in `chats.mcpConfig`.

**Testing**: Vitest everywhere — `pnpm test` (SPA/lib, pglite driver) and `pnpm --filter @mayon/server test` (server routes with fakes). UI smoke on the dev stack per constitution III.

**Target Platform**: Linux Docker (prod + dev compose stacks); browser SPA served same-origin by web (nginx :8080 / Vite :5173).

**Project Type**: self-hosted web app (SPA + server + compose stacks).

**Performance Goals**: search-augmented replies ≤ +10 s vs. non-search (SC-004); proxy must stream SSE without buffering; no measurable SPA bundle growth (no new deps).

**Constraints**: no secrets in app settings/URLs/logs (constitution I); progressive capability degradation (III); no downtime or restarts of core services when enabling/upgrading the companion (III); max 64 tools per LLM call; `@mayon/shared` must be rebuilt (`tsup → dist`) before consumers resolve types — touching `packages/shared/src/protocol.ts` requires `pnpm dev:build` in Docker dev flow; no `+`-prefixed test filenames.

**Scale/Scope**: single-user self-hosted; one new server route family, one template, one transport tweak, one extractor + one small component, two compose files, docs.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                                                    | Status | How satisfied                                                                                                                                                 |
| ------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I — Layering (repos only, no `db` imports)                   | PASS   | No new DB access; citations are read from message rows via existing repos/stores.                                                                             |
| I — `StorageDriver` is the only storage seam                 | PASS   | Unchanged; no new storage paths.                                                                                                                              |
| I — `pnpm check` + `pnpm lint`, Node 22/pnpm 10 pins         | PASS   | No toolchain changes; companion uses the official Node-22 package.                                                                                            |
| I — No secrets in `settings`                                 | PASS   | Stronger than before: the app holds **no** key at all; connection config carries no secret fields (research R-2).                                             |
| I — SvelteKit `+` prefix rule                                | PASS   | New files: `sources.ts`, `ToolSources.svelte`, server `brave-search.ts` — no `+` prefixes.                                                                    |
| II — `pnpm test` + server tests; tests with new behavior     | PASS   | New unit/route tests required (see tasks contract): proxy route (fastify inject + fake upstream), relative-URL transport, template gating, source extraction. |
| III — Tailwind v4 + shadcn-svelte vocabulary                 | PASS   | `ToolSources.svelte` mirrors the existing muted tool-row styling (`MessageRow.svelte:82-95`).                                                                 |
| III — Progressive capability enablement via `detectServer()` | PASS   | New `brave-search` cap advertised iff `BRAVE_SEARCH_URL` set; template gated on cap; absent = invisible + guidance (R-4).                                     |
| III — No downtime/restarts from user-facing ops              | PASS   | Companion is an opt-in compose profile; enabling/upgrading it touches only its own container (R-7).                                                           |
| IV — Perf claims measured; no bundle bloat                   | PASS   | No new deps; SSE streamed via the proven llm-proxy pipe pattern; SC-04 verifiable via perf probe.                                                             |
| IV — `@mayon/shared` build order                             | PASS   | Protocol change planned; `pnpm dev:build` noted as a required step.                                                                                           |
| Quality Gates — drizzle via `pnpm db:generate`               | N/A    | No schema change.                                                                                                                                             |
| Quality Gates — RC-first release contract (2 images)         | PASS   | No new images published; companion uses a public base + pinned npm package (R-7).                                                                             |

**Post-Phase-1 re-check**: PASS — the design (data-model.md, contracts/) introduces no
new seams, no migration, no third image, and no untested surface. No violations, so the
Complexity Tracking table below is left empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-brave-search-mcp/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output — decisions R-1..R-8 + spec amendment note
├── data-model.md        # Phase 1 output — entities, no migrations
├── quickstart.md        # Phase 1 output — end-to-end validation guide
├── contracts/           # Phase 1 output
│   ├── server-capability-and-proxy.md
│   ├── mcp-connection-template.md
│   └── tool-result-sources.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
packages/shared/src/protocol.ts            # ServerCap += 'brave-search' (HealthResponse unchanged shape)

server/src/
├── server.ts                              # register route + advertise cap iff BRAVE_SEARCH_URL set
├── brave-search.ts                        # NEW: ALL /api/brave-search/* streaming passthrough (llm-proxy pattern)
└── brave-search.test.ts                   # NEW: route tests (fake upstream: JSON + SSE + DELETE + errors)

src/lib/mcp/
├── types.ts                               # McpServerTemplate.requiresCap?: ServerCap
├── templates.ts                           # NEW template: 'Brave Search (self-hosted)', url '/api/brave-search/mcp'
├── http.ts                                # accept root-relative same-origin URLs (fetch resolves them)
├── http.test.ts                           # relative-URL + session behavior tests
└── sources.ts (+ sources.test.ts)         # NEW: extract {title,url}[] from persisted MCP tool detail content

src/lib/components/chat/
└── ToolSources.svelte                     # NEW: muted source-link list under tool rows (MessageRow integration)

src/lib/components/mcp/
└── McpServers.svelte                      # gate new template on cap; guidance text when cap absent

docker-compose.yml / docker-compose.dev.yml # brave-search service, profiles: ['brave-search'], internal-only
README.md / docs                           # opt-in enablement recipe (.env: BRAVE_API_KEY + BRAVE_SEARCH_URL)
```

**Structure Decision**: Extends the established seams — server route modules mirror
`llm-proxy.ts`; SPA changes live in `src/lib/mcp` + chat components; capability type in
`packages/shared`. No new packages, no new top-level directories.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations — table intentionally empty.
