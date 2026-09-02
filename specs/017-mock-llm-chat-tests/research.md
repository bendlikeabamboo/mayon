# Research: Mock-LLM Chat Test Suite

Phase 0 output. All facts verified against the worktree code, 2026-09-02. File:line
references are to the repo root.

## D1 — Mock implementation: tests-owned Node fixture, not an off-the-shelf image

**Decision**: Build `tests/fixtures/mock-llm/server.mjs` — a dependency-free
`node:http` server (~100 lines) speaking the OpenAI chat-completions protocol.

**Rationale**: Protocol fidelity is the acceptance bar (spec FR-002), and the app's
exact expectations are unusually specific and verified (see Wire Protocol below): a
`finish_reason` chunk is mandatory, `[DONE]` is optional, non-stream JSON must coexist
with SSE on the same endpoint, and `/models` needs only a tolerant shape. Off-the-shelf
mock containers (e.g. wiremock-class images, openai-mock images) would add supply-chain
weight, image-version drift, and configuration indirection to satisfy contract points
we can express in ~100 lines of plain Node. The repo already owns the
tests-owned-stub pattern (`tests/fixtures/stub-mcp-server.mjs`, spawned by
`server/src/mcp.test.ts:8-10`), and the winning card anticipated exactly this:
"may end up as a ~20-line custom fixture owned by tests"
(`ideas/004-automated-chat-testing/cards/stock-mock-server.md:19`).

**Alternatives considered**:
- Off-the-shelf OpenAI-mock container — rejected: protocol-fidelity control is weaker
  than the fixture, adds third-party flake/supply chain the decision explicitly priced
  at zero.
- In-Vitest-launched mock process only (no compose service) — rejected: the fetch
  executes inside the `server` container (see D5), so the mock must be reachable from
  the docker network, not just from the host.

## D2 — Compose placement: service in `docker-compose.dev.yml`

**Decision**: Add `mock-llm` as a sibling service in `docker-compose.dev.yml`
(mounts `./tests/fixtures/mock-llm`, runs `node server.mjs`, `expose:`-only — no host
port — with a TCP healthcheck and `depends_on` used by nothing initially).

**Rationale**: `docker-compose.dev.yml` is the only all-containerized stack (web+server+db),
which is the topology the round trip must exercise (spec Assumptions). No compose file
declares `networks:`, so every service shares the project default network and is
reachable by service-name hostname — exactly how `server` reaches `db:5432`
(`docker-compose.dev.yml:43`). A new service therefore needs zero network plumbing.
Expose-only matches the `server`/`db` precedent and enforces the constraint that the
browser never talks to the mock directly. The service is inert in normal dev use
(nobody points a provider at it unless a test onboards one), so it does not disturb
`pnpm dev`.

**Alternatives considered**:
- Dedicated `docker-compose.e2e.yml` duplicating the dev stack — rejected: duplication
  drifts; the dev stack already is the test stack.
- Host-run mock with a host port — rejected: the server container could not reach
  `host.docker.internal` portably (engine-dependent), and exposing the mock to the
  host invites the browser/tests bypassing the real request path.

## D3 — Onboarding template: "LiteLLM (self-hosted)" (discoverable), base URL edited to the mock

**Decision**: The suite onboards via the LiteLLM (self-hosted) template
(`src/lib/ai/registry.ts:126-137`, `discoverable: true`), then edits Base URL to
`http://mock-llm:<port>/v1` and Default model to the mock's model id, saves a
placeholder key, and sets the provider active.

**Rationale**: `discoverable: true` makes the UI call `GET {baseUrl}/models`
automatically on add and on "Save key" (`ProviderConfig.svelte:154-175, 195-221`), so
the round trip exercises model discovery through the proxy in addition to chat —
breadth for free. Discovery is best-effort (failure keeps the stored list), so it can
never flake the suite. The template's Base URL/Default model fields are plain inputs
(`ProviderConfig.svelte:532-569`), so pointing it anywhere is real user interaction.

