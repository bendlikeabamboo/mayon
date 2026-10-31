# Research: Optional Telemetry (Langfuse First)

Phase 0 output for [spec.md](./spec.md). Each entry: decision, rationale, alternatives considered.
Codebase facts are cited from the three exploration reports (agent loop, storage, server patterns).

## D1 — Capture tap point: the client-side agent trace seam

**Decision**: Capture LLM interactions in the web app at the existing trace seam — `runAgentTurn`/`consumeStream` in `src/lib/agent/loop.ts` and the `TraceBuilder` events feeding `src/lib/stores/chat.svelte.ts` — extended so side generators (title, brief, quiz, grading, lab, branch summary, MCP sampling) emit the same normalized record.

**Rationale**: This is the only place where the provider-agnostic record the spec requires already exists: input (system+messages), output (accumulated `receivedText`/persisted final text), usage (`finish` stream part, persisted via `repos.messages.recordUsage`), duration, outcome (error/abort events), model id, and `chatId`/assistant-message id for session linkage. It is provider-agnostic (works for openai-compatible, anthropic, gemini, copilot, **and Ollama/loopback**, which never touch the server) and upstream of all wire-format differences.

**Alternatives considered**:
- *Server proxy tap* (`server/src/llm-proxy.ts`): rejected — it is a byte pipe with zero app identifiers on the wire (`LlmProxyRequest` carries only url/method/headers/body, `packages/shared/src/protocol.ts:45-50`); recovering output/usage would require per-dialect SSE parsing server-side; structurally blind to Ollama, loopback, and any browser-direct traffic. This also corrects the spec's original "LLM calls do not happen there anyway" assumption (spec edge case amended).
- *Wire-level client tap* (`getLlmFetch`, `src/lib/services/llm-proxy-fetch.ts:40-45`): rejected as primary — sees raw per-dialect bodies, would need SSE re-parsing, and has no conversation context. Noted as a complement if raw wire capture is ever wanted.

## D2 — Delivery topology: browser capture → same-origin server relay → Langfuse

**Decision**: The browser finalizes records and POSTs them to a new same-origin endpoint (`POST /api/telemetry/events`); a server-side background pipeline (bounded queue, interval flush, backoff) delivers to the configured Langfuse.

**Rationale**: (1) Langfuse ingestion requires the secret key on every call — keeping it server-side matches the deployment-owner secret pattern and keeps it out of the SPA entirely. (2) Same-origin relay inherits the existing auth gate (session + CSRF, `server/src/auth/gate.ts`) with zero new exposure. (3) Background batching, retry, and queue bounding belong where a process is long-lived — the server — satisfying FR-007 non-blocking and the bounded-queue edge case. (4) The app runtime already requires the server (boot gates on the `pg` cap), so relay-via-server loses no coverage.

