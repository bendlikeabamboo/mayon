# Quickstart: 025-text-first-runtime validation

Runnable proof that the enforcement wire works end-to-end. Prerequisites: Node 22 +
pnpm 10, `pnpm install`, `pnpm --filter @mayon/shared build`.

## V1 — The wire catches a planted deep import (SC-001, FR-002/FR-004)

```bash
# plant a violation (any component):
#   add  import { bootstrapDb } from '$lib/db/driver/client';
#   to src/lib/components/chat/MessageList.svelte
pnpm lint
```

**Expected**: ESLint fails, naming the file, the boundary rule, and the sanctioned
alternative (`import ... from '$lib/db'`). Revert the edit; `pnpm lint` passes.

## V2 — The backstop catches a dynamic import (R2)

```bash
# plant:  const m = await import('$lib/db/schema');
#   in any src/lib component, then:
pnpm check:boundaries   # (root script wrapping scripts/check-dependency-direction.mjs)
```

**Expected**: the direction check exits non-zero naming the file and rule. Revert; passes.

## V3 — Escape hatches are scoped and justified (FR-005, SC-002)

```bash
# add a hatch entry { fileScope: <that one file>, ruleId, justification } to the
# enforcement config block, re-run V1's plant
pnpm lint
```

**Expected**: passes for exactly that file/scope. Remove the justification comment →
review contract broken (enforced in review; the block is the only exception path).
Inline `eslint-disable` of a boundary rule still fails.

## V4 — Clean tree stays green at every merge-blocking gate

```bash
pnpm lint && pnpm check && pnpm test && pnpm --filter @mayon/server test
```

**Expected**: all pass, including after the day-one mechanical rewrites (façade bypass
fixes + type-import rewrites) — the wire goes live with zero baselined violations.

## V5 — The wire tests itself

```bash
pnpm test   # includes the enforcement self-tests (violating + clean fixture trees)
```

**Expected**: boundary self-tests pass — planted fixtures fail, clean fixtures pass.

## V6 — The agent's map exists and steers (FR-006/FR-007, SC-003)

Open `docs/reference/agent-map.qmd` (or render the docs site). **Expected**: one page
with the four sections from contracts/agents-map.md; `AGENTS.md` and the docs sidebar
link it; `seams.qmd` cross-links enforcement and cites `src/lib/db/repositories/`.

Steering check (SC-003): give an implementing agent only the map and a boundary-placeable
feature request; its plan puts logic behind the seam with logic-layer text tests and no
browser automation.

## V7 — Live doors still answer at RC time (FR-009, SC-005)

With the dev stack up (`pnpm dev`): `curl localhost:4319/api/health` → healthy JSON;
`POST /api/db/query` (session-valid) → query result. **Expected**: existing doors work;
no new runtime surface was added anywhere (FR-010 — verified by absence of new
server/app routes in the diff).
