# Research: Brave Search MCP Service

**Feature**: specs/001-brave-search-mcp | **Date**: 2026-08-19

Research resolved every open technical question. The findings below drive the design in
`plan.md`, `data-model.md`, `contracts/`, and `quickstart.md`.

## R-1: Official Brave MCP server — transport and key handling

**Decision**: Run the official `@brave/brave-search-mcp-server` (v2.x) in a dedicated
companion container in **HTTP (streamable) transport mode**.

**Rationale** (from the official repo/README, brave/brave-search-mcp-server):

- v2.x supports `--transport http` / `BRAVE_MCP_TRANSPORT=http`; stdio is the default.
- HTTP mode env knobs: `BRAVE_MCP_PORT` (default 8080), `BRAVE_MCP_HOST` (default
  `127.0.0.1`; must be `0.0.0.0` inside a container), `--stateless` flag, tool
  allow/denylists.
- The API key is accepted **only at process startup** (`BRAVE_API_KEY` env or
  `--brave-api-key-file`). There is no per-request/per-session key injection.
- The HTTP endpoint is **unauthenticated**; the README explicitly warns to expose it only
  on a trusted network. Browser-direct access is further guarded by DNS-rebinding checks
  (`BRAVE_MCP_ALLOWED_ORIGINS` / `BRAVE_MCP_ALLOWED_HOSTS`, non-loopback Origins get 403).
- Requires Node 22+ — matches our toolchain pin.

**Alternatives considered**:

- _Spawn per-turn via the existing stdio template_ (npx inside the server container,
  key from browser keystore over the WS bridge): already works today, but spawns the
  process on every turn (npx cold start each turn), no isolation, and no dedicated
  service — the user explicitly asked for a container.
- _Third-party hosted HTTP endpoint_ (Smithery): rejected by the spec — puts the API key
  in a URL query parameter and routes traffic through an external intermediary.
- _Mayon-owned wrapper image_ (own MCP server calling Brave REST, accepting a
  per-request key header): would satisfy keystore-only key handling, but means
  maintaining an MCP server implementation **and a third GHCR image**, which breaks the
  two-image release contract (CI `verify-version`, `release-assets`, install.sh all
  assume web + server). Rejected as disproportionate.
- _supergateway/mcp-proxy stdio→HTTP bridge_: still env-keys the child at fixed spawn
  time; adds a third-party tool for nothing the official HTTP mode doesn't already do.

## R-2: API key custody — deployment env, not app keystore

**Decision**: The Brave API key is supplied as **stack deployment configuration**
(`BRAVE_API_KEY` in the compose environment of the companion service). The app itself
never sees, stores, or transmits the key. **This amends spec FR-002/US1** (which assumed
the browser keystore flow); see the amendment note below.

**Rationale**: R-1 shows the official server only accepts the key at startup. The only
keystore-compatible alternatives are the rejected ones above. Deployment-env custody is
consistent with how the stack already treats `POSTGRES_PASSWORD` (compose env / `.env`),
keeps the key off the browser, out of the app database entirely (constitution Principle I
"no secrets in settings" is satisfied trivially — the app has no secret to hold), and
rotation is a one-line `.env` change + container restart of the companion only.

**Spec amendment applied** (spec.md updated alongside this research):

- FR-002 now reads: the key MUST be supplied as stack deployment configuration; the app
  never handles it; it MUST NOT appear in the app settings store, URLs, or logs.
