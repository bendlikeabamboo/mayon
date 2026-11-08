# Quickstart: Conversational Back-Propagation Tool (027)

Phase 1 output — runnable validation scenarios proving the feature end to end. Unit
scenarios run against the pglite test driver; the e2e scenario runs the mock-LLM
fixture server. Contract references: [contracts/propagate-tool.md](./contracts/propagate-tool.md),
[data-model.md](./data-model.md).

## Prerequisites

```bash
pnpm install                                  # fresh worktree: deps are not committed
pnpm --filter @mayon/shared build             # consumers resolve shared types from dist/
```

## Commands

```bash
pnpm test                                     # all web unit/integration scenarios (V0–V5)
pnpm test -- deterministic-tools              # just the tool unit suite
npx playwright test tests/e2e/backprop-tool.spec.ts   # V6 e2e (mock LLM)
pnpm check && pnpm lint                       # gates
pnpm dev                                      # manual smoke on http://localhost:5173
```

## Validation scenarios

### V0 — Tool unit gates (`deterministic-tools.test.ts`)

Setup: pglite db (`useFileTestDb()` pattern); a root chat, a branch with one exchange,
an empty branch. Act: invoke the tool's `run` directly with each state.

- Not-a-branch → `{ok:false}` with the "not a branch" reason; zero parent writes.
- Empty branch → `{ok:false}` with the "no messages" reason.
- Busy latch (pre-acquired) → `{ok:false}` with the "already running" reason.
- Bad `mode` value → `{ok:false}` (schema-level or run-level rejection).

Expected: every refusal shape matches the contract; parent tables untouched after each.

### V1 — Raw happy path (`deterministic-tools.test.ts`)

Setup: branch with a multi-turn exchange (including a tool-result turn). Act: `run({})`
(no mode).

Expected: exactly one `branch_artifact` row in the parent, anchored per `resolveAnchor`,
metadata `mode: 'raw'`, content = the verbatim delta (excerpt + `[user]`/`[assistant]`/
`[tool: …]` prefixed turns); result `{ok:true}` naming parent title + raw mode; latch
released (a second `run` proceeds).

### V2 — Summary path and failure ordering (`deterministic-tools.test.ts`, `vi.mock` the summary generator)

- Happy: mocked summary returns text → artifact row with `mode:'summary'`,
  `summaryTraceId` set from the mock; result summary names "summary" mode.
- Generator throws → `{ok:false, 'summary generation failed…'}`; **zero** rows inserted
  in the parent (FR-007 ordering: generate first, insert only on success).

### V3 — Approval decline (`loop.test.ts` or tool suite)

Setup: turn harness with `requestApproval` resolving `{approved:false}`. Act: model
emits `propagate_to_parent`. Expected: result `'user declined'`, no latch acquired, no
writes; the tool is not re-run within the turn.

### V4 — Availability gating (`chat.svelte.test.ts`)

Setup: chats per state; run turn assembly (or assert the computed `disabledToolIds`).

- Root chat turn → `disabledToolIds` contains `propagate_to_parent`.
- Branch with messages → id absent.
- Empty branch → id present.

Expected: the definition the model sees exists iff branch ∧ has-messages (FR-001).

### V5 — Preamble (`brief.test.ts`)

`buildCapabilitiesPreamble()` contains the back-propagation lines: only-on-request /
single-offer rule, confirm-in-1–2-sentences rule, no-content-reproduction rule,
manual-fallback line. (Additive assertions alongside the existing preamble tests.)

### V6 — E2E conversational round-trip (`tests/e2e/backprop-tool.spec.ts` + mock-LLM fixture)

Setup: dev stack or e2e harness with the mock-LLM server; fixture gains a dispatch mode
that answers a branch chat's turn with a `propagate_to_parent` tool call (marker-based,
following the fixture's classification pattern); approval modal auto-approved by the
test driver.

Act: open a branch chat that has an exchange; send "I'm done here — backpropagate this."

Expected (SC-001/SC-002): by the end of the assistant's turn —

- the parent chat (opened fresh) shows the anchored artifact, collapsible, identical in
  behavior to a manual one;
- the branch timeline shows the tool call/result rows;
- the assistant reply is a short confirmation naming the parent and mode;
- no toast fires on the tool path;
- root-chat control: the same fixture conversation on a root chat never offers
  propagation (model sees no such tool) and the assistant's reply points at the manual
  control.

### Manual smoke (dev stack)

On `pnpm dev`: in a branch chat, tell the assistant you're done and to back-propagate →
approve the modal → verify parent artifact + reply. Then check the manual button still
works unchanged (FR-011), and that declining the modal once ends the matter for the
turn.
