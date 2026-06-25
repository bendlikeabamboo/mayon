# P1 — Provider & AI Layer (Implementation Plan)

Source: `refinement/architecture.md` §6, `refinement/phased-plan.md` P1.
Prerequisite: P0 (foundation + data layer) is complete and merged.

## Goal

Send a prompt and stream tokens back, provider-agnostic, in **both** the browser
and the Tauri desktop runtimes. Provider config + API keys persist and survive
restart. The reference-based context-assembly helper is delivered and unit-tested.

## Resolved decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **One fetch-based streaming transport** used in BOTH runtimes. No Rust LLM transport in P1. | Desktop shell currently only registers the SQL plugin. Rust `reqwest` streaming + OS keychain/stronghold is significant new surface; deferred to P5 (packaging). A single transport keeps both runtimes testable from day one. |
| 2 | **Adapters:** OpenAI-compatible (covers OpenAI **and** Z.AI/GLM) + Anthropic + Gemini + Ollama. | OpenAI-compatible path is shared, parameterized by base URL + model list. Z.AI/GLM is OpenAI-compatible (`POST https://api.z.ai/api/coding/paas/v4/chat/completions`, models `glm-5.2` / `glm-5.1` / `glm-5-turbo` / `glm-4.7` / `glm-4.5-air`). |
| 3 | **API keys:** plaintext in the `settings` KV under key `providerKey:<id>`. | Simplest; matches existing `settingsRepo`. OS keychain / IndexedDB-isolation deferred to P5. Architecture §2 note ("no secrets in settings") is acknowledged as a known P1 tradeoff — recorded in the plan, not silently ignored. |
| 4 | **Interface:** implement `chatStream` only. `generateLab` / `generateQuiz` / `gradeAnswer` declared on the `Provider` interface as stubs returning `Promise<never>` / `throw new Error('P3/P4')`. | Labs = P3, Quizzes = P4 per the phased plan. Declaring them on the interface locks the shape so later phases don't reopen adapters. |
| 5 | **Demo UI:** ephemeral streaming panel on `/chat`. No persistence. | P2 owns the real message-list/composer/persistence. P1 proves "a route streams a real response" without coupling to P2. |
| 6 | **Context assembly:** pure function in `src/lib/chat/context.ts` walking ancestors via repos. | Directly testable with the in-memory driver against a mock tree (the P1 acceptance criterion). |
| 7 | **Config shape:** `providers` = `{[id]: {id, kind, name, baseUrl, defaultModel, models[]}}`; `activeProvider` = id; `providerKey:<id>` = key. | Separates non-secret config from the key. `providers` already seeded to `{}` by `settingsRepo.seedDefaults()` in P0. |
| 8 | **Errors:** typed (`MissingKeyError`, `RateLimitError`, `CorsBlockedError`, `ProviderHttpError`, `NetworkError`) → mapped user-facing messages. `CorsBlockedError` shows the "use the desktop app" fallback (architecture §2). Never silent. | Matches cross-cutting concern "never silent". |

### Known P1 tradeoff (do not relitigate)

- **API keys in plaintext settings KV.** This violates the spirit of
  architecture.md §2 ("no secrets in settings"). Accepted for P1 because secure
  storage (desktop keychain / browser IndexedDB) is bundled with the P5 Rust
  transport work. A TODO is placed at the key read/write site pointing to P5.
  The plan explicitly does **not** claim secure key storage in P1.

## Provider → transport matrix (P1)

| Provider kind      | Endpoint                                              | Auth header                         | Streaming | CORS (browser) |
|--------------------|-------------------------------------------------------|-------------------------------------|-----------|----------------|
| `openai-compatible` (OpenAI) | `https://api.openai.com/v1/chat/completions`  | `Authorization: Bearer <key>`        | SSE       | OK             |
| `openai-compatible` (Z.AI)   | `https://api.z.ai/api/coding/paas/v4/chat/completions` | `Authorization: Bearer <key>`  | SSE       | verify at runtime; if blocked → `CorsBlockedError` + desktop notice |
| `anthropic`        | `https://api.anthropic.com/v1/messages`               | `x-api-key: <key>` + `anthropic-version: 2023-06-01` + `anthropic-dangerous-direct-browser-access: true` | SSE (event stream) | requires the dangerous-browser header; may still CORS-fail → fallback notice |
| `gemini`           | `https://generativelanguage.googleapis.com/v1beta/models/<model>:streamGenerateContent?alt=sse` | `x-goog-api-key: <key>` (or `?key=`) | SSE       | OK             |
| `ollama`           | `http://localhost:11434/api/chat`                     | none                                | NDJSON stream | same-origin localhost |

