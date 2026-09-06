# Contract: Connection Test — probe algorithm and failure classification

**Feature**: `021-local-provider-picker` | **Source of truth**: `src/lib/ai/connection-test.ts` (new), `src/lib/ai/errors.ts`, `src/lib/ai/model-discovery.ts` (reused)
Consumer: `ProviderConfig.svelte` "Test connection" button + status line. See [../research.md](../research.md) D5–D7 for rationale.

## API

```ts
testProviderConnection(config: ProviderConfig): Promise<ConnectionTestResult>
// ConnectionTestResult: see data-model.md — { ok: true; models: string[] } | { ok: false; failure: {class, title, message, hint?, status?, detail?} }
```

Available for **any** discoverable provider (locals, cloud APIs, gateways). Not rendered for Ollama (its native base URL is `/api`; discovery is out of scope for this feature).

## Probe algorithm

1. **Key pre-check** — if `requiresKey(config)` and no key in the `KeyStore` → fail fast, class `key-missing`. No network performed.
2. **Probe 1 — discovery** — `GET <baseUrl>/models` via the existing HTTP transport (key attached only when one exists), under `AbortSignal.timeout(8_000)`. Success → `{ ok: true, models }` (parsed by the existing `parseModelIds`; embeddings filtered; sorted, deduped).
3. **On failure — classify** via the matrix below. The disambiguator for opaque browser failures is **Probe 2**: `fetch(<baseUrl>, { mode: 'no-cors' })` —
   - resolves (opaque response) ⇒ a server is listening but the browser cannot read the exchange ⇒ cross-origin class;
   - rejects ⇒ nothing answered ⇒ `not-running`.
   Probe 2 attaches **no credentials** and reads **no data**; it is fired only from the explicit Test action (never in the background — FR-015).

**Timeout**: 8 s applies to Probe 1; Probe 2 uses the browser default (it is a reachability check, expected to be near-instant). The deadline is a test-time guard only — chat/streaming paths are unchanged.

## Classification matrix

| # | Symptom | Class | Title | Message + hint (coached remedy) |
|---|---------|-------|-------|---------------------------------|
| 1 | `requiresKey` && no key stored | `key-missing` | API key required | "Add an API key below, then test again." |
| 2 | Probe 1 `TypeError`; Probe 2 **rejects** | `not-running` | Server not running | "Nothing is listening at `<baseUrl>`. Start LM Studio / vLLM (or check the host and port) and test again." |
| 3 | Probe 1 `TypeError` classified `CorsBlockedError`; Probe 2 **resolves**; target **not** loopback | `cors-blocked` | Blocked before Mayon could read the reply | "The server answered, but the browser blocked the exchange (cross-origin). Enable CORS on the server and test again." (+ existing server-proxy hint for cloud targets) |
| 4 | As #3 but target **is loopback** | `cors-blocked` (loopback variant) | Blocked before Mayon could read the reply | Runtime-specific fix, chosen by template match: **LM Studio** → "Enable CORS in LM Studio's Developer settings, or start it with `lms server start --cors`, then test again." **vLLM** → "Start vLLM with `--allowed-origins` including Mayon's origin, then test again." Generic local → "Check your runtime's CORS/cross-origin setting." |
| 5 | Page is HTTPS, target is plain-HTTP | `insecure-blocked` | Request blocked as insecure | "This browser refuses plain-HTTP requests from a secure page. Serve Mayon over HTTP, or expose your runtime over HTTPS." |
| 6 | `TimeoutError` (8 s deadline) | `timeout` | No response in time | "`<baseUrl>` did not respond within 8 s. Check the host and port, and whether the server is under load." |
| 7 | HTTP 401 / 403 | `auth` | Authentication failed | "The endpoint rejected the credentials. Check the API key for this provider." |
| 8 | HTTP 404 | `not-found` | Endpoint not found | "The server answered, but `<baseUrl>/models` does not exist. Check the base URL (OpenAI-compatible servers usually end in `/v1`)." |
| 9 | HTTP 429 | `rate-limited` | Rate limited | Existing `RateLimitError` copy incl. `Retry-After`. |
| 10 | Any other HTTP status | `http` | Server error (status) | Existing `ProviderHttpError` copy + truncated body. |

Classes 2/4 are the spec's FR-007 pair ("server not running" vs "cross-origin blocked") and 4 is FR-008's LM Studio guidance. Every class names a concrete next step (SC-004).

## Behavioral rules

- **No background probing**: the test runs only on explicit user action. Silent background discovery (the existing gateway behavior on settings load AND at add time) is **skipped for Local-group providers** — locals discover via Test connection or the explicit "Refresh model list" click only.
- **No state mutation on failure**: a failed test never alters the stored config; the user can still save/edit (FR / US1 acceptance 4). A successful test merges discovered models through the existing `refreshModels` merge (discovered first, manual entries preserved) and auto-selects the first discovered model **only while `defaultModel` is empty** (initial selection; a user's choice is never overridden).
- **One error vocabulary**: the test reuses `classifyFetchError` / `httpStatusToError` / `formatProviderError` — no parallel classifier. New classes (`TimeoutError`, loopback CORS coaching) extend the existing ones.
- **Success surface**: models count reported in the status line ("Connection OK — N models found."); failures render `title` + `message` (+ `hint`) in the same status area.

## Test obligations (binding)

`connection-test.test.ts` (fake `HttpStreamTransport` + stubbed `fetch` for Probe 2) MUST cover every matrix row, including: refused-vs-CORS disambiguation both ways, loopback vs remote CORS coaching variants, timeout branch, key pre-check short-circuit (no network), and the no-key-on-probe-2 rule.