- US1 story/scenarios reworded: the user enables the companion service with their key as
  stack config, then adds/confirms the connection in the app; an invalid key now
  surfaces at **use time** (the MCP handshake succeeds; Brave's API rejects the call),
  which FR-007 already covers.
- Key entity "Search Credential" moved from "app's secret store" to "companion-service
  stack configuration".

## R-3: Browser → container connectivity — same-origin proxy via the Mayon server

**Decision**: The companion container is **internal-only** (no host port). The Mayon
server gains a streaming reverse-proxy route `ALL /api/brave-search/*` → upstream
(`BRAVE_SEARCH_URL`, default `http://brave-search:8080`), following the exact
implementation pattern of `server/src/llm-proxy.ts` (hijack reply, strip hop-by-hop
headers, pipe the web stream both for JSON and SSE responses).

**Rationale**:

- The request path browser → web nginx `/api/` (prod) or Vite proxy `/api` (dev,
  `vite.config.ts`) → Mayon server → container is already established for every other
  server feature; the browser stays 100% same-origin.
- Same-origin sidesteps **all** of the official server's browser-facing guards
  (`BRAVE_MCP_ALLOWED_ORIGINS` 403s, CORS, `Access-Control-Expose-Headers` for
  `mcp-session-id`) because the server→container hop carries no browser `Origin`.
- No new host ports (prod 8080 / dev 5173 stay the only ingress), matching the topology
  invariants in AGENTS.md.
- Streaming must not buffer: MCP streamable-HTTP responses may be `application/json` or
  `text/event-stream`; the llm-proxy pipe pattern handles both.

**Alternatives considered**:

- _Direct browser → published host port_: cross-origin fetch, needs the container's
  origin allowlist configured per deployment origin (breaks LAN-IP/domain access),
  CORS headers uncertain, and opens an unauthenticated search endpoint on the host.
  Rejected.
- _Proxy through web nginx_: nginx conf is baked into the prebuilt web image; changing it
  requires an image release for every routing tweak. The server route is env-driven.
  Rejected.

## R-4: Capability gating — new `brave-search` ServerCap

**Decision**: `ServerCap` (packages/shared/src/protocol.ts) gains `'brave-search'`. The
server advertises it in `/api/health` **iff** `BRAVE_SEARCH_URL` is set, and registers
the proxy route only then (unset → no cap, route returns 404 as today). The app template
"Brave Search (self-hosted)" is only offered when `serverStatus.has('brave-search')`,
with guidance text otherwise — mirroring the `stdio-mcp` gating pattern
(`McpServers.svelte` `isTemplateAvailable`, `client-factory.ts`).

**Rationale**: Constitution Principle III (progressive enhancement from advertised
capabilities; UI must not assume services). Unset env = feature entirely invisible, zero
impact when the companion is not deployed (spec US1 scenario 2, FR-006/FR-008).

## R-5: Connection config — relative same-origin URL

**Decision**: The new template instantiates an `McpServerConfig` with
`transport: 'http'`, `url: '/api/brave-search/mcp'` (root-relative), no headers, no env.
`HttpMcpTransport` is extended to accept root-relative URLs (relax the `^https?://`
guard in `start()`; `fetch` already resolves relative URLs against the page origin).

**Rationale**: A relative URL makes the stored connection config **portable across every
origin the stack is served from** (localhost:8080, LAN IP, reverse-proxied domain) — the
same config works everywhere, no per-deployment editing. Same-origin by construction
also keeps the existing cross-origin `mcp-session-id` warning path from ever applying.
The existing "Custom HTTP" template remains for absolute URLs.

**Verify at implementation**: the official server's HTTP endpoint path (expected `/mcp`
per MCP SDK convention; the community package documents `/mcp` on its port). The proxy
forwards the full path suffix, so only the template's suffix must match — confirm with
one curl during implementation (see quickstart.md).

## R-6: Citations — derived from already-persisted tool-result metadata

**Decision**: No schema change. MCP tool results are already persisted
(`messages` rows, role `tool`, `content` = summary, `metadata` = JSON
`{ serverId, toolName, content: McpContent[] }` — see `mount.ts` and
`messagesRepo.appendToolResult`). A pure extractor (`src/lib/mcp/sources.ts`) parses the
persisted MCP content items (Brave tools return JSON-in-text result lists containing
`title`/`url` fields), producing `{ title, url }[]`; a small `ToolSources.svelte`
renders them as external links under the tool row in `MessageRow.svelte`. Old messages
gain citations retroactively.

**Rationale**: FR-004/SC-003 with zero migrations and zero persistence changes. Brave's
v2.x web/image/video/news/local tools all return result objects with `url` (v2 migration
notes: image results now return URLs, not base64).

**Alternatives considered**: persisting a first-class `citations` table — rejected (new
migration, duplication of data already in `metadata`, and re-contextualization already
ignores metadata so there is no consumer besides the UI).