**Alternatives considered**: *Browser → Langfuse direct* (credentials in IndexedDB like provider keys): rejected — cross-origin from a static SPA to arbitrary hosts is fragile (CORS on the owner's Langfuse is not guaranteed), the secret key would ride in browser memory permanently, and background delivery with retry/backoff cannot be reliable from a tab. *Server-only capture*: impossible per D1 (server never sees identifiers or browser-direct traffic).

## D3 — Langfuse client: minimal typed ingestion client, no SDK dependency

**Decision**: Hand-rolled small client in `server/src/telemetry-ingest.ts` over Langfuse's public batch ingestion endpoint (`POST /api/public/ingestion`, Basic `pk:sk`), using global `fetch` per the `llm-proxy.ts` upstream idiom. Contract in [contracts/langfuse-ingestion.md](./contracts/langfuse-ingestion.md).

**Rationale**: Mayon ships pre-shaped records — it does not instrument an application with spans, which is what the official SDK's value (OTel wiring, drop-in wrappers, span processors) exists for. The ingestion API is a stable, simple JSON batch endpoint; a ~150-line client with the codebase's existing batching/backoff idioms (MCP lazy purge, copilot in-flight maps) avoids importing the OpenTelemetry dependency tree into `@mayon/server` and keeps constitution IV (justified dependencies) clean.

**Alternatives considered**: *Official `langfuse-js` / `@langfuse/otel` SDK server-side*: rejected for dependency weight and unused machinery (we have no spans to process); revisit only if Langfuse adds a capability the raw API cannot express (e.g., prompt management pull — out of scope v1, see D8).

## D4 — Config storage: settings KV row (non-secret) + env secret

**Decision**: One `telemetry` row in the existing `settings` KV via `settingsRepo` holding `{ enabled, host, publicKey, captureMode }` — no secrets. The Langfuse secret key is read from `MAYON_LANGFUSE_SECRET_KEY` (compose `environment:` sourced from the owner's `.env`), exactly the `MAYON_AUTH_SECRET` precedent (`server/src/server.ts:156-162`). Server reads the config row with the `getSecurityMode` 5s-TTL direct-read precedent.

**Rationale**: Constitution I ("no secrets in `settings`") is satisfied without extending the encrypted-carve-out; the owner secret flow (edit `.env` next to compose file) is already established by the Caddy basic-auth floor. Zero drizzle migration: the settings KV is schemaless rows, so no `pnpm db:generate`, no schemaVersion bump, and backups/restore carry config automatically.

**Alternatives considered**: *Encrypted in PG via `wrapSecret`* (web-UI-entered secret, `server/src/auth/crypto.ts:30-55`): rejected for v1 — extends the sanctioned auth carve-out to a new feature for UX convenience only; the `.env` flow matches how owners already configure deployment secrets. Can be revisited later without contract changes (config API stays the same). *File on `/data` volume*: rejected — less discoverable than `.env`, no precedent advantage over env.

## D5 — Config mutations through a server route (atomic disable)

**Decision**: All telemetry config changes go through `PUT /api/telemetry/config` (validated + applied server-side), not direct `settingsRepo` writes from the web. On disable, the route synchronously drops the server queue. The web UI calls this route; boot reads config through the normal settings seam.

**Rationale**: FR-003 (disable immediate, queued records discarded) must be deterministic. If the web wrote the row directly, the server would only notice via TTL cache and could flush a batch after disable. Routing the mutation through the server makes validate (D6) + persist + queue-drop one atomic act, and matches the `security.mode` server-written-row precedent.

**Alternatives considered**: *Direct `settingsRepo` write + server TTL invalidation*: rejected — 5s window of zombie flush violates the acceptance scenario.

## D6 — Validation probe: authenticated ping on save

**Decision**: `PUT /api/telemetry/config` (when enabling) probes the destination with an authenticated lightweight GET (`GET {host}/api/public/projects`) using `publicKey:secretKey`; failure returns the specific reason (unreachable vs rejected) per FR-004, and the destination is not marked active.

**Rationale**: Cheap, side-effect-free, uses the same auth pair as ingestion; distinguishes the two failure classes the spec names. Runs server-side so the secret never transits the browser.

**Alternatives considered**: *Send a synthetic first trace as probe*: rejected — writes an unwanted record into the owner's project. *Client-side probe*: rejected — would expose the secret key to the browser.

## D7 — Trace mapping: one trace per turn, generation inside, session = conversation

**Decision**: Each captured interaction becomes one Langfuse trace carrying one `generation` observation: chat turns as `name: "chat-turn"` with full message list as input and final text as output; side generators as their own traces (`name: "title" | "brief" | "quiz" | "grading" | "lab" | "branch-summary" | "mcp-sampling"`), all tagged. `sessionId` = Mayon `chatId`; tags include kind, provider kind, capture mode; metadata includes model id, app name/version. Usage maps to `{input, output, total}` when the provider reported it. Full mapping table in [contracts/langfuse-ingestion.md](./contracts/langfuse-ingestion.md).

**Rationale**: Matches Langfuse's model (trace = one end-to-end interaction; generation = one LLM call with model/usage/cost) and delivers SC-006 (find a conversation, follow it end-to-end via session grouping) and FR-012 (fidelity for dataset-building: Langfuse's "add trace to dataset" works on complete input/output pairs).

**Alternatives considered**: *One trace per conversation with nested generations*: rejected — Langfuse traces are per-interaction; multi-turn nesting hides per-turn cost/latency in the observations table. *Emitting only generations without trace wrappers*: rejected — session grouping and dataset promotion hang off traces.

## D8 — Scope boundary: export-only, no Langfuse feature pull

**Decision**: v1 emits traces only. No prompt management pull (Mayon keeps owning its prompts), no score/annotation push, no dataset read-back. Standing decision `prompt_eval_decoupled_from_app` governs: evaluation and prompt iteration happen in Langfuse on the exported traces.

**Rationale**: FR-012 and the spec's assumptions; Mayon must not grow an evaluation surface.

**Alternatives considered**: *Score push (user feedback as Langfuse scores)*: deferred — no feedback signal exists in Mayon today to push. *Prompt management integration*: explicitly out (would invert prompt ownership).

## D9 — Capture-mode enforcement and queue semantics

**Decision**: Capture mode (`content` | `metadata`) is applied **in the browser at record assembly**: metadata mode omits input/output/message bodies from the record before it is POSTed to the relay (so content never even reaches the local server queue). Relay buffer: ≤50 records / ≤5s window, drop-oldest, dropped on disable. Server queue: ≤500 records, drop-oldest; flush every ≤5s or ≤20 records; exponential backoff on delivery failure (cap 60s); best-effort flush on shutdown; per-field content cap ~128 KiB with a truncation marker. Disable drops both queue and buffer (D5).

**Rationale**: FR-009's strictest reading ("removed before the record leaves the deployment") is satisfied at the earliest boundary; bounded queues prevent unbounded memory during outages (spec edge case) without timers in the browser; the drop-oldest + backoff combo matches existing server idioms (MCP child caps, lazy purge).

**Alternatives considered**: *Strip server-side at flush time*: rejected — content would sit in the server queue contradicting the "finalized before leaving" acceptance scenario. *Persistent queue on disk*: rejected — over-engineering for a single-user deployment; the chat itself is already durable in Postgres, telemetry loss on restart is acceptable and documented.
