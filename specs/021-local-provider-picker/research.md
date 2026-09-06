# Research: Local-First Grouped Provider Picker

**Feature**: `021-local-provider-picker` | **Date**: 2026-09-06
**Method**: Codebase exploration of the provider/LLM seam (`src/lib/ai`, `src/lib/agent`, `src/lib/services`, settings UI) plus the owner ruling on Question 1 (tools-toggle default).

All Technical-Context unknowns are resolved; no NEEDS CLARIFICATION remains. Decisions are numbered and referenced from `data-model.md`, `contracts/*`, and `quickstart.md`.

---

## D1 — Grouping representation: a `ProviderGroup` union on templates, optional on configs

**Decision**: Add `type ProviderGroup = 'local' | 'cloud' | 'gateway' | 'custom'`. `ProviderTemplate` gains a **required** `group: ProviderGroup`; `ProviderConfig` gains an **optional** `group?: ProviderGroup` (copied at `addFromTemplate`). At read time the effective group is `config.group ?? inferGroup(config) ?? 'custom'`, where `inferGroup` matches the config against templates by `kind` + normalized `baseUrl` (trailing-slash-insensitive). Matched groups persist lazily on the next save.

**Rationale**: Templates need the field to guarantee FR-003 (no ungrouped registry entries, enforced by a registry test). Configs only need it for the rare case of a user-edited `baseUrl` that drifted from its template; inference from `kind`+`baseUrl` correctly re-groups existing saved providers after upgrade (FR-013) with **no schema migration**, matching the optional-field precedent (`discoverable?`, `toolCapability?`, `requestDefaults?` — all shipped without data migrations).

**Alternatives considered**:
- *Derive group from `kind`*: rejected — `openai-compatible` spans locals (LM Studio), gateways (OpenRouter), and custom endpoints; `kind` cannot distinguish them, and the taxonomy must survive user-edited base URLs.
- *Separate template-label → group lookup table*: rejected — configured providers don't store their template label (only `name`, user-editable), and a second catalog to keep in sync is a worse maintenance surface than one field.
- *Server-side stamped schema migration to backfill `group`*: rejected — pure client-side JSON field addition; the lazy-normalization precedent (`keysMigrated` flag, `src/lib/ai/keystore/migrate.ts`) covers it with less machinery.

## D2 — Taxonomy rulings (the boundary fights, settled once)

**Decision**:
- **Local** = key-free, self-hosted runtime class: Ollama, LM Studio, vLLM. Group membership is curated metadata, never derived from the address (a Local entry pointed at a LAN host stays Local — FR-014).
- **Cloud APIs** = key-required native/model APIs: OpenAI, Anthropic, Google Gemini, GitHub Copilot, DeepSeek, xAI (Grok), Moonshot Kimi, Qwen (DashScope), Groq, Mistral, Z.AI (GLM).
- **Gateways** = routers, key required or not: OpenRouter, LiteLLM (self-hosted), Vercel AI Gateway, Requesty, Kilo Gateway, OpenCode Zen. LiteLLM's keylessness does not make it "Local" — it is a router.
- **Custom** = user-defined endpoints; also the fallback for configs that match no template.
- Display order: Local, Cloud APIs, Gateways, Custom (spec order). Within a group, registry order is preserved (registry order is load-bearing per the 007 learning; tests extend to per-group positions rather than rewriting).

**Rationale**: The spec fixes these assignments; recording them here ends the recurring re-litigation. "Local" describes the *runtime class* (self-hosted, key-free), not a specific machine.

## D3 — LM Studio and vLLM templates: `openai-compatible`, discovery-first, key-free

**Decision**: Two new templates —
- LM Studio: `kind: 'openai-compatible'`, `group: 'local'`, `baseUrl: 'http://localhost:1234/v1'`, `requiresKey: false`, `discoverable: true`, `models: []`, `defaultModel: ''`, `toolCapability: 'on'`.
- vLLM: same shape, `baseUrl: 'http://localhost:8000/v1'`.

They ride the existing `createOpenAICompatible` adapter and `/models` discovery unchanged. Because the catalog is discovery-first, the registry test invariant "models contain defaultModel" is relaxed for discovery-first templates: `discoverable === true` → `models` may be empty and `defaultModel` may be `''`. When a discovery-first config's `defaultModel` is empty and discovery succeeds, the UI auto-selects the **first discovered model only while the field is empty** (initial-state convenience; a user's chosen model is never overridden — the existing "pick another" rule still guards user selections).

**Rationale**: The spec's accepted trade-off pins these runtimes to the generic `openai-compatible` kind (first-class upgrades later imply config migration — out of scope). Curated fallback model lists would go stale by design (007/008 learning: "live discovery supersedes"); LM Studio/vLLM serve user-installed models, so there is no meaningful static list.

**Alternatives considered**:
- *Placeholder default models* (`'local-model'`): rejected — invites a saved-but-wrong default that fails at chat time.
- *Native `lmstudio`/`vllm` kinds now*: rejected — explicitly deferred by the spec (sequel material; implies config migration).

## D4 — `requiresKey` becomes a config field; the kind switch retires

