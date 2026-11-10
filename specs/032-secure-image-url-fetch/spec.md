# Feature Specification: Secure image-URL fetching (credential containment + relay hardening)

**Feature Branch**: `fix/issue-69-image-url-credential-leak`

**Created**: 2026-11-10

**Status**: Draft

**Input**: User description: "security: provider API key is sent to model-supplied image URLs (credential leak + SSRF) — GitHub issue #69 (P1, security). A model-supplied assistant image URL is fetched at finalize through the provider keychain fetch, and that fetch attaches the provider API key to whatever URL it is given. The URL is untrusted model output and may point anywhere. The server relay then forwards those headers verbatim to the target host. Fix: never use the provider keychain fetch for arbitrary model-supplied URLs (credential-free unless the URL host matches the provider host or an explicit CDN allowlist); strip auth headers in the proxy when the target host is not the configured provider host; reject loopback/link-local/private targets; enforce a response-size cap; add regression tests (foreign-host URL observes no auth header; private-IP target rejected)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - No provider credential leaks to non-provider hosts (Priority: P1)

When an assistant reply carries a model-supplied image link, Mayon materializes (downloads) that
link at finalize time so the reply is self-contained. Today that download rides the provider
credential fetch, so the user's provider API key is attached to whatever host the model named —
an attacker-controlled host exfiltrates the key. After this feature, a model-supplied link is
fetched **credential-free** unless its host is exactly the configured provider API host (the
allowlist). The user's key can then only ever be observed by the provider the user configured.

**Why this priority**: Direct secret exfiltration of the user's API key — the most severe
consequence in the issue, and the cheapest to stop (the decision happens where the credential
is attached).

**Independent Test**: A stubbed fetch observing the outbound request for a foreign-host image
link sees no credential header, while a provider-host link still carries it; both behaviors are
asserted by automated unit tests that fail before the fix.

**Acceptance Scenarios**:

1. **Given** an assistant stream emits an image link pointing at a host other than the
   configured provider API host, **When** the reply is finalized and the link materialized,
   **Then** the outbound request carries no provider credential (no missing-key failure is
   introduced for keyless providers either).
2. **Given** an image link whose host **is** the configured provider API host, **When** it is
   materialized, **Then** the request carries the credential as before (provider-host image
   delivery keeps working).
3. **Given** the provider is a keyless local runtime, **When** a foreign-host image link is
   materialized, **Then** the fetch proceeds credential-free instead of failing on a missing key.
4. **Given** a link that cannot be fetched (blocked, dead, oversized, non-image), **When** the
   reply is finalized, **Then** the existing contained inline notice is appended and the reply
   persists — no broken frame, no dropped message, no error surfaced to the turn.

---

### User Story 2 - The server relay refuses unsafe targets and bounds transfers (Priority: P2)

All provider traffic from the browser flows through the server relay. A model-supplied URL
therefore makes the relay fetch arbitrary hosts from the server's network position: an
authenticated SSRF into loopback/link-local/private addresses (databases, metadata services,
admin panels) plus unbounded response buffering into client memory. After this feature the
relay: rejects non-public destinations (literal IPs **and** DNS-resolved addresses — loopback,
link-local, private, unique-local, unspecified, shared CGNAT space); forwards credential headers
only when the destination host matches the provider host declared by the request (absent or
mismatched declaration → credentials stripped); refuses redirects; and enforces a response-size
cap while streaming.

**Why this priority**: Defense-in-depth behind story 1 — it contains the blast radius even if a
client-side gate regresses, and it is the only layer that can see the server's network position.

**Independent Test**: Relay-level tests inject requests directly: a private-IP target is
refused, a credential header for a non-declared host is not forwarded, a redirecting upstream is
refused, and an oversized response is cut off — each asserted against a stubbed upstream.

**Acceptance Scenarios**:

