# Feature Specification: Brave Search MCP Service

**Feature Branch**: `001-brave-search-mcp`

**Created**: 2026-08-18

**Status**: Draft

**Input**: User description: "I want to be able to connect to the brave search MCP. We are currently in a docker compose architecture so having an additional container is no problem. The reasoning behind this is sometimes the models knowledge is outdated and we need to have a way to update the knowledge of the model using external validation."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Connect to a self-hosted Brave Search service (Priority: P1)

A self-hoster opens the app and adds the Brave Search connection like any other MCP server, supplying their Brave Search API key through the app's existing credential handling and confirming trust. The Brave search tools appear in the app's tool list and are ready for use. No third-party intermediary service is involved, no stack reconfiguration is required, and the API key never appears in a URL or leaves the app's credential handling.

**Why this priority**: Nothing else in this feature is possible without a working, private connection. This story alone is a viable MVP — a connected, verified search toolset the user can invoke.

**Independent Test**: Can be fully tested by adding the connection with an API key in the app and invoking a search tool from the app's tool inspection UI.

**Acceptance Scenarios**:

1. **Given** the Mayon server is running, **When** the user adds the Brave Search connection and saves a valid API key, **Then** the connection shows a healthy status and the search tools (web search at minimum) are listed as available.
2. **Given** the Mayon server is not connected, **When** the user views available connections, **Then** the Brave Search connection is presented as unavailable with guidance, and no other app functionality is impaired.
3. **Given** the user saved an invalid API key, **When** a search runs, **Then** the user sees a clear, actionable error identifying the credential problem.

---

### User Story 2 - Fresh, source-backed answers via external validation (Priority: P2)

During a conversation, the user asks about something recent or fast-moving that the model's built-in knowledge cannot answer reliably. The model recognizes the gap, queries web search, and answers using current results. The user can see which sources the answer drew from, so the answer is trustworthy and checkable rather than a stale guess.

**Why this priority**: This is the core value motivation — updating and validating model knowledge externally. It depends on Story 1's connection, but delivers the user-visible payoff.

**Independent Test**: With a connected Brave Search service, ask a set of questions whose answers changed after the model's training cutoff and verify answers are correct and cite current sources.

**Acceptance Scenarios**:

1. **Given** a healthy search connection and a conversation, **When** the user asks a question about a recent event, **Then** the model consults web search before answering and the answer reflects current information.
2. **Given** the model used search results in a reply, **When** the user reads the reply, **Then** the consulted sources are visible alongside the reply (e.g., result titles and links).
3. **Given** search results conflict with the model's prior knowledge, **When** the model answers, **Then** the answer favors the fresh external data and the discrepancy is acknowledged.

---

### User Story 3 - Dependable operation and graceful degradation (Priority: P3)

The user relies on the app daily. The search service can fail independently — outage, expired key, exhausted quota, slow responses — without harming normal chat. The user can check the connection's status, understand failures from clear diagnostics, and toggle the connection on or off (globally and per conversation) using the app's existing tool controls.

**Why this priority**: Hardens the feature for real self-hosted operation; valuable but not required for the first usable slice.

**Independent Test**: Stop the search service mid-session and verify ongoing conversations complete normally with an unobtrusive notice, then restore it and verify recovery without an app restart.

**Acceptance Scenarios**:

1. **Given** an active conversation, **When** the search service becomes unreachable or the key quota is exhausted, **Then** the model still completes the reply using its own knowledge and the user is informed that external validation was unavailable.
2. **Given** the search service recovers, **When** the user sends the next message, **Then** search tools work again without restarting the app or the stack.
3. **Given** the user disables the search connection for a conversation, **When** they send a message, **Then** the model answers without attempting web search.

---

### Edge Cases