## R-7: Compose topology — opt-in via profile, pinned base image

**Decision**: Add a `brave-search` service to **both** compose files under
`profiles: ['brave-search']` (opt-in: `docker compose --profile brave-search up -d`, or
`COMPOSE_PROFILES=brave-search`), internal-only, `restart: unless-stopped`, same network.
Image strategy: pinned `node:22-alpine` running
`npx -y @brave/brave-search-mcp-server@<pinned-version> --transport http --host 0.0.0.0`
with an image override variable for users preferring `docker.io/mcp/brave-search`.
Server-side env: `BRAVE_SEARCH_URL: ${BRAVE_SEARCH_URL:-}` (empty = cap off).

**Rationale**:

- Profiles keep the service strictly optional — `docker compose up` / `pnpm dev`
  behavior is byte-for-byte unchanged when the user hasn't opted in (FR-005, FR-006).
- npm version pinning gives reproducible upgrades (`@2.x.y`) without tracking a third
  Docker Hub tag; the base image can be digest-pinned. Precedent: the server container
  already npx-spawns this exact package for the stdio template.
- Dev/prod parity: identical service definition in both files (FR-008); the proxy makes
  the server code identical across stacks, same as the `db` hostname pattern.

## R-8: Failure modes and degradation mapping

**Decision**: Rely on existing machinery; no new failure paths.

- _Unreachable/timing out_: `HttpMcpTransport` aborts at `callTimeoutMs` (default 30 s);
  mount-level failures already degrade to `{ ok: false, summary }` tool results, the
  agent loop continues, and the turn completes (FR-006/SC-005). Recovery is automatic on
  the next turn (transports are per-turn).
- _Invalid/expired key or quota/rate limit_: Brave API errors surface as tool-call error
  content — visible in the tool row and to the model (FR-007).
- _Cap off_: template hidden with guidance (US1 scenario 2).

**Open items for implementation** (not blockers): confirm exact upstream endpoint path
(R-5); decide whether `testConnection` should additionally fire a 1-query live probe for
key validation (optional nicety, not required by the amended spec).

## R-9: Revision — credential custody returns to the app keystore (2026-08-19)

**Decision**: After shipping the companion-container path (R-1…R-8), the user revised
the requirement: all credentials must live in one place — the web app's existing secret
store — for a consistent user experience. The connection now uses the app's existing
stdio MCP machinery: the official `@brave/brave-search-mcp-server` (pinned) is spawned
by the Mayon server per session with `BRAVE_API_KEY` injected from the browser keystore
at spawn time (`ServerStdioMcpTransport` already does exactly this for the GitHub
template). This is constitution-native custody (Principle I: API keys live in IndexedDB).

**Rationale**:

- The official server accepts the key only at process startup — for a spawned stdio
  child, spawn time IS startup, so the keystore→env injection satisfies the constraint
  without any wrapper.
- Credential UX becomes identical to every other credentialed MCP server: add → enter
  key in app → trust. No `.env`, no compose profile, no stack reconfiguration; key
  rotation applies on the next turn with zero restarts.
- Cost accepted: per-session spawn (~1–3 s while enabled; first use downloads the
  pinned package inside the server container). A long-lived server-hosted bridge was
  evaluated (best latency, most new server code) and deferred as a possible future
  optimization — migration would be invisible to users.

**Container path removed** (user decision, same date): the `brave-search` compose
service, the `/api/brave-search/*` proxy route, the `brave-search` server capability,
and the self-hosted HTTP template are reverted. Retained from the container iteration:
the citations extractor/UI (transport-agnostic), degradation/recovery tests, and
root-relative URL support in `HttpMcpTransport` (general capability, still tested).
`contracts/server-capability-and-proxy.md` was deleted with the path it described.

**Supersedes**: R-2's custody amendment (FR-002 reverted to keystore custody), R-3/R-4
(proxy + cap), and R-7 (compose topology). R-1's package research (v2.x, transports,
startup-only key) remains the basis; R-5's endpoint finding (`/mcp` confirmed live)
documented the now-removed path; R-6/R-8 stand unchanged.
