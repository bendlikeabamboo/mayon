# Quickstart: Back-propagation tool integrity fixes (037)

Runnable validation scenarios proving the fixes end-to-end. Unit/regression specifics
live in `tasks.md`; contract details in `contracts/payload-parity.md` and
`contracts/decline-surface.md`.

## Prerequisites

- `pnpm install` and `pnpm --filter @mayon/shared build` (fresh worktree).
- Machine profile check per AGENTS.md (`nproc`, `free -h`); this guide assumes the
  capped low-spec invocation used throughout (substitute `pnpm test` on a ≥8-CPU /
  ≥8-GiB machine):

```bash
systemd-run --user --scope -p MemoryMax=500M --setenv=NODE_OPTIONS=--max-old-space-size=384 \
  pnpm test:low-spec <files>
```

## V1 — Tool-built payload excludes its own chrome (US1)

```bash
systemd-run --user --scope -p MemoryMax=500M --setenv=NODE_OPTIONS=--max-old-space-size=384 \
  pnpm test:low-spec src/lib/agent/deterministic-tools.test.ts src/lib/chat/propagation.test.ts
```

Expected: chrome-exclusion unit tests pass (a `tool_call`/`approval`/`tool_result`
trio with `toolName: 'propagate_to_parent'` renders zero turns; other tools' rows
survive) and the tool-path vs manual-path parity tests pass (byte-identical payloads
for the same content).

## V2 — Latched second propagation never toasts (US2)

```bash
systemd-run --user --scope -p MemoryMax=500M --setenv=NODE_OPTIONS=--max-old-space-size=384 \
  pnpm test:low-spec src/lib/stores/chat.svelte.test.ts
```

Expected: after a successful propagation (`lastPropagation` set), a latch-refused
second call clears the record (`lastPropagation === null` on return), so the page's
"toast iff record set" logic cannot fire; genuine success still sets the record.

## V3 — Root guidance has no dead end (US3)

```bash
systemd-run --user --scope -p MemoryMax=500M --setenv=NODE_OPTIONS=--max-old-space-size=384 \
  pnpm test:low-spec src/lib/chat/brief.test.ts
```

Expected: the capabilities preamble's root-chat line references a child context /
branching, not the manual control; the manual-control pointer survives only for the
provider-without-tools-on-a-branch case.

## V4 — Mid-tool abort is clean (US4)

```bash
systemd-run --user --scope -p MemoryMax=500M --setenv=NODE_OPTIONS=--max-old-space-size=384 \
  pnpm test:low-spec src/lib/agent/deterministic-tools.test.ts
```

Expected: an abort observed after payload generation but before the write produces
`{ok: false, summary: 'aborted'}`, zero artifact rows, and a released latch; the
pre-generation abort behavior is unchanged.

## V5 — Duplicate images render (US5)

```bash
systemd-run --user --scope -p MemoryMax=500M --setenv=NODE_OPTIONS=--max-old-space-size=384 \
  pnpm test:low-spec src/lib/chat/propagation.test.ts src/lib/components/chat/PropagatedArtifact.test.ts
```

Expected: collection dedupes identical `data` (first wins) before the 8-image cap;
the grid's each-key is composite (`data + ':' + index`), asserted by the wiring test.

## V6 — Regeneration refreshes parts (US6)

```bash
systemd-run --user --scope -p MemoryMax=500M --setenv=NODE_OPTIONS=--max-old-space-size=384 \
  pnpm test:low-spec src/lib/db/repositories/messages.test.ts src/lib/stores/chat.svelte.test.ts
```

Expected: `updateArtifactContent` with a parts array stores validated parts atomically
(`null` clears, `undefined` untouched); regeneration leaves the artifact with the
source branch's current deduped images or no parts.

## V7 — Declines are legible next turn (US7)

```bash
systemd-run --user --scope -p MemoryMax=500M --setenv=NODE_OPTIONS=--max-old-space-size=384 \
  pnpm test:low-spec src/lib/agent/loop.test.ts src/lib/chat/context.test.ts
```

Expected: a declined high-risk call persists metadata `{"declined":true,"ok":false}`;
reassembled context surfaces `declined: true` for that call; failures/aborts do not.

## Full gates

```bash
pnpm check && pnpm lint
systemd-run --user --scope -p MemoryMax=500M --setenv=NODE_OPTIONS=--max-old-space-size=384 \
  pnpm test:low-spec
```

All green ⇒ the seven acceptance bullets of issue #73 hold.