1. **Given** a relay request whose destination resolves to a loopback, link-local, private,
   unique-local, unspecified, or shared CGNAT address (whether written as a literal or resolved
   via DNS), **When** the request arrives, **Then** the relay refuses it with a distinct
   "blocked target" response and performs no upstream fetch.
2. **Given** a relay request carrying a credential header but declaring no provider host (or a
   host different from the destination), **When** the relay forwards it, **Then** the credential
   headers are stripped before the upstream fetch; the request itself still proceeds.
3. **Given** a destination that declares a matching provider host, **When** forwarded, **Then**
   credential headers pass through unchanged — legitimate provider traffic (chat, model
   discovery, connection tests, Copilot) behaves exactly as today.
4. **Given** an upstream that answers with a redirect, **When** the relay performs the fetch,
   **Then** the redirect is not followed (the fetch fails; the relay reports an upstream error
   rather than forwarding credentials or the connection to a new host).
5. **Given** an upstream response whose body exceeds the relay cap (64 MiB), **When** it is
   streamed, **Then** the stream is cut off with an error rather than passing through unbounded.
6. **Given** a destination hostname that does not resolve, **When** the request arrives,
   **Then** the relay fails the request (fail-closed) as an upstream failure.

---

### User Story 3 - Regression verification and unchanged legitimate behavior (Priority: P3)

The two acceptance cases from the issue must be locked in by automated tests that fail without
the fix, and everything that worked before must keep working: streaming chat with every provider
kind, model discovery, connection tests, Copilot, and keyless local runtimes (including
providers whose API host itself is a loopback address). Failed or blocked images keep degrading
to the existing inline notice.

**Why this priority**: Guarantees the fix is durable and side-effect-free rather than adding new
behavior; it is the issue's explicit "both cases are covered by automated tests" acceptance
clause.

**Independent Test**: Full existing suites (client and server) pass plus the new regression
tests; a documentation note records the new relay contract.

**Acceptance Scenarios**:

1. **Given** the pre-fix code, **When** the new regression tests run, **Then** they fail
   (foreign host observes a credential; private target is fetched) — and pass after the fix.
2. **Given** any supported legitimate flow, **When** exercised by the existing test suites,
   **Then** behavior is unchanged (no new errors, no dropped headers on declared hosts).

---

### Edge Cases

- Data-URL images (base64 inline) never hit the network — unaffected.
- A provider whose API host **is** a loopback address (local runtimes): browser-direct traffic
  keeps working by existing design; the credential allowlist still applies client-side, and the
  relay's public-target rule only governs relayed requests, not browser-direct ones.
- Host comparison details: case-insensitive hostname equality, trailing dots normalized, ports
  ignored, no subdomain wildcarding — `cdn.provider.example` is a different host from
  `api.provider.example` (conservative).
- Redirect from the provider host to an attacker host: refused (no redirect following), which
  also closes custom credential headers surviving cross-origin redirects.
- An image larger than the client-side materialization cap (32 MiB): treated as un-fetchable →
  inline notice.
- Obfuscated address forms (hex/octal IPv4, IPv4-mapped IPv6, bracketed IPv6): normalized before
  the public-target check.
- DNS rebinding (validate-then-connect race between the check resolution and the fetch
  resolution): accepted as a documented residual risk for this single-user, self-hosted threat
  model.
- A credential header arrives with no provider-host declaration at all (older/foreign caller):
  stripped (fail-closed default).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST NOT attach any provider credential to a request whose destination
  host is not on that provider's credential allowlist.
- **FR-002**: The credential allowlist for a provider MUST consist of exactly the configured
  provider API host (exact hostname match; no subdomains, no wildcards), compared
  case-insensitively with trailing dots normalized and ports ignored.
- **FR-003**: Requests whose destination host **is** the configured provider API host MUST
  continue to carry the provider credential exactly as before (no regression to provider
  traffic).