**Alternatives considered**:
- "OpenAI" template (non-discoverable, manual comma-separated models) — kept as
  fallback; simpler but skips `/models` coverage.
- Any route that seeds provider config/keys directly — rejected: violates FR-004/SC-006
  (must traverse the real add-provider flow and real IndexedDB key path).

## D4 — Runner topology: Playwright on host/runner against `http://localhost:5173`

**Decision**: `@playwright/test` as a root devDependency; `playwright.config.ts` at
repo root with `baseURL: http://localhost:5173`; the suite assumes the compose stack is
up (`pnpm dev:up`) and owns no server lifecycle of its own in dev. In CI, the new `e2e`
job brings the stack up before running the suite.

**Rationale**: The browser-only surface is the SPA at :5173 (Vite proxies `/api` →
`server:4319`, `vite.config.ts:32-35`); Playwright never needs to reach the mock or the
server directly, so containerizing Playwright buys nothing and costs complexity
(browser-image builds, volume mounts, artifact plumbing). The dev `web` container
binds-mounts `./src`, so no image rebuild is needed per run.

**Alternatives considered**:
- Playwright inside compose — rejected: artifact/video tracing and reporting get
  harder; no benefit since all provider traffic already transits the server container.
- Vitest browser mode — rejected: the feature is E2E flows (settings → chat → render),
  not component tests; Playwright is the decided tool (spec input, decision record).

## D5 — Request-path fact: every provider request executes inside the `server` container

**Decision** (verified, constrains D1/D2): with the server up, `getLlmFetch()` returns
the proxying fetch whenever the server advertises `llm-proxy` — unconditional in
`BASE_CAPS` (`server/src/server.ts:30`). The client POSTs `{url, method, headers, body}`
to same-origin `/api/llm/proxy` (`src/lib/services/llm-proxy-fetch.ts:21-26,35-40`); the
server validates only that `body.url` is http(s) — **no allowlist**
(`server/src/llm-proxy.ts:23-39`) — and streams the upstream response back
(hop-by-hop headers stripped, `x-accel-buffering: no`, `server/src/llm-proxy.ts:5-11,56-64`).
Model discovery uses the same transport (`src/lib/ai/model-discovery.ts:54-76`).

**Implication**: the mock's base URL (`http://mock-llm:<port>/v1`) must resolve inside
the server container; the browser only ever talks same-origin. This is why the mock
must be a compose service (D2) and why host-run mocks were rejected.

## D6 — Kitchen-sink fixture: one markdown document, alignment-safe, chunked for SSE

**Decision**: Author `tests/fixtures/mock-llm/kitchen-sink.md` as the single reply
body, covering: headings, lists, tables, blockquotes, links, inline + display math
(KaTeX), a mermaid fenced block, code blocks (multi-language) with copy affordance, and
plain prose spans shaped for expound alignment (stable, non-trivial offsets). The mock
streams it as multiple content deltas; non-stream calls (title, brief) return plain
prose from the same document.

**Rationale**: One deterministic body serves every P2 assertion with known content at
known offsets (spec Key Entity). Renderer facts verified: markdown pipeline is
remark-parse → gfm → remark-math → rehype-katex → rehype-highlight → admonition →
rehype-sanitize (`src/lib/markdown/render.ts:66-97`); copy buttons are injected per
`<pre>` as `.md-copy-btn` (`Markdown.svelte:96-113`); mermaid fences survive as
`code.language-mermaid` and are lazily swapped for SVG (`Markdown.svelte:31-71`);
alignment excludes injected chrome via `EXCLUDED_CHROME_SELECTORS`
(`src/lib/chat/selection.ts:27-36`). The fixture must avoid content that would confuse
alignment (e.g. HTML passthrough) and stay within the sanitize schema.

**Accepted drift** (per spec Assumptions): new renderer capabilities do not appear in
the fixture automatically; extending it is manual maintenance, and any new injected
chrome must be added to `EXCLUDED_CHROME_SELECTORS` (existing repo constraint,
corrections memory `expound_alignment_excluded_selectors`).