> All adapter code lives in TS (no Rust). Each adapter parses its provider-specific
> stream into the shared `Token` shape and yields via `AsyncIterable`.

## File plan

### New — `src/lib/ai/`

- **`types.ts`** — `ChatMessage` (`{role: 'system'|'user'|'assistant', content}`),
  `ChatStreamOptions` (`{signal?: AbortSignal}`), `Token` (`{text: string}` or
  `{delta: string}`), the `Provider` interface (`chatStream`, + stubbed
  `generateLab`/`generateQuiz`/`gradeAnswer`), the typed error classes
  (`MissingKeyError`, `RateLimitError`, `CorsBlockedError`, `ProviderHttpError`,
  `NetworkError`), and the `ProviderKind` union.
- **`errors.ts`** — typed error class implementations + a `formatProviderError(e)`
  mapper returning a `{ title, message, hint? }` user-facing payload (hint includes
  the desktop-fallback string for `CorsBlockedError`).
- **`transport.ts`** — a single `streamSse(url, init, signal): AsyncIterable<string>`
  helper built on `fetch` + `ReadableStream` reader + SSE-frame parsing. One
  shared implementation; adapters feed it URL/headers/body and decode their own
  event payloads.
- **`adapters/openai-compatible.ts`** — `createOpenAICompatibleAdapter(config)`:
  builds the request body (`{model, messages, stream: true}`), calls `streamSse`,
  yields `Token` from each `choices[0].delta.content`. Parameterized by `baseUrl`
  and `models[]`. Used by both the OpenAI and Z.AI provider configs.
- **`adapters/anthropic.ts`** — `createAnthropicAdapter(config)`: maps
  `ChatMessage[]` → Anthropic messages (split system from messages), sets the
  dangerous-browser header, parses `content_block_delta` events → tokens.
- **`adapters/gemini.ts`** — `createGeminiAdapter(config)`: maps messages →
  Gemini `contents[]`, parses the SSE `streamGenerateContent` chunks.
- **`adapters/ollama.ts`** — `createOllamaAdapter(config)`: NDJSON
  (`{\"message\":{\"content\":...}}`) line parsing, no auth.
- **`registry.ts`** — `getProvider(providerConfig): Provider` factory that picks
  the adapter by `config.kind`; `listProviderKinds()`; built-in catalog of
  provider templates (OpenAI, Z.AI, Anthropic, Gemini, Ollama) with default
  base URLs + model lists (used to prefill the Settings "add provider" UI).
- **`client.ts`** — `getActiveProvider(): Promise<Provider>` reads `activeProvider`
  + `providers` + `providerKey:<id>` from `settingsRepo`, constructs the adapter,
  throws `MissingKeyError` if no key for a kind that requires one. This is the
  single entry point components call.

### New — `src/lib/chat/`

- **`context.ts`** — `assembleContext(targetChatId): Promise<ChatMessage[]>`.
  Implements architecture.md §5.2 exactly: (1) target's own messages (all);
  (2) walk up `parentId`; at each ancestor, include its messages with
  `ord <= ord(branchPointMessageId)` of the child linking into it (root → all).
  Returns parts sorted by depth asc, then ord asc. Injects the branch excerpt as
  a leading system note when a `branch_sources` row exists. Pure: takes only a
  chatId, resolves everything through `repos`.
- **`context.test.ts`** — builds a mock tree (root → child branched at a mid
  message; grandchild) via repos on the in-memory driver, asserts the assembled
  set excludes parent messages with `ord > cutoff`, includes ancestor messages,
  is correctly ordered, and that the excerpt note leads.

### New — UI

- **`src/lib/components/ai/StreamDemo.svelte`** — prompt input + "Send" button;
  on send, calls `getActiveProvider().chatStream(...)`, appends tokens live to a
  `<pre>` via a `$state` buffer, supports Stop (`AbortController`). Maps thrown
  errors through `formatProviderError` to an inline error block.
- **`src/lib/components/ai/ProviderConfig.svelte`** — the Settings provider UI:
  list configured providers (name, kind, model), "Add provider" (pick template →
  prefilled form), edit baseUrl/model list, paste API key (stored via
  `providerKey:<id>`), "Set active", "Delete". No secrets shown back in
  plaintext after save (key field masked); a "replace key" affordance.
