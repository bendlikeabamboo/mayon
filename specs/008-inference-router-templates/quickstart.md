# Quickstart: Validating First-Class Inference Router Templates

**Feature**: specs/008-inference-router-templates
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Runnable validation scenarios proving the feature end-to-end. Field values: see
[data-model.md](./data-model.md); behavioral guarantees: see
[contracts/router-templates.md](./contracts/router-templates.md) and
[contracts/discovery-filtering.md](./contracts/discovery-filtering.md).

## Prerequisites

- Dev stack running: `pnpm dev` (web on http://localhost:5173, server on :4319).
- Optional, per scenario: an OpenCode key (opencode.ai/auth — free models need none),
  a Vercel AI Gateway key, a Requesty key, and/or a local LiteLLM proxy.
- Local LiteLLM for Scenario 5 (any spelling works; both `/models` and `/v1/models`
  are served):

  ```bash
  docker run -p 4000:4000 -e LITELLM_MASTER_KEY=sk-test \
    ghcr.io/berriai/litellm:main-stable --config /dev/null
  # or point at an existing config.yaml with model_list entries
  ```

- No `@mayon/shared` changes involved; no rebuild beyond the normal dev stack.

## Automated validation (no keys needed)

```bash
pnpm check   # svelte-check — must pass
pnpm lint    # ESLint + Prettier — must pass
pnpm test    # Vitest — includes modified registry/capability/model-discovery tests
```

Expected outcomes:

- Modified `src/lib/ai/registry.test.ts` passes: four new templates at positions 6–9
  with correct shape, first-eleven order pinned, length 17, LiteLLM keyless + localhost
  exemptions (data-model.md validation rules 1–3).
- Extended `src/lib/agent/capability.test.ts` passes: tools resolve on for all seven
  new gateway base URLs (incl. trailing slashes) and off for an unknown URL (rule 4).
- Extended `src/lib/ai/model-discovery.test.ts` passes: embedding-typed entries
  excluded in both shapes; untyped/other-typed entries kept (rules 5).

## Manual validation scenarios (browser, dev stack)

### Scenario 1 — Catalog presence & ordering (spec FR-001/FR-007, SC-002)

1. Open Settings → Add provider.
2. **Expected**: OpenCode Zen, LiteLLM (self-hosted), Vercel AI Gateway, Requesty
   appear in that order directly after Mistral, each with a one-line description;
   Z.AI, Kilo Gateway, OpenRouter and the rest follow unchanged.

### Scenario 2 — Zen one-click setup with key (SC-001)

1. Pick OpenCode Zen; **Expected**: base URL prefilled, no endpoint typing.
2. Paste the API key; proceed.
3. **Expected**: model list populates from live discovery (snapshot IDs per D5 shown
   first if discovery is slow/unavailable).
4. Send a chat message; **Expected**: a reply streams from Zen.

### Scenario 3 — Zen keyless free model (FR-002 edge, User Story 1 scenario 3)

1. Add OpenCode Zen without saving any key.
2. **Expected**: setup completes with no error or key nag; a free model is the default
   and a chat against it succeeds (or the provider's paid-model error surfaces clearly
   if the free tier changed).

### Scenario 4 — LiteLLM keyless setup (FR-002, User Story 2)

1. With a local LiteLLM proxy running (see prerequisites), pick LiteLLM
   (self-hosted).
2. **Expected**: no API-key prompt; base URL prefilled `http://localhost:4000`.
3. **Expected**: the model picker shows exactly the aliases configured in your
   `config.yaml` `model_list` (discovery is the catalog).
4. Send a chat; **Expected**: a reply streams through the proxy. If your proxy sets a
   master key, save it via the provider key UI and re-test — requests now carry
   Bearer auth.

### Scenario 5 — LiteLLM spelling & tools (FR-004)

1. Edit the LiteLLM provider's base URL to `http://localhost:4000/v1` (and back).
2. Re-run discovery and a tool-using chat in both spellings.
3. **Expected**: discovery works and tools remain on by default in both.

### Scenario 6 — Vercel embedding exclusion (FR-008, User Story 3/5)

1. Configure Vercel AI Gateway with a valid key.
2. Open the model picker after discovery completes.
3. **Expected**: no embedding models appear (e.g. no `…embedding…` IDs from the
   gateway's catalog); chat models from all providers listed; untyped catalogs
   (OpenRouter etc.) unchanged.

### Scenario 7 — Requesty EU variant (FR-004, User Story 4)

1. Configure Requesty; edit the base URL to `https://router.eu.requesty.ai/v1`.
2. Re-run discovery and a tool-using chat.
3. **Expected**: both continue to work with tools still defaulting on.

### Scenario 8 — Tools on by default (FR-004, SC-004)

1. With any new router configured (e.g. Zen), open a chat with a tool enabled (e.g. a
   search MCP tool).
2. Send a message that should trigger the tool.
3. **Expected**: the tool is invoked and its result used — no settings change needed.

### Scenario 9 — CORS proxy fallback (FR-005)

1. With the server connected, use a CORS-blocked router (Zen, Vercel, Requesty, or a
   default-CORS LiteLLM).
2. **Expected**: chat streams via the existing proxy automatically — no extra
   configuration, no error.

### Scenario 10 — Docs updated (FR-009, User Story 6)

1. Check `README.md`'s provider line and provider notes.
2. **Expected**: the four routers named; custom-endpoint pointer for other routers
   present; self-hosted-gateway container address note (`host.docker.internal`)
   present; no GitHub Models reference.

## Regression guard

- Existing provider templates still function: add/use an OpenAI, Z.AI, or OpenRouter
  provider and confirm chat + tools (SC-005).
- Discovery for untyped catalogs returns identical results to before the filtering
  change (covered by the kept-untyped unit tests).
- `pnpm test` shows no failures in pre-existing suites.

## Validation results (2026-08-22)

| Scenario                         | Status                                                                  |
| -------------------------------- | ----------------------------------------------------------------------- |
| 1 - Catalog presence & order     | Covered by registry order/length tests                                  |
| 2 - Zen one-click setup with key | Requires user validation with API key                                   |
| 3 - Zen keyless free model       | Requires user validation with dev stack                                 |
| 4 - LiteLLM keyless setup        | Requires user validation with local proxy                               |
| 5 - LiteLLM spelling & tools     | Requires user validation with local proxy                               |
| 6 - Vercel embedding exclusion   | Covered by parseModelIds exclusion tests                                |
| 7 - Requesty EU variant          | Covered by capability tests; chat requires user validation with API key |
| 8 - Tools on by default          | Covered by capability tests; end-to-end requires user validation        |
| 9 - CORS proxy fallback          | Requires user validation with dev stack                                 |
| 10 - Docs updated                | Covered: README bullet names all four routers + container note          |
