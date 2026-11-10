# Contract: Fix-Action Send Preflight (feature 036)

**Feature**: 036-mermaid-repair-integrity | **Seam**: `chatStore.send()` (`src/lib/stores/chat.svelte.ts`)

**Amends**: `specs/028-mermaid-error-repair/contracts/fix-affordance.md` (§Availability)
**in place**, cross-referenced from feature 036. The trigger payload (one visible canned
user message: re-emit instruction + original source verbatim + failure reason) and the
cost bound (exactly one send per activation, no automatic re-sends) are UNCHANGED.

## Preflight (036 addition to `send()`)

- `send()` resolves the active provider (`getActiveSdkProvider()`) BEFORE persisting
  the user row and BEFORE entering the streaming state.
- If provider resolution rejects: map and surface the error through the established
  presentation (`formatProviderError(mapSdkError(err))` into the store error state),
  record `lastFailedPrompt` (retry affordance unaffected), persist NOTHING, and return
  without streaming.
- Consequence for the fix affordance (issue #72 item 4): activating "Fix this diagram"
  with no resolvable provider persists no row of any kind; the user sees the same
  configuration guidance the composer path shows — never a silent no-op and never an
  orphan user row.
- All other send entry points (composer, regenerate) inherit the same guarantee — the
  protection lives in the shared path, not in the affordance.

## Availability clause (supersedes the 028 wording's mechanism note)

028 stated availability indirectly ("the conversation cannot send at all"). 036 makes
the mechanism explicit: the action is rendered whenever a handler exists (unchanged),
and its effect is safe exactly when sending is possible because `send()` itself
preflights. No reactive provider state is threaded into the runtime-created error
block.

## Unchanged

- Message kinds, hidden flags, metadata coupling (none), server surface, streaming
  lifecycle after the preflight passes (provider resolution no longer happens inside
  the post-append try; the resolved provider is reused for the turn).
- Existing surfaced-error contract for provider failures (missing key guidance,
  removed-provider guidance, no-model guidance) — identical text, earlier timing.