**Decision**: Add optional `requiresKey?: boolean` to `ProviderConfig`, copied from the template at add time. `kindRequiresKey(config)` becomes `config.requiresKey ?? legacyKindDefault(config.kind)` where `legacyKindDefault` preserves today's behavior (`kind !== 'ollama'`). All consumers (`getActiveSdkProvider` key gating, settings UI key section, background-discovery guard) consult the same function.

**Rationale**: Key-requirement is currently derived from `kind` alone (`client.ts` `kindRequiresKey`), which would force a key prompt on LM Studio/vLLM (`openai-compatible` ⇒ key required). The template already knows the truth (`requiresKey: false`); persisting it on the config keeps user-added custom entries working via the legacy kind default, no migration.

**Alternatives considered**: *Derive from `group === 'local'`*: rejected — "key-free" and "local" are independent facts (LiteLLM: keyless gateway; a keyed local proxy would be a local endpoint with a key). One field per fact.

## D5 — Connection test: explicit probe with a `no-cors` disambiguation step

**Decision**: New `src/lib/ai/connection-test.ts` exposing `testProviderConnection(config): Promise<ConnectionTestResult>`:

1. Pre-check: if `requiresKey(config)` and no key stored → fail fast as `key-missing`.
2. Probe 1: `discoverModels(config)` under a deadline signal (`AbortSignal.timeout(8s)`), riding the existing transport, classification (`classifyFetchError` / `httpStatusToError`), and parsing machinery. Success → `{ ok: true, models }`.
3. On failure, classify per the matrix in `contracts/connection-test.md`. The load-bearing trick: a browser `TypeError` is **opaque** — cross-origin refusal (nothing listening) and CORS-block (server answers without CORS headers) are indistinguishable in-band. Probe 2 is a `fetch(target, { mode: 'no-cors' })` to the base URL:
   - resolves (opaque response) ⇒ something is listening ⇒ failure class `cors-blocked` (coached per-runtime fix);
   - rejects ⇒ nothing answered ⇒ `not-running` ("server not running — start it / check the address").

**Rationale**: FR-007/FR-008 require distinct "server not running" vs "cross-origin blocked" coaching with distinct remedies; without Probe 2 the browser physically cannot tell them apart, and the guidance would have to hedge both causes into one message. The `no-cors` probe is user-initiated (Test click only), sends no credentials, and reads no data — compliant with FR-015 (no background/auto detection) and the no-secrets rule.

**Alternatives considered**:
- *Route the test through the server proxy to distinguish ECONNREFUSED from CORS absence server-side*: rejected — the server container cannot reach the host's loopback (see D7), and it would centralize what must stay browser-direct.
- *Single hedged message for all opaque failures*: rejected — fails FR-007's "actionable categories with a specific suggested remedy" and SC-004's recovery criterion.

**Known limitation (documented, not blocking)**: when Mayon is served over HTTPS and the target is plain-HTTP loopback, some browsers apply mixed-content rules; the classification matrix carries an `insecure-blocked` class with its own hint (`localhost` is "potentially trustworthy" in Chromium/Firefox, so the common cases are unaffected).

## D6 — Error model: add `TimeoutError`; loopback-aware CORS coaching

**Decision**:
- Add `TimeoutError` to the typed error family. `classifyFetchError` gains a branch: `DOMException` with `name === 'TimeoutError'` → `TimeoutError` (user-initiated `AbortError` keeps its existing pass-through semantics).
- `formatProviderError` gains coached entries for the new classes (timeout, not-running, cors-with-runtime-fix). The runtime-specific coaching (LM Studio toggle / `lms server start --cors`, vLLM `--allowed-origins`) is produced **at the connection-test surface**, which knows the provider config; the generic chat-time CORS message stays as-is.

**Rationale**: `AbortSignal.timeout` aborts with a `TimeoutError` DOMException that currently falls into the generic `NetworkError` bucket, collapsing "wrong address" and "too slow" — the two cases FR-007 separates. Extending the existing classifier (rather than a parallel one) keeps every transport on one error vocabulary.

## D7 — Loopback targets bypass the LLM proxy (locals stay browser-direct)

**Decision**: Change `getLlmFetch()` → `getLlmFetch(url: string)`: when the target host is loopback (`localhost`, `127.0.0.1`, `[::1]`), return `globalThis.fetch` even when the `llm-proxy` capability is present. Call sites updated mechanically (`sdk-fetch.ts`, `http-transport.ts`, `copilot-fetch.ts`); the server proxy route is untouched.

**Rationale**: Verified in code: `getLlmFetch` returns `createProxyFetch()` whenever the server advertises `llm-proxy`, and `POST /api/llm/proxy` fetches from the **server's** network context with no loopback handling — from inside a container, `localhost:1234` is the container, not the host. This is exactly the documented 008 rough edge ("inside Mayon's containerized server, localhost resolves within the container"). The spec's accepted trade-off requires local traffic browser-direct "as Ollama already is" (true today only when no server is detected); the loopback bypass makes that true unconditionally and incidentally fixes self-hosted LiteLLM users too. Browser-direct is safe here because loopback targets are same-machine by definition.