## D7 — First-turn concurrency: the mock must answer three concurrent POSTs

**Decision** (verified, constrains D1): on a fresh root chat's first message the app
fires up to three concurrent `POST /chat/completions`: the main SSE turn
(`streamText`, `src/lib/agent/loop.ts:320-330`), a title call (`generateText`,
`src/lib/ai/generate/generate-title.ts:47-55`), and a brief-inference call
(`generateText` with a `json` tool, `src/lib/ai/generate/object-tool.ts:38`), triggered
from `chat.svelte.ts:359-367`. Title/brief failures are swallowed
(`chat.svelte.ts:745-746, 989-990`), but answering all three keeps the suite honest and
fast. The mock must therefore handle concurrent requests and branch on the presence of
`stream: true` (SSE) vs its absence (single JSON).

## Wire protocol the mock must satisfy (verified against pinned deps)

Base URL example: `http://mock-llm:9999/v1` (server-side reachability required).

1. **`POST {base}/chat/completions` with `stream: true`** → `200`,
   `content-type: text/event-stream`, body:
   ```
   data: {"id":"c1","model":"<model>","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}
   data: {"id":"c1","choices":[{"delta":{"content":"…chunk…"},"finish_reason":null}]}
   data: {"id":"c1","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}
   data: [DONE]
   ```
   Client parsing runs the body through `EventSourceParserStream` (content-type not
   strictly validated); a chunk with `choices[0].finish_reason` is **required** or the
   SDK raises "Response stream ended without a finish reason"; `data: [DONE]` is
   explicitly ignored. No `stream_options`, no `reasoning_effort` at default effort
   (`src/lib/ai/dialects.ts:103-113,399-434`); no `tools` for a non-allowlisted base
   URL (`src/lib/agent/capability.ts:3-24,44-56`) — except the brief call's `json`
   tool, which the mock may ignore.
2. **`POST {base}/chat/completions` without `stream`** → `200`, JSON:
   `{"id":"c1","model":"…","choices":[{"message":{"role":"assistant","content":"<plain text>"},"finish_reason":"stop"}],"usage":{…}}`.
   Title/brief failures are swallowed, but a correct reply is cheap and deterministic.
3. **`GET {base}/models`** (only for discoverable templates) → `200`, JSON:
   `{"data":[{"id":"mock-sink","object":"model"}]}` — bare arrays and `type:"embedding"`
   filtering also supported client-side (`src/lib/ai/model-discovery.ts:35-37,134-166`).
4. **Auth**: requests arrive via the proxy with `Authorization: Bearer <placeholder>`
   (injected by `createKeychainFetch`, `src/lib/ai/sdk-fetch.ts:16-41`). The mock may
   ignore it. A key is mandatory client-side regardless (`kindRequiresKey`,
   `src/lib/ai/client.ts:74-76,108-110`) — hence the placeholder through the real
   IndexedDB path.

## Other resolved facts

- **No auth gates exist** (verified): no login/signup routes, no security-setup prompt,
  no route guards in shipped code — the secure-public-launch work is decision-only
  (`ideas/002-secure-public-launch/`). The only fresh-profile gate is the BootGate
  spinner until `/api/health` advertises `pg`; the suite must simply wait for boot
  (`src/routes/+layout.svelte:20-44`). If in-app auth lands later (decided for public
  launch), the suite grows a setup step then — out of scope now.
- **Playwright absent**: no `@playwright/test`, no `playwright.config.*`, no e2e dir,
  no CI browser job (`.github/workflows/ci.yml` single `web` job via
  `.github/actions/ci/action.yml`, which does build both Docker images — Docker is
  available on the runner). Gap confirmed; the new `e2e` job slots in as a sibling.
- **No existing kitchen-sink document**: markdown tests use small inline snippets
  (`src/lib/markdown/*.test.ts`); the fixture must be authored fresh (D6).
