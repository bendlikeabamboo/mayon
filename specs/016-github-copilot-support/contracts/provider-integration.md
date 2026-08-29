# Contract: `github-copilot` Provider Integration (016)

The in-app contract for the new provider kind — every seam it must satisfy, as consumed by stores, Settings UI, and the agent loop. Implementation-free where possible; concrete touchpoints from research D1.

## Kind identity

- `ProviderKind` gains `'github-copilot'` (`src/lib/ai/types.ts:12`).
- `namespaceFor('github-copilot', config)` → `'github-copilot'` (providerOptions namespace; case-sensitive rule per `docs/dev/seams.qmd:76`).
- `kindRequiresKey('github-copilot')` → `true` (`client.ts:74-76`): the KeyStore entry is the **GitHub grant**, pre-flight and badges work unchanged.
- `defaultForKind('github-copilot')` → `true` (`agent/capability.ts:44-55`).

## Registry template

One new `ProviderTemplate` appended to `PROVIDER_TEMPLATES` (`registry.ts`):

| Field | Value |
|---|---|
| `kind` | `'github-copilot'` |
| `label` | `GitHub Copilot` |
| `description` | Account authorization via GitHub device flow; models discovered after connect. |
| `baseUrl` | `https://api.githubcopilot.com` |
| `defaultModel` / `models` | curated fallback snapshot (GPT-5.x, Claude Sonnet/Opus, Gemini Flash — see research D5) |
| `requiresKey` | `true` |
| `discoverable` | `true` |
| `toolCapability` | `'auto'` |

Registry test pins updated: order index, length 17→18, invariants (`registry.test.ts:188-242`).

## Adapter contract (`buildSdkModel` branch)

For `kind: 'github-copilot'`, the factory returns a model built by `createOpenAICompatible` whose `fetch` is a Copilot session wrapper with this per-request behavior:

1. Grant read: KeyStore `get(config.id)` → `MissingKeyError` if absent.
2. Session ensure: memory cache per provider id; stale (>120 s before `expiresAt`) or empty → `POST /api/llm/copilot/token`; cache `{token, expiresAt, endpoint}`.
3. Headers injected (after any SDK headers, before `getLlmFetch` delegation):
   - `Authorization: Bearer <sessionToken>`
   - `Copilot-Integration-Id: vscode-chat`
   - `Editor-Version: vscode/1.98.0`
   - `Editor-Plugin-Version: copilot-chat/0.35.0`
   - `User-Agent: GitHubCopilotChat/0.35.0`
   - `x-github-api-version: 2025-05-01`
4. URL base: cached `endpoint` (authoritative), else `config.baseUrl`; path `/chat/completions` per OpenAI-compatible SDK.
5. Delegation to `getLlmFetch()` — proxy/direct decision, SSE pass-through, abort propagation, and `classifyFetchError` all inherited unchanged.

Error mapping additions (`errors.ts` / `sdk-errors.ts`):

| Condition | Typed error | UI result |
|---|---|---|
| exchange → `grant_invalid` | `CopilotAuthRequiredError` (new, carries `providerId`) | "Reconnect GitHub" one-action state (FR-008) |
| exchange → `not_entitled` | `CopilotSubscriptionError` (new) | clear message, no re-auth loop |
| `/token` 502 `upstream` | `NetworkError` (existing) | retry hint |
| inference 429 (+`Retry-After`) | `RateLimitError` (existing, `retryAfter` set) | existing rate-limit UX |

## Discovery contract (`model-discovery.ts`)

- Auth descriptor becomes per-kind: for `github-copilot`, discovery resolves a session descriptor first and uses the header set from the adapter contract (today: inline Bearer at `model-discovery.ts:41-46`).
- Response parsing: keep `object === 'model'` && `capabilities.type === 'chat'` && `policy.state !== 'disabled'`; never filter on `model_picker_enabled`; merge discovered-first preserving manual entries (existing behavior).
- Pre-auth or failed discovery → template fallback list (existing best-effort semantics).

## UI contract (`ProviderConfig.svelte`)

- Kind badge renders `GitHub Copilot`; description text per template.
- Key section for this kind renders the device-flow connector, not a password field:
  - `not-connected` → "Connect GitHub account" button
  - `connecting` → dialog: `userCode` + copy + `verificationUri` link; polls `/auth/poll` at server cadence, honoring `slowDownAfter`
  - `connected` → status line (login when available), "Reconnect" affordance
  - `needs-reconnect` → highlighted one-action "Reconnect GitHub" (consumes `CopilotAuthRequiredError` from chat too)
- Success writes `setProviderKey(providerId, githubToken)` and triggers discovery refresh (mirrors `saveKey()` flow at `:316-330`).
- Server-absent behavior: connector start fails with a clear "requires the companion server" message; the provider entry itself degrades per the standard `llm-proxy`-missing indicators (FR-013).
- All states styled with existing design tokens, light+dark (FR-014).

## Feature parity invariants (testable)

- Chat, lab generation, quiz generation, short-answer grading, streaming stop/retry, agent tool loop: behave identically to `openai-compatible` providers (orchestrators are kind-agnostic).
- Conversation switching and active-provider selection unchanged.
- Provider removal deletes the KeyStore entry (existing `remove()` path) — no orphaned grants (FR-005).
- Agent-trace persistence stores `configKind: 'github-copilot'` as a plain string (existing column, no migration).
