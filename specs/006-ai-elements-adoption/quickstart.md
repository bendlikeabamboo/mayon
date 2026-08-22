# Quickstart — AI Elements Adoption Validation Guide

Manual + automated validation for [spec.md](./spec.md). Run on the dev stack
(`pnpm dev` → http://localhost:5173, server on :4319). Contracts: [model picker](./contracts/model-picker.md) ·
[approval/confirmation](./contracts/approval-confirmation.md) · [tool display](./contracts/tool-display.md).

## Prerequisites

- Dev stack up; at least two providers configured (one with model discovery, e.g. an
  Ollama or OpenAI-compatible endpoint) and one MCP tool server mounted that can issue
  elicitation and sampling requests (or use the labs/MCP test fixtures you normally
  use for these flows).
- No schema/server changes ship with this feature — no DB setup beyond the norm.

## Automated gates (every iteration)

```bash
pnpm check   # svelte-check — must be clean
pnpm lint    # eslint + prettier
pnpm test    # vitest — includes new confirmation-state, picker-filter, tool-status tests
```

## Scenario 1 — Model picker (P1)

1. Open a chat → open the model picker from the composer/config area.
   - Expect: dialog opens, input focused, current model highlighted (MP-1, MP-3, MP-8).
2. Type a fragment of a model name; then a provider name.
   - Expect: list filters on both; no matches → "No matches." (MP-1, MP-5b).
3. Keyboard-only pass: ↑/↓ to move, Enter to select, reopen, Escape to dismiss.
   - Expect: selection applies and persists; Escape changes nothing (MP-2, MP-4).
4. With zero providers (fresh profile or temporarily disabled): open the picker.
   - Expect: setup-guidance empty state, no crash (MP-5a, MP-7).
5. Refresh affordance on a discoverable provider: spinner while discovering, list
   repopulates (MP-6).

## Scenario 2 — Approval flows (P2)

1. Trigger an elicitation request from the tool server.
   - Expect: confirmation chrome (title = server, request = message), schema form
     fields, submit/cancel; on submit → terminal accepted state; on cancel → rejected
     (AP-1–AP-4).
2. Submit invalid JSON in the JSON-fallback mode.
   - Expect: inline error, dialog stays usable (AP-2).
3. Trigger a sampling request.
   - Expect: inline card via the same pattern: prompt preview + budget, approve/decline;
     decline ends the flow, conversation continues, no dangling UI (AP-3, AP-4).
4. Kill the tool server with a request pending.
   - Expect: surface settles to a failed/dismissible state — never endless pending (AP-5).
5. Stop the server container and reload: no approval UI anywhere; picker still works
   from local configuration (AP-6, MP-7).

## Scenario 3 — Tool display (P3)

1. Run a session that invokes tools (some verbose, some terse, one failing).
   - Expect: all rows collapsed by default; name + status visible (TD-1, TD-3).
2. Expand/collapse via click and via keyboard on the same row.
   - Expect: identical behavior, correct aria state (TD-2).
3. Inspect the failed and declined rows collapsed.
   - Expect: visually distinct from success without expanding (TD-4).
4. Click an artifact link (chat/lab/quiz) and check sources rows still render.
   - Expect: routing and sources unchanged (TD-5, TD-6).

## Regression sweep (unchanged-by-design)

- Expound: select text across math/code blocks and paragraphs — menu and highlight
  wrapping behave as before (spec FR-006 guard; expound suite green in `pnpm test`).
- Branching: create a branch, navigate siblings — timeline intact.
- Dark mode + theme toggle across all three new surfaces (SC-005).
- Perf spot-check (optional): `window.__MAYON_PERF__ = 1` during a tool-heavy session;
  TimelineRow render counts comparable to pre-change baseline (TD-8).

## Expected outcome

All scenarios pass with zero new entries in the dependency manifest and the
feature-surface ledger ≤ 533 lines (SC-001/SC-002; see research.md D6 for the
accounting rule).
