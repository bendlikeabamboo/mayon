# Quickstart: Mermaid Repair Integrity (028 defects)

Phase 1 output. Runnable validation for each story, using the fleet-capped test runner
(one process at a time; never plain `pnpm test`):

```bash
RUN="systemd-run --user --scope -p MemoryMax=500M --setenv=NODE_OPTIONS=--max-old-space-size=384 pnpm test:low-spec"
```

Prerequisites: `pnpm install` + `pnpm --filter @mayon/shared build` (worktree baseline,
already done in this worktree).

## V1 — US1 repair integrity

```bash
$RUN src/lib/markdown/mermaid-repair.test.ts src/lib/markdown/mermaid.test.ts
```

Expected: all new preservation tests (init/C4/xychart untouched on non-repairable
failures), the idempotence property over the corpus and first-pass outputs, and the
N-way chain single-pass collapse pass; the 028 canonical repair case, the seam's
one-pass contract tests, and `buildMermaidFixPrompt` tests stay green.

## V2 — US2 send preflight

```bash
$RUN src/lib/stores/chat.svelte.test.ts
```

Expected: new preflight tests pass — with `getActiveSdkProvider` rejecting:
`repos.messages.listByChat(chatId)` gains NO user row, `chatStore.streaming` stays
`false`, `chatStore.error` carries the mapped guidance, `lastFailedPrompt` recorded;
with a provider resolving, the fix-prompt send persists exactly one user row (028
contract). The existing T015 provider-error test stays green.

## V3 — US3 error block presentation

```bash
$RUN src/lib/components/chat/mermaid-error-block.test.ts src/lib/markdown/sourcemap.test.ts
```

Expected: builder tests pass — full failure text (name + message) present and NOT
inside a collapsed details; reason element carries the pre-wrap class; source inside a
collapsed details/pre; fix button iff handler passed. Sourcemap exclusion fixtures stay
green (`.mermaid-error` wholesale exclusion unchanged).

## V4 — US4 exclusion derivation

```bash
$RUN src/lib/markdown/sourcemap.test.ts
```

Expected: coverage suite passes with `EXCLUDED_CHROME_SELECTORS` imported live from
`#lib/chat/selection.js`; no hardcoded selector copy remains in the test.

## V5 — cross-cutting close-out

```bash
pnpm check && pnpm lint
$RUN src/lib/markdown/mermaid-repair.test.ts src/lib/markdown/mermaid.test.ts src/lib/stores/chat.svelte.test.ts src/lib/markdown/sourcemap.test.ts src/lib/components/chat/mermaid-error-block.test.ts
```

Expected: type-check, lint, and every touched suite green in one capped run (one
process, files listed together).

Manual smoke (optional, maintainer, needs dev stack): send a message with a broken
diagram under a provider-less config; click "Fix this diagram" — no new row, settings
guidance appears. Re-enable provider; the same click sends one visible fix message.
Not part of the required bar (fast-tier coverage above is).
