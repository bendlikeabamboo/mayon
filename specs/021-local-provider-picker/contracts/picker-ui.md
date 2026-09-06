# Contract: Provider Picker UI — grouped, searchable catalog

**Feature**: `021-local-provider-picker` | **Source of truth**: `src/lib/components/ai/ProviderConfig.svelte` (Settings → Providers)
Consumers: none (leaf UI). Sibling contracts: [provider-registry.md](./provider-registry.md), [connection-test.md](./connection-test.md). Rationale: [../research.md](../research.md) D9.

## Add-provider picker (catalog)

1. **Groups** — the template catalog renders as four labeled sections in order **Local → Cloud APIs → Gateways → Custom**, each with a heading and a one-line description:
   - *Local* — "Run models on your own machine. No API key required."
   - *Cloud APIs* — "Hosted model APIs. Requires an API key."
   - *Gateways* — "Routers that broker many providers behind one endpoint."
   - *Custom* — "Your own OpenAI-compatible endpoint."
2. **Entries** — each template renders as the existing 2-column button grid item (label + description, established visual pattern), plus a small "no key required" badge on `requiresKey: false` entries (Local, LiteLLM). Template order within a group is registry order.
3. **Search** — one input above the groups:
   - Filters across **all groups** on the provider **name** (label) only, per spec FR-004 and the Assumptions section ("search matches provider entry names only"), case-insensitive substring, applied as the user types (target < 1 s — trivially met client-side).
   - While searching: non-matching templates hidden; groups with zero matches hidden entirely; match counts per visible group are optional but the group context of each hit remains visible.
   - No matches → empty state: "No providers match '<query>'." with a **Clear search** action.
   - Clearing (action or empty input) restores the full grouped list, order unchanged.
   - Search operates on the **catalog only**; it does not filter configured-provider cards and does not discard unsaved card edits (edge case from spec).
4. **Selection** — clicking a template runs the existing `addFromTemplate` flow (config copied with `group`, `requiresKey`, `toolCapability: 'on'`; first provider auto-activates). For discovery-first Local templates the existing auto-discovery runs once at add — failures surface through the connection-test coaching copy on the card, not a dead end.

## Configured-provider cards

1. **List** — remains a single list (grouping applies to the catalog, which is what grows; the user's own set is short).
2. **Test connection** — new button (with in-flight "Testing…" state) for discoverable providers; renders `ConnectionTestResult` in the existing status line: success → "Connection OK — N models found."; failure → classified `title` + `message` (+ `hint`). Not rendered for Ollama.
3. **Tool capability** — the existing select becomes two explicit options **Enabled / Disabled** (default **Enabled**, per ruling Q1:C; `'auto'` is gone). The label keeps plain language: "Tools let the agent call Mayon's tools through this provider." The stored value persists across sessions.
4. **API key section** — hidden when `requiresKey(config)` is false (LM Studio, vLLM; LiteLLM unchanged). Visible otherwise, unchanged.
5. **Default model** — for discovery-first Local entries the select starts empty; the first discovered model auto-fills only while empty. The existing "saved model no longer offered → pick another" guard is unchanged.
6. **Background discovery** — silent load-time discovery keeps running for gateways/cloud but is **skipped for Local-group providers** (no probing; FR-015). No "running/detected" indicator is ever rendered.

## Visual / interaction conventions

- Composed from the existing Tailwind v4 + shadcn-svelte vocabulary (`Input`, `Button`, `Badge`-style chip, existing status-line pattern); search input follows the `SettingsSearch`/`ModelSelect` idiom. No new primitives, no new dependencies.
- Progressive degradation: everything here is client-side catalog data + browser-direct fetch; no behavior assumes the server is present (loopback bypass keeps locals fully functional without it).

## Acceptance anchors (from spec)

- US1: LM Studio/vLLM connect with prefilled defaults, editable address, test → models → chat, no key (SC-001).
- US2: every catalog entry under exactly one group heading; search filters across groups; empty state; clear restores (SC-002/003).
- US3: toggle visible/settable per provider; off ⇒ runs proceed tool-less and the card never claims tool support (SC-005).
- US4/FR-015: failures coached per [connection-test.md](./connection-test.md); no detection/status indicators anywhere.
