# Quickstart Validation Results — G7/T017 (manual scenarios 1–4)

**Date**: 2026-10-07 · **Validator**: automated browser run (playwright-cli, Chromium) against the live dev stack
**Worktree**: `/home/hawitsu/projects/mayon/.kilo/worktrees/towering-cherry` · **Commit**: `b173cfa` (branch `show-remaining-llm-context`) with the 024 implementation present as the uncommitted working tree (not committed per task constraints)
**Stack**: the already-running compose project `mayon-dev` (web :5173 Vite HMR with this worktree's `src/` volume-mounted — verified by fetching `/src/lib/components/ai/model-select/model-select.svelte` and `/src/lib/chat/context-usage.ts` from Vite and finding the 024 code; server v0.8.1 · db ready; the compose `mock-llm` service was up but **not used** — its `/v1/models` carries no context fields). Shared dev DB retains 023-era providers (LiteLLM/T021-Alt, a real Z.AI card) — all left untouched.
**Auth**: first-boot security gate skipped.

## Provider under test (instead of OpenRouter)

The quickstart's Scenario 1 names OpenRouter; per the task plan a **local stub** replaced it (no API key / external calls needed). Node HTTP stub, `/tmp/kilo/stub-024/server.mjs`, loopback `127.0.0.1:8901`:

- `GET /v1/models` → re-reads `models.json` per request: `{ data: [ {id:'stub-mini', context_length:128000}, {id:'stub-large', context_length:1000000}, {id:'stub-none'} ] }` (initial values). CORS `*` so the browser can fetch it direct.
- `POST /v1/chat/completions` → minimal SSE stream (or plain JSON), always `usage: {prompt_tokens:1, completion_tokens:1, total_tokens:2}` — same frame shapes as `tests/fixtures/mock-llm/server.mjs`. Accepts any request (no tool-kind classification), so Tool capability stayed **Enabled**.
- Failure levers: a `fail.flag` file → `/v1/models` returns HTTP 500; stopping the process → connection refused.

App-side: provider added from the **LM Studio (local)** template (openai-compatible, `requiresKey:false`, `discoverable`, group `local` — so no background discovery; every capture below is an explicit ⟳/Test action), renamed **Stub024**, Base URL edited to `http://localhost:8901/v1`, set active. Note the app fetches loopback `/models` **browser-direct** (per `llm-proxy-fetch.ts` loopback rule) — the network log shows `GET http://localhost:8901/v1/models => 200` straight from the page; chat traffic likewise goes direct.

## Outcome table

| Scenario | Expectation (quickstart.md) | Actual | Verdict |
|---|---|---|---|
| 1. Capture & zero-config gauge | ⟳ harvests windows; gauge shows `used / limit (pct)`, popover Window attributed to **provider model listing**; nothing typed | ⟳ → `Found 3 models.` (status first read "Saved model '' is no longer offered — pick another." because `defaultModel` was still empty — FR-011 pointer, expected pre-pick). Picker rows: `stub-mini 128K`, `stub-large 1M`, `stub-none` (no hint). New chat pre-send: `~0 / 128.0k (0%) est.`, `data-state="normal"`, popover Window **"128.0k · provider model listing"**. After one Send: `2 / 128.0k (0%)`, `data-provenance="reported"`, popover Used 2 · Window "128.0k · provider model listing". No manual entry anywhere | **PASS** |
| 2. Unknown + override | no-context model → `window unknown`, no invented limit; declared 200000 wins, attributed to provider card; clear → ladder re-applies | Default → `stub-none` (picker row renders **no hint**): gauge `~0 · window unknown est.`, `data-state="no-limit"`; popover Window: `unknown — set "Context window" on the provider card`. Card **Context window = 200000**: `~0 / 200.0k (0%) est.`, popover **"200.0k · declared on provider card"**. Declared-beats-listed proven directly: with default `stub-mini` (listed 128000) + declared 200000, gauge `2 / 200.0k (0%)` reported, popover "declared on provider card". Clearing the field: stub-mini chat returns to `2 / 128.0k (0%)` (listing resumes); unknown branch re-verified on stub-none | **PASS** |
| 3. Freshness | changed listing + ⟳ → new number everywhere; broken endpoint + ⟳ → fetch error **and** previous value retained | Edited stub `stub-mini` 128000 → 64000, struck ⟳ → "Found 3 models."; picker `stub-mini 64K` (title "64000 tokens"), gauge `2 / 64.0k (0%)`. `fail.flag` (HTTP 500) + ⟳ → status `Discovery failed: Provider returned HTTP 500: {"error":{"message":"stub forced failure","type":"server_error"}}`, picker **still 64K**, gauge **still 64.0k**. Stopped the stub (connection refused) + ⟳ → `Discovery failed: The provider blocked this browser request (CORS).` (typed fetch-error classification), picker **still 64K / 1M** | **PASS** |
| 4. Picker display | muted per-row hint (`128K`); exact count on hover; no hint without a captured value | Hint span class `text-[11px] text-muted-foreground` beside the name: `128K` (pre-refresh, title **"128000 tokens"**) and `64K` (post-refresh, title **"64000 tokens"**), `1M` (title **"1000000 tokens"**); `stub-none` renders **no hint**. Verified on the settings card picker (the only picker bound to `modelContextWindows` — the chat status row shows `Provider · model` text only, no picker) | **PASS** |

## Evidence (DOM reads + screenshots)

- S1 pre-send gauge: `{"txt":"~0 / 128.0k (0%) est.","ds":"normal","dp":"estimated"}`; popover text `Used 0 est. Window 128.0k · provider model listing estimated from context size`.
- S1 post-send gauge: `{"gauge":"2 / 128.0k (0%)","ds":"normal","dp":"reported"}`; popover `Window 128.0k · provider model listing`.
- S2 unknown: `{"gauge":"~0 · window unknown est.","ds":"no-limit","dp":"estimated"}`; hover title `estimated from context size — set "Context window" on the provider settings card to show the limit`; popover Window `unknown — set "Context window" on the provider card`.
- S2 override: `{"gauge":"~0 / 200.0k (0%) est.","ds":"normal"}`; popover `Window 200.0k · declared on provider card`. Declared-beats-listed: `{"gauge":"2 / 200.0k (0%)","ds":"normal","dp":"reported"}` on the stub-mini chat.
- S2 cleared: `{"chat":"stub-mini","gauge":"2 / 128.0k (0%)","ds":"normal"}`.
- S3 after refresh: picker options `[stub-large 1M (title 1000000 tokens), stub-mini 64K (title 64000 tokens), stub-none (no title)]`; gauge `{"gauge":"2 / 64.0k (0%)"}`. After 500: status string above; options unchanged. After refused: options unchanged.
- S4 hint spans: `{"label":"1M","title":"1000000 tokens","cls":"shrink-0 text-[11px] text-muted-foreground"}`, `{"label":"64K","title":"64000 tokens","cls":same}`, `stub-none` → `hint: []`.

Screenshots (all under `specs/024-model-context-length/checklists/`):

- `t024-1-card.png` — Stub024 card after ⟳ capture (default stub-mini)
- `t024-1-gauge-est-popover.png` — pre-send `~0 / 128.0k (0%) est.` + popover (provider model listing)
- `t024-1-reported-popover.png` — post-send `2 / 128.0k (0%)` + popover
- `t024-2-window-unknown.png` — stub-none chat, `window unknown`
- `t024-2-unknown-popover.png` — popover `unknown — set "Context window" on the provider card`
- `t024-2-override-popover.png` — stub-none chat with declared 200000
- `t024-2-declared-beats-listed.png` — stub-mini chat: `2 / 200.0k` declared over listed 128.0k
- `t024-2-cleared-fallback.png` — cleared field, listing resumed
- `t024-3-picker-after-refresh.png` — picker showing 64K after stub edit
- `t024-3-gauge-64k.png` — gauge `2 / 64.0k (0%)`
- `t024-3-refresh-error-retained.png` — 500 status + retained hints
- `t024-3-refused-retained.png` — refused-connection refresh, retained hints
- `t024-4-picker-128k.png` — picker pre-refresh (128K/1M/no-hint)
- `t024-4-picker-hints.png` — picker post-refresh (64K/1M/no-hint)

## Findings (non-blocking)

1. **No product fixes were needed.** All scenarios passed against the working tree as-is; no source edits were made.
2. **Stale-element click artifact (automation, not product).** One ⟳ click immediately after editing the name/base-URL fields made no `/v1/models` request and changed nothing; the immediate retry worked. Attributed to the playwright ref going stale across the re-render, not to `refreshModels` (subsequent refreshes, including success/error/retention paths, were deterministic). Not reproducible as a product defect.
3. **Chat send affordance.** The composer sends on ⌘/Ctrl+Enter or the **Send** button; a plain Enter is a newline. Automation initially "sent" nothing until the Send button was clicked — operator note only.
4. **Picker scope.** `modelContextWindows` hints render in the settings card's model picker (`ModelSelect contextWindows`); the chat composer's status row (`Provider · model`) is text-only, so Scenario 4 is exercised from Settings. This matches the wiring (`ProviderConfig.svelte:602` is the only `contextWindows` consumer).
5. The HTTP-500 discovery failure surfaces the typed provider error verbatim; the connection-refused case classifies to the CORS-typed message (`The provider blocked this browser request (CORS).`) because loopback discovery is a browser-direct fetch. Message wording differs from a user-facing "endpoint unreachable" phrasing but is the existing shared classification, unchanged by 024.
6. Console: only one expected `ERR_CONNECTION_REFUSED @ http://localhost:8901/v1/models` from the deliberate refused-connection test; the two `/chats` 404s were a wrong navigation by the automation; otherwise 0 errors.

## Verdict

**Scenario 1 PASS · Scenario 2 PASS · Scenario 3 PASS · Scenario 4 PASS.** FR-001–FR-007 and FR-009's picker visibility validated live end-to-end: harvest (⟳ and via Test-connection path — Test not separately exercised; both call the same merge), merge/persistence (values survived full page reloads and new chats throughout), resolution ladder (declared > provider-listing > unknown), freshness with failure retention, and picker hints with exact hover counts.
