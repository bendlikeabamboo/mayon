# Phase 0 Research: First-Class Inference Router Templates

**Feature**: specs/008-inference-router-templates
**Date**: 2026-08-22
**Primary source**: [research/004-inference-routers.md](../../../research/004-inference-routers.md) (user-authored, dated 2026-08-22) — verified against current code (`src/lib/ai/registry.ts`, `src/lib/ai/registry.test.ts`, `src/lib/agent/capability.ts`, `src/lib/agent/capability.test.ts`, `src/lib/ai/model-discovery.ts`, `src/lib/ai/model-discovery.test.ts`) and against the LiteLLM repository's endpoint reference.

Technical Context contained no NEEDS CLARIFICATION markers; the unknowns below were
consolidated from the spec's assumptions and the research doc's "verify at
implementation" items. No subagent research was dispatched — research 004 plus direct
code inspection resolved every open question except the fallback-model snapshots, which
by design (mirroring 007's D5) are captured at implementation time from each router's
live listing.

---

## D1 — Mechanism: existing `openai-compatible` kind, no new code paths

**Decision**: All four routers ship as `ProviderTemplate` entries with
`kind: 'openai-compatible'` in `PROVIDER_TEMPLATES` (`src/lib/ai/registry.ts`), served
by the existing adapter stack (`sdk-factory.ts`, `sdk-fetch.ts`, `model-discovery.ts`).

**Rationale**: Every shortlisted router is defined by OpenAI wire compatibility with
`Authorization: Bearer` auth (research 004 cross-reference table). The
openai-compatible kind + generic discovery + keychain auth + CORS proxy already absorb
all per-router differences.

**Alternatives considered**: New provider kinds per router (effort L — rejected); using
Zen's/Requesty's Anthropic-wire endpoints (no benefit; wrong adapter for identical
results); special enterprise-cloud integrations routed through LiteLLM (rejected — the
LiteLLM template _is_ the integration; upstream provider auth stays in the user's
gateway, out of Mayon's scope per spec FR-010).

## D2 — Catalog placement and ordering

**Decision**: Insert the four new templates as a **contiguous block at positions 6–9**
(0-indexed) — after the six direct providers from feature 007 and ahead of **all**
pre-existing gateway entries (Z.AI, Kilo Gateway, OpenRouter). Resulting catalog order:

```text
0  DeepSeek            (007)
1  xAI (Grok)          (007)
2  Moonshot Kimi       (007)
3  Qwen (DashScope)    (007)
4  Groq                (007)
5  Mistral             (007)
6  OpenCode Zen        ← NEW (P1)
7  LiteLLM (self-hosted) ← NEW (P1)
8  Vercel AI Gateway   ← NEW (P2)
9  Requesty            ← NEW (P2)
10 Z.AI (GLM)
11 Kilo Gateway
12 OpenRouter
13 OpenAI
14 Anthropic (Claude)
15 Google Gemini
16 Ollama (local)
```

The 007 order test (`registry.test.ts:116` "first seven labels") must be extended to
pin the first **eleven** labels, and the catalog-length assertion changes 13 → 17.

**Rationale**: Spec FR-007 requires Zen and LiteLLM ahead of the existing gateway
entries with Vercel and Requesty following them; research 004's checklist places all
four ahead of OpenRouter/Kilo. A contiguous block at 6–9 satisfies both readings,
groups the new work for testability, and keeps the highest-demand direct providers
(feature 007's usage ordering) on top.

**Alternatives considered**: Inserting after Z.AI only (Z.AI is a direct provider
endpoint, but splitting the new block buries the P2 routers and complicates the order
test for no user-visible gain); appending at the end (violates FR-007 — research
priority demands prominence); reordering the 007 providers (out of scope; their order
is pinned by feature 007's tests and usage evidence).

## D3 — Base URLs

**Decision**:

| Template              | Base URL (shipped)                | Variant (user-editable)                   |
| --------------------- | --------------------------------- | ----------------------------------------- |
| OpenCode Zen          | `https://opencode.ai/zen/v1`      | `https://opencode.ai/zen/go/v1` (Go plan) |
| LiteLLM (self-hosted) | `http://localhost:4000`           | `http://localhost:4000/v1` (equivalent)   |
| Vercel AI Gateway     | `https://ai-gateway.vercel.sh/v1` | —                                         |
| Requesty              | `https://router.requesty.ai/v1`   | `https://router.eu.requesty.ai/v1` (EU)   |

**Rationale**: All verified in research 004 against router docs. The LiteLLM **root**
spelling (no `/v1`) is safe: the LiteLLM proxy mounts every OpenAI-compatible route at
both prefixes — `/chat/completions` and `/v1/chat/completions`; the model list at
`/v1/models` "(also `/models`)" (BerriAI/litellm proxy endpoint reference). Our adapter
appends `/chat/completions` to the base URL and discovery appends `/models`, so both
resolve on the root spelling; the `/v1` spelling is carried in the gateway set (D4) for
users who hand-edit.

**Alternatives considered**: Shipping `http://localhost:4000/v1` (equally valid; root
chosen to match LiteLLM's own quickstart docs); a port/hostname prompt in the UI (new
UI surface, rejected).

## D4 — Gateway set entries (`KNOWN_GATEWAY_BASEURLS`)

**Decision**: Add **7** URLs to the set in `src/lib/agent/capability.ts` (13 → 20
entries): the four shipped base URLs from D3 plus the three variant/alias spellings —
`https://opencode.ai/zen/go/v1`, `http://localhost:4000/v1`,
`https://router.eu.requesty.ai/v1` — so tools default on regardless of which valid
spelling the user ends up with (spec FR-004, edge cases "endpoint variants" and
"trailing version path").

**Rationale**: Research 004 implementation checklist item 2; set-matching is
exact-string after trailing-slash strip (`capability.ts:45`), so every documented-valid
spelling of a supported router must be listed explicitly.

**Alternatives considered**: Adding only the 4 canonical URLs (a Zen-Go subscriber or
EU-Requesty user editing the base URL would silently lose tools-on-by-default);
host-based prefix matching (code change to the resolver — unnecessary for a static
catalog; rejected as it alters the capability seam's contract).

## D5 — Fallback model lists and default models

**Decision**: Ship 2–3 fallback models per template, snapshotted **at implementation
time** from each router's live `/models` (discovery supersedes the list anyway):

- **OpenCode Zen**: prefer free-tier models (research 004: 7 free models; free IDs like
  `*-free` variants observed in the wild). Default = a free model so first chat works
  at zero cost; second entry = a flagship for key-holders.
- **LiteLLM**: generic placeholder aliases only (e.g. one OpenAI-style and one
  Anthropic-style name) — the live listing returns exactly the user's configured
  `model_list` aliases and is the only real catalog (research 004). Placeholders are
  first-paint only and expected to be wrong for any given user; description says so.
- **Vercel AI Gateway**: 2 namespaced IDs from the live listing (e.g.
  `openai/…`-flagship + a smaller tier), excluding any `type: "embedding"` entries.
- **Requesty**: 2 namespaced IDs from the live listing (their docs use
  `openai/gpt-4o`-style examples; snapshot current).

Every `defaultModel` must be a member of its `models` array (existing integrity rule).

**Rationale**: Spec FR-003; mirrors 007's D5. Exact IDs are deliberately not frozen
into this plan because router catalogs churn (Zen deprecates aggressively;
Vercel/Requesty rotate) — the implementation task includes the snapshot step.

**Alternatives considered**: Freezing guessed IDs into the plan now (risks shipping
dead models); shipping empty fallback lists (breaks first-paint before discovery —
FR-003 requires immediate availability).

## D6 — LiteLLM keyless flow (`requiresKey: false`)

**Decision**: The LiteLLM template sets `requiresKey: false`, reusing the existing
keyless path pioneered by Ollama: the Add provider flow skips the key prompt, and
requests/discovery attach no `Authorization` header while no key is stored. A user
whose gateway enforces a master/virtual key simply saves one via the existing provider
key UI; from then on Bearer attaches (generic behavior — `model-discovery.ts` already
attaches auth iff a key exists).

**Rationale**: LiteLLM auth is optional (`LITELLM_MASTER_KEY` unset ⇒ open proxy);
spec FR-002 and User Story 2 scenario 2 require keyless completion. Zen free models
benefit from the same existing behavior (`requiresKey: true` there — a key is expected
for the catalog at large, but discovery still works pre-key because auth is attached
only when present).

**Alternatives considered**: `requiresKey: true` with a "skip" affordance (new UI
surface, rejected); auto-probing the gateway for auth requirements at setup (network
side effects during catalog selection, over-engineering).

**Test-rule consequence**: `registry.test.ts` integrity rules must be extended — the
`requiresKey: true` exception list grows from `{Ollama (local)}` to `{Ollama (local),
LiteLLM (self-hosted)}`, and the HTTPS-only `baseUrl` rule gains the
`http://localhost:4000` exemption alongside Ollama's `http://localhost:11434/api`.

## D7 — Discovery filtering: exclude embedding-typed entries (FR-008)

**Decision**: `parseModelIds` (`src/lib/ai/model-discovery.ts`) skips any entry that
carries `type === 'embedding'` (string, case-sensitive — the OpenAI/Vercel spelling),
in both the `{ data: [...] }` shape and bare arrays. Entries with no `type` field or
any other `type` value are kept unchanged.

**Rationale**: Vercel AI Gateway's `/v1/models` mixes chat and embedding models, and
embeddings cannot be chatted with — they would pollute every discovery result
(spec User Story 3 scenario 3, User Story 5). A one-value denylist is the most
conservative rule that fixes the observed problem: untyped catalogs (OpenRouter, Kilo,
Zen, LiteLLM, Groq…) are provably unaffected, and mistyped/unknown values pass through
rather than being over-filtered.

**Alternatives considered**: An allowlist of chat types (`type === 'chat'` etc.) —
rejected because most routers don't set `type` at all and would be emptied out; a
larger denylist (`image`, `video`, `audio`, `rerank`, …) — rejected as speculative
until observed (spec FR-008 pins embedding; extend later on evidence); filtering in
the UI layer instead of the parser — rejected, the picker would still receive
undiscoverable models via every other consumer.

## D8 — Auth, CORS, and the proxy

**Decision**: Zero per-router code. Zen/Vercel/Requesty: `requiresKey: true`; the
existing keychain fetch shim attaches `Authorization: Bearer`. CORS-blocked routers
stream through `POST /api/llm/proxy` automatically when the server is connected. Zen
(discovery documented pre-key) and LiteLLM (public `/models` when open) work keyless
through the existing attach-auth-only-when-present behavior.

**Rationale**: These mechanisms are generic and already shipped (research 004 "How
supporting a router works today"); reusing them is the entire Pareto argument (SC-006).

**Alternatives considered**: None — any per-router auth/proxy code would contradict
SC-006.

## D9 — Documentation scope

**Decision**: Update the README provider-list line (currently "…Moonshot Kimi, Qwen,
Groq, Mistral, Ollama, OpenRouter, and more…") to name OpenCode Zen, LiteLLM,
Vercel AI Gateway, and Requesty, keeping the "any OpenAI-compatible endpoint works
with a custom base URL" pointer for Tier-2 routers. Add a short note near the Ollama
docs about the container address caveat for self-hosted gateways (from inside Mayon's
Docker server, `localhost` resolves in-container; use `host.docker.internal` or the
host LAN IP).

**Rationale**: Research 004 checklist item 5; spec FR-009 and User Story 6 (including
scenario 3's container-topology guidance). No GitHub Models mention anywhere
(retired — spec FR-010).

**Alternatives considered**: A dedicated providers doc page (no existing docs-site
slot; README line matches current convention); templating Tier-2 routers (explicitly
rejected — spec FR-010 / research 004 Tier 2).

## D10 — Out of scope, confirmed

**Decision**: No templates or special handling for Chutes, NanoGPT, OpenCode Go,
Cloudflare AI Gateway, Helicone, Portkey, GitHub Models (retired 2026-07-30),
smart-routing selection startups, or direct enterprise-cloud integrations; no refresh
of the existing stale OpenRouter/Kilo fallback lists; no picker search/capacity UX for
400+ entry catalogs.

**Rationale**: Spec FR-010 and Assumptions; research 004 Tier 2/Tier 3 rationale and
its checklist item 6 (stale lists tracked separately); picker UX tracked in research
004's "Discovery polish" beyond the embedding filter.

---

## Resolution summary

| Unknown from spec/plan         | Resolved by                                        |
| ------------------------------ | -------------------------------------------------- |
| Router mechanism & effort      | D1 (S-effort, catalog-only)                        |
| Catalog order (FR-007)         | D2 (contiguous block at positions 6–9)             |
| Base URLs incl. variants       | D3 (LiteLLM root spelling verified against source) |
| Tools-on-by-default coverage   | D4 (7 gateway URLs, variants included)             |
| Fallback/default models        | D5 (implementation-time snapshot, per template)    |
| LiteLLM keyless setup (FR-002) | D6 (`requiresKey: false`, Ollama path reused)      |
| Embedding exclusion (FR-008)   | D7 (one-value denylist in `parseModelIds`)         |
| Auth/CORS/proxy                | D8 (existing generic paths)                        |
| Docs                           | D9 (README line + container address note)          |
| Non-goals                      | D10                                                |

All NEEDS CLARIFICATION resolved — none remain in Technical Context or the spec. The
only implementation-time steps are the D5 fallback snapshots (both outcomes valid by
design, discovery supersedes).
