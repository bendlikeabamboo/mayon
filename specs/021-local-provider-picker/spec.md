# Feature Specification: Local-First Grouped Provider Picker

**Feature Branch**: `021-local-provider-picker`

**Created**: 2026-09-06

**Status**: Draft

**Input**: User description: "Local-first grouped provider picker (hybrid: 001 + 003 + 004). Mayon users can connect local inference runtimes (LM Studio, vLLM) as providers, and can quickly find the provider they want even as the provider list keeps growing. Give the provider picker a spine instead of more rows: Local (Ollama, LM Studio, vLLM), Cloud APIs (key required), Gateways (routers like OpenRouter, LiteLLM, Kilo), and Custom, with a search box cutting across all groups. Onboard LM Studio (localhost:1234/v1) and vLLM (localhost:8000/v1) as openai-compatible entries living in the Local group with default base URLs and a connection test. Replace the URL-allowlist tool-capability guess with an explicit per-endpoint tools toggle the user asserts for their own endpoint. Connection failures get classified and coached, not raw: LM Studio's CORS-off default produces a guided fix, while connection-refused reads as 'server not running.'"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect a local inference runtime (Priority: P1)

A user who runs an inference server on their own machine opens the provider picker, finds a **Local** group containing Ollama, LM Studio, and vLLM, selects LM Studio, and sees the default address already filled in (their machine's standard local address and port). They run a connection test, which confirms the server is reachable and retrieves the list of models it serves. On success the provider is saved and its models become selectable for chat — no API key, no documentation spelunking.

**Why this priority**: Local/self-hosted inference (privacy, cost, offline use) currently has no first-class path into Mayon. This is the headline capability of the feature and delivers value even if the picker remained a flat list.

**Independent Test**: With a local runtime running at its default address, a user can go from "open provider picker" to "send a chat message through that runtime" using only the provider setup screen — never typing an address by hand or entering an API key.

**Acceptance Scenarios**:

1. **Given** LM Studio is running with default settings, **When** the user selects it in the Local group and runs the connection test, **Then** the test succeeds against the prefilled default address, the served model list is shown, and the saved provider can complete a chat reply.
2. **Given** vLLM is serving at its default port, **When** the user selects vLLM and runs the connection test, **Then** the test succeeds against the prefilled default address and the saved provider can complete a chat reply.
3. **Given** a runtime listening on a non-default host or port, **When** the user edits the address before testing, **Then** the test runs against the edited address and a successful test persists the edited address.
4. **Given** the runtime is not running, **When** the user runs the connection test, **Then** the test fails with a classified, coached message (see User Story 4), and the user can retry or still save the entry to configure later.

---

### User Story 2 - Find the right provider via groups and search (Priority: P2)

A user scanning the provider picker sees a small number of labeled groups — **Local**, **Cloud APIs**, **Gateways**, **Custom** — instead of one long undifferentiated list. Every registry entry lives in exactly one group, including every provider added in the future. A search box above the groups filters entries across all groups by name as the user types; groups with no matches are hidden while searching, and clearing the search restores the full grouped list.

**Why this priority**: Findability is the second headline goal: the provider list has grown long enough that locating an entry is friction that compounds with every addition. Grouping plus search is what keeps the picker usable as the registry grows.

**Independent Test**: With 20+ provider entries configured/registered, a user can locate any specific entry within seconds either by scrolling its group or by typing a fragment of its name into the search box.

**Acceptance Scenarios**:

1. **Given** the full provider registry, **When** the user opens the picker, **Then** entries are presented under their group headings (Local, Cloud APIs, Gateways, Custom) with no ungrouped entries.
2. **Given** the user types a fragment of a provider's name into the search box, **When** matching entries exist, **Then** only matching entries are shown, each still visibly associated with its group, and non-matching groups are hidden.
3. **Given** an active search with no matching entries, **When** the user views the results area, **Then** a clear "no providers match" empty state is shown with a way to clear the search.
4. **Given** the user clears the search, **When** the picker re-renders, **Then** the complete grouped list is restored exactly as before searching.

---

### User Story 3 - Assert tool capability per endpoint (Priority: P2)

A user configuring any endpoint-based provider sees an explicit, visible toggle asserting whether that endpoint supports tool calling. The system no longer guesses capability from the endpoint's address. When the assertion is on, agent runs offer tools to that endpoint; when off, agent runs proceed without tools and the UI never implies tools are active. The assertion survives across sessions and is changeable at any time from the provider's configuration.

**Why this priority**: The previous address-based guessing silently disabled tools for unfamiliar endpoints — a bug class that bit quietly on first agent run. Explicit assertion retires that entire bug class for every endpoint-based provider at once, local and cloud alike.

**Independent Test**: For a custom endpoint, toggling the assertion off and on measurably changes whether agent runs send tools to that endpoint, with no other configuration change.

**Acceptance Scenarios**:

1. **Given** a custom endpoint the user knows supports tool calling, **When** the user enables the tools assertion and saves, **Then** subsequent agent runs send tools to that endpoint.
2. **Given** an endpoint with the tools assertion off, **When** an agent run targets that provider, **Then** the run proceeds without offering tools, and the provider's configuration visibly shows that tools are not enabled.
3. **Given** a provider saved before this feature existed whose effective behavior was derived from the old address-based rule, **When** the user upgrades and opens the provider, **Then** the provider still behaves as before (its prior effective tool behavior is preserved as an explicit assertion) and the user can change it.
4. **Given** any endpoint-based provider, **When** the user views its configuration, **Then** the tools assertion is visible and settable without leaving the provider setup.

---

### User Story 4 - Recover from connection failures with guidance (Priority: P3)

When a connection test fails, the user sees a short, specific message classifying the failure and naming a remedy — never a raw technical error alone. A server that is not running reads as "server not running — start LM Studio/vLLM and retry." A cross-origin block (the default posture of LM Studio on first connect) produces a guided fix that names the runtime's cross-origin setting and its command-line remedy. Wrong address and authentication failures are likewise called out distinctly.

**Why this priority**: The most common first-connect failure for local users (cross-origin blocked) is otherwise a dead end that drives users away; coaching converts it into a self-service fix. It refines Stories 1–3 rather than standing alone, hence P3 — but the two most common local failure classes must ship with the feature.

**Independent Test**: With a local runtime in each failure state (not running; cross-origin blocked; wrong address), running the connection test produces a distinct, actionable message per state, each naming a concrete next step.

**Acceptance Scenarios**:

1. **Given** LM Studio is running with its default cross-origin posture, **When** the user runs the connection test, **Then** the failure is classified as cross-origin-blocked and the message names the LM Studio cross-origin setting and the command-line remedy to enable it.
2. **Given** nothing is listening at the configured address, **When** the user runs the connection test, **Then** the failure is classified as "server not running" and the message suggests starting the runtime and checking the address.
3. **Given** the address points at a host that never responds, **When** the user runs the connection test, **Then** the test fails within a bounded time with a timeout/wrong-address classification rather than hanging.
4. **Given** an endpoint that requires credentials the user has not supplied, **When** the user runs the connection test, **Then** the failure is classified as an authentication problem and the message points at the credential field.

---

### Edge Cases

- **Local entry pointed off-machine**: A Local-group entry edited to a network host (another machine on the LAN) stays in the Local group — group membership is curated, not inferred from the address.
- **Duplicate endpoints**: A user creates a Custom entry pointing at the same address as a built-in Local runtime; both entries coexist in their own groups without conflict.
- **Very long model lists**: A heavily loaded local runtime serves dozens of models; the discovered list is scrollable in full. Search/grouping *within* a model list is explicitly out of scope (adjacent problem, deferred).
- **Legacy entries after upgrade**: Existing saved providers (including prior Ollama and custom entries) keep working, appear in an appropriate group without user action, and their effective prior tool behavior is preserved (see FR-013).
- **Missing category metadata**: An entry with missing/corrupted group metadata renders under Custom rather than disappearing from the picker.
- **Search interaction with setup**: Searching while a provider's setup panel is open does not discard unsaved edits.
- **No auto-detection temptation**: The picker MUST NOT show "detected/running" status for local runtimes; probing local runtimes is explicitly rejected scope (sequel material).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The provider picker MUST organize all registry entries into exactly four groups: **Local**, **Cloud APIs**, **Gateways**, and **Custom**.
- **FR-002**: The Local group MUST include entries for Ollama, LM Studio, and vLLM; the Cloud APIs group MUST contain key-required native providers; the Gateways group MUST contain router services (including OpenRouter, LiteLLM, and Kilo); user-defined endpoints MUST land in Custom.
- **FR-003**: Every registry entry MUST carry group metadata, and every newly added registry entry MUST be assigned to one of the four groups — the picker MUST NOT render ungrouped entries.
- **FR-004**: The picker MUST provide a search box that filters entries across all groups by name (case-insensitive, partial match); while searching, non-matching entries are hidden, groups with no matches are hidden, and clearing the search restores the full grouped list.
- **FR-005**: LM Studio and vLLM MUST be onboardable as OpenAI-compatible endpoint entries pre-filled with their default local addresses (LM Studio `localhost:1234`, vLLM `localhost:8000`), and the address MUST remain user-editable before and after testing.
- **FR-006**: A connection test MUST verify that the endpoint is reachable and MUST retrieve the list of models the endpoint serves; the discovered models become the selectable model list for the saved provider.
- **FR-007**: A failed connection test MUST present a message classified into actionable categories, including at minimum: server not running (connection refused), cross-origin blocked, wrong address / timed out, and authentication failure — each with a specific suggested remedy.
- **FR-008**: For a cross-origin-blocked failure against LM Studio, the guidance MUST name LM Studio's cross-origin setting and the command-line remedy for enabling it.
- **FR-009**: Tool capability for endpoint-based providers MUST be set exclusively by an explicit, per-endpoint user assertion (a visible toggle); the system MUST NOT infer tool capability from the endpoint's address or URL pattern.
- **FR-010**: The tools assertion MUST default to **enabled for all** endpoint-based providers (decided: Option C), and the default MUST be visible and overridable at configuration time. Endpoints that do not actually support tool calling are expected to surface their own refusal when offered tools, and the user's remedy is to switch the assertion off.
- **FR-011**: Agent runs MUST offer tools to an endpoint only while that endpoint's tools assertion is enabled; when disabled, runs MUST proceed without tools and the UI MUST NOT represent the provider as tool-capable.
- **FR-012**: The tools assertion MUST be visible and changeable in the provider's configuration at any time, and the setting MUST persist across sessions.
- **FR-013**: On upgrade, all previously saved providers MUST continue to work, appear in an appropriate group without user action, and have their prior effective tool behavior preserved as the initial value of the explicit assertion.
- **FR-014**: Local-group entries MUST accept any host address (localhost or network host); group membership is fixed curation, never re-derived from the address.
- **FR-015**: The system MUST NOT probe, scan, or auto-detect whether local runtimes are running, and the Local group MUST NOT display running/detected status indicators.

### Key Entities *(include if feature involves data)*

- **Provider entry**: A connectable inference source in the registry. Attributes: display name; group (Local | Cloud APIs | Gateways | Custom); endpoint style (native provider API vs. OpenAI-compatible endpoint); default address (built-ins only); user-editable endpoint address; whether a credential is required.
- **Endpoint configuration**: The user's concrete settings for one provider entry: endpoint address, credential (when required), and the explicit tool-support assertion.
- **Group**: The fixed four-value taxonomy (Local, Cloud APIs, Gateways, Custom) used for organizing the picker and scoping search; a permanent metadata attribute of every registry entry.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user with a running local runtime completes "open picker → send a first successful chat message through it" in under 2 minutes using only default addresses and no API key.
- **SC-002**: With 20+ provider entries in the registry, a user can locate any specified entry within 10 seconds using either its group or the search box (verified in a walkthrough).
- **SC-003**: Search results update as the user types, showing only matching entries in under 1 second for a registry of 25+ entries.
- **SC-004**: 100% of failed connection tests display a classified message naming a specific remedy for the failure class; in moderated testing, at least 8 of 10 first-time testers recover unaided from the two most common local failures (server not running, cross-origin blocked).
- **SC-005**: Zero cases of tools being omitted from agent runs while the user's assertion is enabled (and vice versa) — the silent tools-off bug class is verifiably eliminated end-to-end.
- **SC-006**: Adding a new provider to the registry requires only assigning it to an existing group — no changes to the picker itself — keeping per-addition cost flat as the registry grows.

## Assumptions

- Group membership is curated metadata on registry entries, not derived from user configuration; users cannot create, rename, or move entries between groups. Odd cases belong in Custom.
- Routers (OpenRouter, LiteLLM, Kilo) are Gateways even when they require API keys; "Local" describes the runtime class (self-hosted, key-free), not a specific machine.
- Search matches provider entry names only — not the individual models an endpoint serves.
- The connection test is user-initiated (setup-time), consistent with the no-probing constraint; results are not continuously re-checked in the background.
- Out of scope for this feature: auto-detection/"running" status for local runtimes (explicitly deferred as sequel material); search/grouping within long model lists; native per-runtime APIs for LM Studio/vLLM (they ride the generic OpenAI-compatible kind; later first-class upgrades imply config migration); routing local traffic through Mayon's server proxy (local traffic stays direct, keeping the runtime's cross-origin setting a user-side prerequisite).
- The tools assertion defaults to **on for every endpoint-based provider** (owner ruling, 2026-09-06): tools work out of the box everywhere, accepting that non-tool endpoints will refuse the offered tools and the user turns the assertion off. Known-to-support curated local runtimes (LM Studio, vLLM) therefore need no extra step.
