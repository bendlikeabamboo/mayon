# Quickstart: 031-split-text-e2e-tests validation

Runnable proof that the split works end-to-end. Prerequisites: Node 22 + pnpm 10,
`pnpm install`, `pnpm --filter @mayon/shared build`. Docker needed only for V4/V7.

## V1 — Fast tier proves migrated invariants without the live stack (FR-006, SC-002)

```bash
# docker dev stack DOWN (nothing listening on :5173/:4319)
pnpm test
```

**Expected**: pass, including the new composed scenarios (`backprop-endstate`,
capability→trace, telemetry record emission, drift guard). No browser, no containers,
no network waits — the suite never touches the live stack.

## V2 — A planted logic break fails fast and names the invariant (Story 1)

```bash
# plant: make the offer turn persist an approval ask (or +1 row), e.g. edit the offer
# dispatch path in a scratch change
pnpm test src/lib/chat/backprop-endstate.test.ts
```

**Expected**: failure names the composed end-state invariant (row count / ask absence /
parent untouched), not a rendered-page symptom. Revert; green.

## V3 — Inventory complete, parity accounted (FR-004, SC-001/SC-004)

Read `tests/e2e/README.md` against `ls tests/e2e/*.spec.ts`.

**Expected**: one row per spec — all 10, including `backprop-tool` and `telemetry`;
every row states a `ui-only`/`live-path` classification and a UI-residue line; every
migrated cluster maps to a fast-tier home; zero `proposed` dispositions. The policy
statements from [contracts/browser-inventory.md](./contracts/browser-inventory.md) are
present.

## V4 — Browser residue stays green (FR-003, Story 2)

```bash
pnpm dev:up && pnpm test:e2e
```

**Expected**: pass. Pruned specs (backprop-tool, provider-picker, telemetry, …) carry
only render/wiring/reload-render assertions plus live-path steps; no durable-row counts,
absence windows, or trace-count assertions remain.

## V5 — Shared fixtures cannot drift (FR-005, SC cross-tier identical failure)

```bash
# plant: hand-mirror a served string (e.g. OFFER_REPLY) inside kitchen-sink.ts,
# or change a constant's value without updating the server's response
pnpm test   # drift-guard test
```

**Expected**: drift guard fails naming the constant. Revert; green. Also confirm
`kitchen-sink.ts` re-exports (not defines) the fixture-only strings.

## V6 — Migrated invariants are flake-class-free (SC-005)

```bash
for i in 1 2 3 4 5; do pnpm test src/lib/chat/backprop-endstate.test.ts; done
```

**Expected**: 5/5 green — the BootGate mid-turn-reload flake class is unreachable by
construction (no browser, no boot gate in the loop).

## V7 — Feedback-speed ratio (SC-003, Story 3)

```bash
time pnpm test                       # fast tier
pnpm dev:up && time pnpm test:e2e    # browser tier
```

**Expected**: fast-tier wall time ≤ 1/10 of the browser-tier wall time (which includes
stack boot), with no live stack booted for the fast run.

## V8 — No runtime change shipped (FR-010)

```bash
git diff --stat main... -- ':!specs' ':!tests' ':!src/**/*.test.ts' ':!server/src/**/*.test.ts'
```

**Expected**: empty — no product source files, routes, schemas, or workflows changed;
only tests, fixtures, README inventory, and spec artifacts. (`pnpm check` and `pnpm lint`
stay green.)