- **`src/routes/settings/+page.svelte`** — replace the placeholder with
  `<ProviderConfig />`.
- **`src/routes/chat/+page.svelte`** — replace the placeholder with `<StreamDemo />`.

### New — tests

- **`src/lib/ai/transport.test.ts`** — SSE frame parser unit tests (multi-line
  data, split chunks across reads, `[DONE]` termination) using canned byte streams.
- **`src/lib/ai/adapters/openai-compatible.test.ts`** — adapter maps a canned
  SSE stream to the expected token sequence; maps a 429 to `RateLimitError`.
- **`src/lib/ai/errors.test.ts`** — `formatProviderError` returns the right
  title/message/hint per error class, incl. the desktop-fallback hint on CORS.
- **`src/lib/chat/context.test.ts`** — as above.

## Ordered task list

1. **`src/lib/ai/types.ts`** — `ChatMessage`, `Token`, `ChatStreamOptions`,
   `Provider` interface (with stubbed gen helpers), `ProviderKind`, typed error
   class declarations.
2. **`src/lib/ai/errors.ts`** — error implementations + `formatProviderError`.
3. **`src/lib/ai/transport.ts`** — `streamSse` over fetch + `ReadableStream`.
4. **`src/lib/ai/adapters/openai-compatible.ts`** — the shared OpenAI/Z.AI adapter.
5. **`src/lib/ai/adapters/anthropic.ts`**, **`gemini.ts`**, **`ollama.ts`**.
6. **`src/lib/ai/registry.ts`** — factory + built-in provider template catalog
   (incl. the Z.AI template with its coding base URL + GLM model list).
7. **`src/lib/ai/client.ts`** — `getActiveProvider()` reading settings.
8. **`src/lib/chat/context.ts`** — `assembleContext`.
9. **`src/lib/components/ai/StreamDemo.svelte`** + wire into `/chat`.
10. **`src/lib/components/ai/ProviderConfig.svelte`** + wire into `/settings`.
11. **Tests:** transport, openai-compatible adapter, errors, context-assembly.
12. **Docs:** add a "Provider setup" note to `AGENTS.md` (manual acceptance steps
    for configuring a provider in the desktop app and streaming a reply), and a
    `TODO(P5)` marker at the key read/write site.

## Validation (acceptance gates)

Automated (run `pnpm test`):
- SSE transport parses canned streams correctly incl. split chunks + `[DONE]`.
- OpenAI-compatible adapter yields the expected token sequence; maps 429 → RateLimitError.
- `formatProviderError` returns correct mapped payloads per error class (incl. CORS desktop hint).
- `assembleContext` returns the correct ordered message set for a mock tree
  (root/child/grandchild) including cutoff exclusion and excerpt injection.

Type/lint (`pnpm check`, `pnpm lint`): clean.

Manual (both runtimes — desktop needs GTK/WebKit libs per `AGENTS.md`):
- **Browser:** `pnpm dev` → Settings → add an OpenAI-compatible provider
  (OpenAI or Z.AI) with a key → set active → on `/chat`, type a prompt → tokens
  stream in live → reload tab → provider config + key survive.
- **Desktop:** `pnpm tauri dev` → same flow → key + config survive app restart.
- **Provider switch:** add a second provider, switch active, stream again.
- **CORS fallback:** (best-effort) configure Anthropic in the browser; if the
  provider blocks the request, the UI shows the "use the desktop app" notice
  rather than a raw error.

## Out of scope (explicit)

- Rust `reqwest` transport + OS keychain/stronghold key storage (→ P5).
- Secure key storage beyond plaintext KV (→ P5).
- `generateLab` / `generateQuiz` / `gradeAnswer` implementations (→ P3/P4).
- Real persistent chat (message list, composer, markdown, persistence) (→ P2).
- Token usage accounting / cost tracking (not in P1 acceptance).

## Risks

- **Provider CORS at runtime is empirically uncertain** for some
  OpenAI-compatible / Anthropic browser calls. Mitigation: typed `CorsBlockedError`
  + the mapped desktop-fallback notice; the acceptance gate for CORS is
  best-effort, not blocking.
- **Anthropic browser access** needs the dangerous-browser header and may still
  fail CORS depending on provider policy. Surfaced, not silently swallowed.
- **Plaintext keys** — the deliberate P1 tradeoff; tracked with a `TODO(P5)`
  marker so it is not forgotten.
