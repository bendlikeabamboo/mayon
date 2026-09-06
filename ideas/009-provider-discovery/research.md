# Research: 009-provider-discovery

- Created: 2026-09-06

## LM Studio CORS default

- **Claim**: LM Studio's local API server has CORS disabled by default; it is enabled via the Server settings toggle or `lms server start --cors` ("When not set, CORS is disabled"). The server binds `127.0.0.1` by default; other binds are discouraged without authentication.
- **Source**: https://lmstudio.ai/docs/cli/serve/server-start ; https://lmstudio.ai/docs/developer/core/server/settings
- **Date**: 2026-09-06

## vLLM CORS default

- **Claim**: vLLM's OpenAI-compatible server ships CORSMiddleware controlled by `--allowed-origins` / `--allowed-methods` / `--allowed-headers` flags (documented CLI args). Open issue vllm-project/vllm#11827 requests a way to _disable_ the middleware (gateway deployments add their own CORS headers), indicating the middleware is permissive/open by default. Exact default value of `--allowed-origins` not verified in the docs snippet — treat "open by default" as high-confidence but unverified detail.
- **Source**: https://docs.vllm.ai/en/v0.4.0.post1/serving/openai_compatible_server.html ; https://github.com/vllm-project/vllm/issues/11827
- **Date**: 2026-09-06

## Mayon topology fact (from repo docs, not web)

- **Claim**: Cloud-provider LLM requests are proxied server-side (llm-proxy capability on the server container; API keys never enter `settings`, requests are same-origin proxied). The server runs in a Docker container, so a server-side proxy cannot reach a local runtime on the user's host via `localhost` (would need `host.docker.internal`-style plumbing, platform-dependent).
- **Source**: AGENTS.md / docs (repo)
- **Date**: 2026-09-06

## Repo facts: provider machinery as it exists today (from src/lib/ai)

- **Claim**: A generic `openai-compatible` provider kind already exists (`src/lib/ai/types.ts`), served via `createOpenAICompatible` (`src/lib/ai/sdk-factory.ts`). The built-in registry (`src/lib/ai/registry.ts`) lists ~14 openai-compatible endpoints plus `anthropic`, `gemini`, `ollama`, `github-copilot` — Ollama is already a registered local provider (`http://localhost:11434/api`).
- **Source**: src/lib/ai/types.ts, src/lib/ai/registry.ts, src/lib/ai/sdk-factory.ts (repo)
- **Date**: 2026-09-06

- **Claim**: Tool-capability auto-detection matches `baseUrl` against a known-gateway allowlist (`KNOWN_GATEWAY_BASEURLS`, which already includes LiteLLM's `http://localhost:4000`); unknown URLs default tools to off (`src/lib/agent/capability.ts`). A new local endpoint at an unrecognized URL silently gets no tools unless allowlisted or manually overridden.
- **Source**: src/lib/agent/capability.ts (repo)
- **Date**: 2026-09-06

- **Claim**: Cross-origin fetch failures are already classified for users (`classifyFetchError` / `isCrossOrigin` in `src/lib/ai/errors.ts`), and model discovery GETs `<baseUrl>/models` (`src/lib/ai/model-discovery.ts`).
- **Source**: src/lib/ai/errors.ts, src/lib/ai/model-discovery.ts (repo)
- **Date**: 2026-09-06

## Ollama CORS default (browser-direct relevance)

- **Claim**: Ollama accepts cross-origin requests from localhost/127.0.0.1 origins by default; pages on other origins (LAN IP, domain, extensions) need `OLLAMA_ORIGINS`. Binds 127.0.0.1 by default; `OLLAMA_HOST=0.0.0.0` exposes to network without auth.
- **Source**: https://github.com/ollama/ollama/issues/300 ; https://modelpiper.com/blog/ollama-cors-fix-mac ; https://objectgraph.com/blog/ollama-cors/
- **Date**: 2026-09-06

## Chrome Private Network Access (localhost probing ceiling)

- **Claim**: Chrome sends PNA preflight requests ahead of subresource requests to more-private address spaces (public→private, private→localhost), and has been deprecating/blocking such requests progressively (warnings first, enforcement staged over releases — rollout dates have shifted repeatedly). Practically: browser-side probing of localhost works when the page itself is on a localhost origin; from LAN-IP or public-domain pages it degrades as enforcement tightens. Status must be re-checked at implementation time.
- **Source**: https://developer.chrome.com/blog/private-network-access-preflight ; https://developer.chrome.com/blog/private-network-access-update
- **Date**: 2026-09-06
