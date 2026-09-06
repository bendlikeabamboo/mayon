# Contract: Provider Registry — groups, templates, and legacy normalization

**Feature**: `021-local-provider-picker` | **Source of truth**: `src/lib/ai/registry.ts`, `src/lib/ai/types.ts`, `src/lib/ai/client.ts`
Consumers: Settings UI (`ProviderConfig.svelte`), agent capability gate (`src/lib/agent/capability.ts`), connection test (`connection-test.ts`). See [../data-model.md](../data-model.md) for field tables and [../research.md](../research.md) D1–D4, D8 for rationale.

## 1. Group taxonomy (fixed, four values)

```ts
type ProviderGroup = 'local' | 'cloud' | 'gateway' | 'custom';
```

- `local` — key-free self-hosted runtimes (Ollama, LM Studio, vLLM). Membership is **curated metadata**; never inferred from the endpoint address. A Local entry pointed at a LAN host remains Local.
- `cloud` — key-required native/model APIs.
- `gateway` — routers (OpenRouter, LiteLLM, Vercel AI Gateway, Requesty, Kilo Gateway, OpenCode Zen). Key requirement is irrelevant to the assignment: LiteLLM is keyless and still a gateway.
- `custom` — user-defined endpoints; fallback for configs matching no template.

**Display order**: `local → cloud → gateway → custom`. **Within** a group: registry order (stable, load-bearing — tests assert per-group positions).

**Extension rule**: every future template MUST declare a `group` (enforced by registry test). Adding provider #21 is catalog data + one group assignment; the picker requires no code change.

## 2. Template contract (additions)

```ts
interface ProviderTemplate {
  // existing fields unchanged…
  group: ProviderGroup;                    // required (was absent)
  toolCapability: 'on' | 'off';            // narrowed; ships 'on' for ALL templates (ruling Q1:C)
}
```

New templates:

| Label | kind | group | baseUrl | requiresKey | discoverable | models / defaultModel |
|-------|------|-------|---------|-------------|--------------|------------------------|
| `LM Studio (local)` | `openai-compatible` | `local` | `http://localhost:1234/v1` | `false` | `true` | `[]` / `''` (discovery-first) |
| `vLLM (local)` | `openai-compatible` | `local` | `http://localhost:8000/v1` | `false` | `true` | `[]` / `''` (discovery-first) |

Relaxed registry invariant: a template with `discoverable: true` may ship `models: []` and `defaultModel: ''`; the "models contain defaultModel" assertion applies only to the rest.

## 3. Config contract (additions + read-time normalization)

```ts
interface ProviderConfig {
  // existing fields unchanged…
  group?: ProviderGroup;          // copied from template at add; optional for legacy configs
  requiresKey?: boolean;          // copied from template at add; optional for legacy configs
  toolCapability: 'on' | 'off';   // effective type after read-time normalization ('auto' retired)
}
```

**Read-time normalization** — `listProviders()` (and therefore every consumer) returns configs where:

1. `toolCapability` is always `'on' | 'off'`. Legacy `'auto'`/`undefined` maps through `legacyToolDefault(config)`:
   - `anthropic | gemini | github-copilot` → `'on'`
   - `ollama` → `'off'`
   - `openai-compatible` → `'on'` iff normalized `baseUrl` (trailing slashes stripped) is in `KNOWN_GATEWAY_BASEURLS`, else `'off'`
   - anything else → `'off'`
   This **preserves each legacy provider's prior effective behavior exactly**. Write-back to the stored JSON happens on the next user save (lazy; behavior does not depend on it).
2. The effective group is `config.group ?? inferGroup(config) ?? 'custom'`, where `inferGroup` matches a template by `kind` + normalized `baseUrl`. The matched value may be written back on save; rendering never requires it.
3. `requiresKey(config)` = `config.requiresKey ?? (config.kind !== 'ollama')`. Consumers: chat-start key gating (`getActiveSdkProvider`), settings key section visibility, background-discovery guard. LM Studio/vLLM therefore show no key prompt; custom `openai-compatible` entries keep prompting (unchanged).

**Normalization is idempotent and pure** — no network, no probing, deterministic from the stored record. The same function is the regression lock for FR-013: changing it must fail tests that encode the table above.

## 4. Capability resolution (runtime contract)

```ts
resolveToolCapability(config) = config.toolCapability !== 'off' && !sessionToolsDisabled
```

- `'auto'` MUST NOT reach this function (normalized upstream). No URL inspection happens anywhere in the request path — the allowlist exists only inside `legacyToolDefault` for normalization.
- The session-disable latch (`disableToolsForSession` / retry-text-only safety net in the agent loop) is unchanged and composes with the explicit setting.
- `loop.ts` reads the normalized field (or `resolveToolCapability`) — one code path, not a raw tri-state re-read.

## 5. Local traffic routing contract

- `getLlmFetch(url)` returns **browser** `fetch` when the target host is loopback (`localhost`, `127.0.0.1`, `[::1]`), even when the `llm-proxy` capability is advertised; otherwise behavior is unchanged (proxy when present).
- Applies to chat completions, model discovery, and the connection test alike. Locals therefore work identically with and without the server detected (progressive degradation).
- Remote self-hosted targets (e.g., LAN IP) are **not** loopback and keep existing routing.

## 6. Test obligations (binding)

- Registry: every template has a valid `group`; per-group ordering; discovery-first invariants; new templates' exact `baseUrl`s.
- Normalization: the full legacy table (including every `KNOWN_GATEWAY_BASEURLS` variant carried over from the old `capability.test.ts` cases).
- Routing: loopback bypass selects raw fetch; remote selection unchanged (proxy when capability present).
- E2E: grouped picker renders four groups; a grouped Local entry completes connection-test → model pick → chat reply without a key.