- **FR-004**: The server relay MUST strip all credential headers from a forwarded request
  unless the request declares a provider host that equals the destination host; a missing
  declaration MUST be treated as a mismatch (credentials stripped, request otherwise proceeds).
- **FR-005**: The server relay MUST refuse any destination that is a loopback, link-local,
  private, unique-local, unspecified, or shared CGNAT address — checking both literal IP
  destinations and every address returned by DNS resolution of the destination hostname — and
  MUST perform no upstream fetch for refused destinations.
- **FR-006**: The server relay MUST NOT follow redirects when fetching an upstream destination.
- **FR-007**: The system MUST enforce bounded transfers: relayed responses larger than 64 MiB
  MUST be cut off with an error, and image materialization MUST NOT buffer more than 32 MiB.
- **FR-008**: An image link that is blocked, dead, non-image, or over the materialization cap
  MUST degrade to the existing contained inline notice (the reply persists searchable; the turn
  does not error).
- **FR-009**: Legitimate provider flows (streaming chat for every provider kind, model
  discovery, connection tests, Copilot session traffic, keyless local runtimes including
  loopback API hosts) MUST behave exactly as before this change.
- **FR-010**: Automated regression tests MUST cover both acceptance cases from the issue: (a) a
  foreign-host image URL observes no credential header end-to-end, and (b) a private-IP relay
  target is rejected — and these tests MUST fail against the pre-fix behavior.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An automated test observes zero provider credentials on a foreign-host image
  materialization (fails pre-fix, passes post-fix).
- **SC-002**: An automated test exercises each non-public target class (loopback, private,
  link-local) through the relay and observes a refusal with no upstream fetch (fails pre-fix,
  passes post-fix).
- **SC-003**: 100% of the pre-existing client and server test suites still pass after the
  change (no legitimate-flow regressions).
- **SC-004**: 100% of blocked, dead, or oversized image links render the existing inline notice
  while the reply persists (no new user-visible error states).

## Assumptions

- **No CDN allowlist initially.** The issue permits credentials for "the provider `baseUrl` host
  or an explicit provider CDN allowlist". The security-conservative default chosen: the
  allowlist is the provider API host only; public CDN links are fetched credential-free (CDN
  image delivery does not require the API key). A CDN allowlist can be added later without
  protocol changes.
- **Redirect policy = refuse.** The relay never follows redirects. A redirecting image link
  degrades to the inline notice; API endpoints in practice do not redirect under key auth.
- **Caps fixed at 64 MiB (relay) and 32 MiB (image materialization).** 64 MiB comfortably
  exceeds any legitimate streamed chat reply (the request-side ceiling is already 16 MiB) while
  bounding abuse; 32 MiB generously covers any generated image while bounding client memory.
- **Silent strip at the relay.** The issue says "strip", not "reject": mismatched-credential
  requests proceed without credentials (a genuine need for the key then surfaces as an upstream
  auth error — loud, but not a new failure mode). Refused *targets* (FR-005) are rejected, not
  stripped.
- **Fail-closed on unresolvable destinations** (treated as upstream failure). A hostname that
  cannot be resolved cannot be proven public.
- **Browser-direct loopback traffic is out of relay scope.** Existing behavior deliberately
  bypasses the relay for loopback targets (local runtimes unreachable from the server
  container); the client-side credential rule (FR-001) still applies there, and the relay's
  target refusal (FR-005) governs only relayed requests.
- **Client and relay ship together** (same repository release), so the new relay declaration
  field and its senders are version-locked; no compatibility shim is needed.
- **DNS-rebinding TOCTOU is an accepted residual risk.** Destination validation resolves the
  hostname once; the subsequent fetch performs its own resolution. Pinning the connection to the
  validated address would require transport-level changes out of proportion for a single-user,
  self-hosted deployment; documented instead.
- **Threat model**: the attacker is untrusted model output (prompt-injected or hostile
  gateway), not the user's own browser session; the browser app itself is trusted to declare
  its provider host truthfully.