**Alternatives considered**:
- *Rewrite loopback to `host.docker.internal` for the proxy*: rejected — platform-dependent (Linux engines need `--add-host`), still wrong for native installs, and couples Mayon's web layer to Docker topology.
- *Keep proxying everything*: rejected — breaks every local runtime in the all-Docker topology, i.e., the feature's primary audience.

## D8 — Tool capability: explicit only; default **on** for all; legacy behavior preserved at read time

**Decision** (owner ruling on Question 1: **Option C**):
- New/edited configs carry `toolCapability: 'on' | 'off'` — never `'auto'`. All 20 templates ship `'on'` (SC: tools work out of the box; non-tool endpoints surface their own refusal and the user flips the toggle — the session-disable safety net on tool-related 400s still exists in `loop.ts`).
- **Legacy normalization at read time** (`listProviders`): `toolCapability: 'on' | 'off'` unchanged; `'auto'`/undefined → the prior effective default (`defaultForKind`: anthropic/gemini/copilot → on, ollama → off, openai-compatible → `KNOWN_GATEWAY_BASEURLS` exact-string hit), written back explicitly on the next save. This preserves every existing provider's behavior exactly (FR-013) while retiring the guess.
- `resolveToolCapability(config)` simplifies to `config.toolCapability !== 'off' && !sessionToolsDisabled`; the allowlist + kind table move into a `legacyToolDefault(config)` helper used **only** by the read-time normalization (and its tests). `loop.ts` reads the normalized field, eliminating today's split where the loop re-reads the raw tri-state.
- Ollama's default flips from off → **on** for new configurations (per the ruling). Legacy Ollama configs stay off after normalization (their prior effective behavior).

**Rationale**: The bug class being retired is *silent inference*; any surviving `'auto'` path would preserve it. Read-time normalization is the established, migration-free pattern (D1). The ruling's accepted cost — non-tool endpoints error visibly until the user switches the toggle off — is strictly better than the silent-off failure it replaces, and the existing retry-text-only safety net softens it.

**Alternatives considered**: *Keep `'auto'` as a hidden legacy enum forever*: rejected — two resolution paths is exactly the complexity this feature deletes. *Server-side stamped migration*: rejected — nothing breaks if unread; lazy normalization suffices.

## D9 — Picker UI: grouped sections + client-side search; configured cards stay a single list

**Decision**: The add-provider template grid (`ProviderConfig.svelte` flat 2-col grid) becomes four labeled sections with headings and one-line descriptions, each rendering its templates in registry order as the existing 2-col button grid. A search input (existing `Input`/`Command` vocabulary, per `SettingsSearch`/`ModelSelect` precedents) filters templates across all groups on `label` + `description`, case-insensitive substring; while searching, empty groups are hidden and a "no providers match" empty state offers a clear action; clearing restores the full grouped list. The configured-provider card list below remains one list (it is user-scoped and typically short) — grouping applies to the **catalog**, which is what grows unboundedly.

**Rationale**: The findability problem (spec "Why") is about the registry/catalog, not the user's own configured set. Client-side substring over ~20 strings is instant (SC-003) and dependency-free.

**Alternatives considered**: *Group configured cards too*: rejected — redundant with a list of 1–5 user-chosen entries; adds scroll depth for no findability gain. *Command-menu (⌘K) picker instead of grouped sections*: rejected — browsing groups is a first-class need (users don't always know the name to type); search complements, not replaces, the spine.

## D10 — Testing strategy

**Decision**:
- **Unit (Vitest, co-located)**: `registry.test.ts` — per-group order invariants + discovery-first template shape (relaxed models invariant); `capability.test.ts` — rewritten around the legacy-normalization table (every allowlisted URL variant from the existing cases becomes a `→ 'on'` normalization expectation) + explicit-only resolution; new `connection-test.test.ts` — the full classification matrix with a fake `HttpStreamTransport` + stubbed `no-cors` fetch (not-running / cors-blocked / timeout / auth / 404 / 429 / http / key-missing / insecure-blocked); `errors.test.ts` — timeout branch; `llm-proxy-fetch.test.ts` — loopback bypass picks raw fetch, remote targets still proxy.
- **E2E (Playwright, `tests/e2e/`)**: extend `onboard.spec.ts` for the grouped picker; new `provider-picker.spec.ts` — group headings + search filtering/empty state; tools toggle on→off changes mock-LLM tool-call behavior (SC-005 observable end-to-end); connection-failure coaching against a dead port (not-running class) using the mock fixture pattern.
- **Gates**: `pnpm check`, `pnpm lint`, `pnpm test` (+ existing e2e suite stays green; server package untouched).

**Rationale**: Matches the constitution's test standards (new `src/lib` behavior needs tests; the silent-tools-off regression needs a test that fails without the fix — the normalization table test is exactly that for the migration, the e2e toggle test for the runtime path).

## Out of scope (recorded, per spec)

Auto-detection/"running" status for local runtimes; search/grouping within long model lists; native per-runtime APIs for LM Studio/vLLM; routing local traffic through the server proxy; Ollama `/models` discovery (its native base URL is `/api`, not `/v1` — a separate concern); grouping the configured-provider card list.
