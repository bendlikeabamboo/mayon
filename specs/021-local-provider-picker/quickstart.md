# Quickstart: Validating the Local-First Grouped Provider Picker

**Feature**: `021-local-provider-picker`
Proves the spec end-to-end: grouped + searchable picker (US2), local runtime onboarding (US1), explicit tools assertion (US3), coached connection failures (US4). Design detail lives in [data-model.md](./data-model.md) and [contracts/](./contracts/); this file is a validation/run guide only.

## Prerequisites

```bash
pnpm install
pnpm --filter @mayon/shared build   # consumers resolve @mayon/shared types from dist/
pnpm dev                            # all-Docker stack: SPA :5173, server :4319, db
```

- For real-runtime scenarios: LM Studio (`lms server start` — note its **CORS off default**) or vLLM (`vllm serve <model>`) listening on the host's default ports.
- The automated scenarios need neither; they use the mock-LLM fixtures under `tests/e2e/fixtures/`.

## Automated gates (run first)

```bash
pnpm check                                   # svelte-check
pnpm lint                                    # ESLint + Prettier
pnpm test                                    # Vitest (pglite driver)

# targeted suites for this feature:
pnpm test -- src/lib/ai/registry.test.ts
pnpm test -- src/lib/agent/capability.test.ts
pnpm test -- src/lib/ai/connection-test.test.ts
pnpm test -- src/lib/ai/errors.test.ts
pnpm test -- src/lib/services/llm-proxy-fetch.test.ts

# browser flows (needs the dev stack up):
pnpm exec playwright test tests/e2e/onboard.spec.ts
pnpm exec playwright test tests/e2e/provider-picker.spec.ts
```

Expected: all green. `capability.test.ts` encodes the legacy-normalization table (FR-013 regression lock); `connection-test.test.ts` encodes the classification matrix; `provider-picker.spec.ts` covers groups, search, the tools toggle, and coached failure.

## Manual scenarios

### S1 — Grouped, searchable picker (US2 / SC-002, SC-003)

1. Open **Settings → Providers → Add provider**.
2. **Expect** four sections in order: Local (Ollama, LM Studio, vLLM), Cloud APIs (11 entries), Gateways (6 entries), Custom (empty description only).
3. Type `open` in the search box. **Expect** matches across groups (e.g. OpenAI under Cloud APIs, OpenRouter under Gateways) with non-matching groups hidden.
4. Type `zzz`. **Expect** the "no providers match" empty state; click **Clear search**. **Expect** the full grouped list restored, order unchanged.
5. **Expect** a "no key required" badge on LM Studio, vLLM, LiteLLM.

### S2 — Connect LM Studio with defaults (US1 / SC-001)

1. Start LM Studio on this machine with defaults (CORS **off** — the default) and at least one model loaded.
2. Settings → Providers → Add provider → **LM Studio (local)**. **Expect** base URL prefilled `http://localhost:1234/v1`, no API-key field.
3. Click **Test connection**. **Expect** failure classified as **cross-origin blocked** with the LM Studio-specific remedy (Developer toggle / `lms server start --cors`) — not a raw error.
4. Follow the remedy (enable CORS / restart with the flag), click **Test connection** again. **Expect** "Connection OK — N models found." and the model list populated; if no default model was chosen, the first discovered model is auto-selected.
5. Send a chat message through the provider. **Expect** a streaming reply with no key ever entered. Total time from opening Settings: well under 2 minutes.

### S3 — vLLM + edited address (US1 acceptance 3)

1. Serve vLLM on a non-default port (e.g. `--port 8010`).
2. Add **vLLM (local)**, edit the base URL to `http://localhost:8010/v1`, blur to commit, **Test connection**. **Expect** success against the edited address; reload the page and confirm the edited address persisted.

### S4 — Coached failures (US4 / SC-004)

1. With LM Studio **stopped**, add **LM Studio (local)** and **Test connection**. **Expect** "Server not running" (not the CORS message) — start-the-server remedy.
2. Point the base URL at a black-holed address (e.g. `http://10.255.255.1/v1`) and test. **Expect** a timeout classification within ~8 s with a check-address remedy.
3. Run a cloud template without a key and test. **Expect** "API key required" pointing at the key field.
4. (Optional) 404 check: drop `/v1` from an OpenAI-compatible base URL and test → "Endpoint not found" with the `/v1` hint.

### S5 — Explicit tools toggle (US3 / SC-005)

1. On the active provider card, find **Tool capability**: exactly two options, **Enabled** (default) / **Disabled**.
2. Run an agent turn that triggers a tool call. **Expect** the tool call to happen.
3. Set **Disabled**, run the same turn. **Expect** the run to proceed **without** tool calls, and the card to reflect tools-off (no "tool-capable" representation anywhere).
4. Reload the page. **Expect** the Disabled state persisted.
5. Regression (legacy config): via the app's stored settings, set a provider's `toolCapability` back to `"auto"` (simulating pre-upgrade data) — for a non-allowlisted custom `openai-compatible` URL. Reload. **Expect** the card shows **Disabled** (its prior effective behavior) as an explicit value; chat behavior matches.

### S6 — Locals bypass the proxy (D7)

1. With the dev stack (server detected) running, complete S2. **Expect** success — proving the local requests went browser-direct even though the `llm-proxy` capability is advertised (a containerized server cannot reach the host's loopback; a proxied attempt would fail).
2. In the browser devtools network tab, confirm requests to `localhost:1234` go direct (no `/api/llm/proxy` call for the loopback target).

## Done when

- All automated gates green, S1–S6 observed as expected.
- No "detected/running" indicator ever appears on Local entries (FR-015) — search the UI in S1/S2 to confirm.
