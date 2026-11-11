# Quickstart: validate 038 without containers

Every story in this feature has a container-free proof path. The implementer
tier runs exactly these (capped, one process at a time); Docker/CI legs are
maintainer-verifiable and marked as such.

## Prerequisites

- Deps installed, `@mayon/shared` built (`pnpm install && pnpm --filter @mayon/shared build`).
- Capped runner (fleet policy):

```bash
CAP="systemd-run --user --scope -p MemoryMax=500M --setenv=NODE_OPTIONS=--max-old-space-size=384"
```

## US1 — shard-log selection

```bash
$CAP pnpm test:low-spec src/lib/dev/compose-project.test.ts
```

Expected: selector unit tests green — sibling-shards listing selects the
base-URL-implied project; base-stack-only listing selects `mayon-dev`; missing
project and name/file mismatch each throw the documented error.
(Maintainer, on a dev machine: `pnpm dev:shard:up 1/2 && pnpm dev:shard:up 2/2`,
then run the image-round-trip spec per shard — it must read its own stack's
mock logs.)

## US2 — drift-guard mirror patrol

```bash
$CAP pnpm test:low-spec src/lib/ai/generate/classification-markers.test.ts
```

Expected: mirror-registry `it`s green. Red-proof (scratch, revert before
commit): temporarily change one mirrored literal (e.g. the lever trigger in
`quizzes.svelte.test.ts`) and re-run — the guard must fail naming both files.

## US3 — toast-absence assertions

```bash
$CAP pnpm test:low-spec src/lib/stores/toasts.svelte.test.ts src/lib/stores/chat.svelte.test.ts
```

Expected: zero-toast assertions green (declined turn; latch-refused second
propagation; toast-store negatives). Red-proof (scratch, revert): make the
declined path push a toast (or remove 037's latch-clear) — the suite must go
red. (Maintainer: e2e sweeps in `tests/e2e/backprop-tool.spec.ts` on a dev
stack.)

## US4 — single discovery merge

```bash
$CAP pnpm test:low-spec src/lib/ai/model-discovery.test.ts src/lib/ai/connection-test.test.ts
```

Expected: helper unit tests green; the persisted-settings merge check passes
through the helper; `rg -n '\.\.\.discovered,' src/` finds the formula only
inside `model-discovery.ts`.

## US5 — CI cache + shard balance

```bash
pnpm exec playwright test --list --shard=1/2 | tail -1   # ≤ 18 tests
pnpm exec playwright test --list --shard=2/2 | tail -1   # ≥ 15 tests
pnpm lint                                                # workflow YAML passes Prettier
```

Expected: balanced listing (container-free oracle); workflow + composite
action format-clean. (Maintainer: the next CI run verifies the layer cache
actually hits.)

## US6 — 031 artifact addenda

Read `specs/031-split-text-e2e-tests/plan.md` (CI file claim),
`research.md` (D6), `tasks.md` (Notes): each claim is followed by the dated
addendum cross-referencing `specs/038-test-infra-accuracy/`; original text
intact.

## US7 — reload parity across all AI SDK entry points

```bash
$CAP pnpm test:low-spec src/lib/stores/chat.svelte.test.ts
```

Expected: the reload-hydration test (d) pins `streamText` + `generateObject`
+ `generateText` counters across `load()`. Red-proof (scratch, revert): fire
`generateText` inside hydration — must go red.

## Full close-out

```bash
$CAP pnpm test:low-spec src/lib/dev/compose-project.test.ts src/lib/ai/generate/classification-markers.test.ts src/lib/stores/toasts.svelte.test.ts src/lib/ai/model-discovery.test.ts src/lib/ai/connection-test.test.ts
$CAP pnpm test:low-spec src/lib/stores/chat.svelte.test.ts   # heaviest file, own process
pnpm check && pnpm lint
```