- What happens when the search service is unreachable or times out mid-reply? (Chat must complete with a notice; no hanging or failed turns.)
- How does the system handle an invalid, expired, or missing API key? (Actionable error at connect time and at use time.)
- How does the system handle exhausted quota or rate limiting? (Clear diagnostic; graceful fallback to unvalidated answers.)
- What happens when a query returns zero results? (Model says so and answers from prior knowledge with that caveat.)
- How are unusually slow search responses handled? (Bounded wait; the reply proceeds without external validation if the wait is exceeded.)
- What happens when the API key changes or is rotated? (User updates the credential in one place; connection resumes.)
- How is the API key protected in transit and at rest? (Stored via the app's existing credential handling — never in the app database settings, never in URLs or logs.)
- What happens when the MCP server package version is updated? (The connection pins a package version; upgrades ride app releases, never mid-session.)
- How does the feature behave when deployed in the development stack versus the production stack? (Consistent behavior and configuration experience across both.)

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST allow the user to establish a Brave Search connection backed by the official Brave Search MCP server, configured in one place through the app's existing MCP server management.
- **FR-002**: System MUST capture the Brave Search API key exclusively through the app's existing credential mechanism for provider secrets; the key MUST NOT be stored in the app's settings store, transmitted in URLs or query parameters, or written to logs.
- **FR-003**: Once connected and enabled, System MUST expose the Brave search toolset (web search at minimum) to the model as invocable conversation tools using the app's existing MCP tool management.
- **FR-004**: When a reply incorporates external search results, System MUST make the consulted sources visible to the user alongside the reply.
- **FR-005**: Enabling or disabling the connection, and rotating its credential, MUST NOT require stack reconfiguration or restarts of any running service.
- **FR-006**: System MUST degrade gracefully: when the search service is absent, disabled, or failing, all non-search functionality MUST continue to work, and the model MUST complete replies from its own knowledge with a notice that external validation was unavailable.
- **FR-007**: System MUST present connection status and actionable diagnostics for the failure modes: unreachable service, invalid credential, and exhausted quota or rate limit.
- **FR-008**: The feature MUST behave consistently across development and production deployments of the stack.
- **FR-009**: Users MUST be able to enable or disable the Brave Search connection globally and per conversation, consistent with existing tool controls.

### Key Entities _(include if feature involves data)_

- **Search Connection**: A named connection entry representing the Brave Search server (official package, pinned version), its enabled/trusted state, and a reference to its stored credential (never the credential itself).
- **Search Credential**: The user's Brave Search API key, held by the app's existing secret store and referenced by the Search Connection.
- **Search Tool**: An invocable tool exposed by the connection (web search at minimum; optionally local, news, image, and video search) with a name, description, and input schema.
- **Search Citation**: A source consulted for a given reply — title, destination link, and brief excerpt — linked to that reply for provenance.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user with a Brave API key can go from opening settings to a verified, healthy connection in under 2 minutes.
- **SC-002**: On a test set of 20 questions whose correct answers postdate the model's training data, at least 90% are answered correctly with current external sources.
- **SC-003**: 100% of replies that used search results display the consulted sources to the user.
- **SC-004**: Search-augmented replies complete within 10 seconds of the equivalent reply without search.
- **SC-005**: With the search service stopped or failing, 100% of normal conversation turns still complete successfully with an unobtrusive unavailability notice.

## Assumptions

- Users obtain their own Brave Search API key (free or paid tier); Mayon does not bundle or proxy Brave billing.
- The app's existing MCP connection management (connection templates, secret store, trust prompt, per-conversation tool toggles) is extended rather than replaced; no new settings subsystem is introduced. Credential custody lives in the app's secret store for consistency with every other credentialed MCP server (revised 2026-08-19 from an earlier deployment-env custody model — see research.md R-9).
- This connection replaces reliance on third-party-hosted Brave MCP endpoints; no external intermediary sits between the user and Brave's search API.
- Model-driven tool use decides when to search; users can also explicitly request a web search in conversation. No separate "research mode" UI is built for v1.
- Scope is limited to conversational external validation. Bulk web ingestion, crawling, or building a persistent search index into the knowledge base are out of scope for v1.
- The connection runs the official Brave MCP server package (pinned); its toolset and Brave's API usage limits (quotas, rate limits) are taken as given. An invalid key is detectable only when a search actually runs (the MCP handshake itself succeeds).
