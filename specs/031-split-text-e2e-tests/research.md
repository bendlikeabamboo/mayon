# Research: 031-split-text-e2e-tests

Phase 0 output. Each decision records what was chosen, why, and what was rejected.
Grounded in a full per-spec triage of all 10 `tests/e2e/` specs against the existing
fast-tier suite (`src/**/*.test.ts`, `server/src/*.test.ts`).

## Verified codebase facts

- The fast tier already covers most leaf-level data invariants: tool runs/persistence
  (`src/lib/agent/loop.test.ts` (h)/(i)/(v)), `propagate_to_parent` mechanics and refusals
  (`src/lib/agent/deterministic-tools.test.ts`), anchors/artifacts
  (`src/lib/chat/propagation.test.ts`), quiz/lab generation and grading
  (`src/lib/agent/generative-tools.test.ts`, `src/lib/stores/quizzes.svelte.test.ts`,
  `src/lib/stores/labs.svelte.test.ts`), prompt-contract reads
  (`src/lib/ai/generate/generate-quiz.test.ts`, `generate.test.ts`), connection
  classification/discovery (`src/lib/ai/connection-test.test.ts`), image-part persistence
  (`src/lib/stores/chat.svelte.test.ts`), telemetry span mapping
  (`server/src/telemetry-ingest.test.ts`, `server/src/telemetry.test.ts`), proxy mechanics
  (`server/src/llm-proxy.test.ts`, in-process via `app.inject`).
- The genuine fast-tier gaps are **composed end-state invariants** — multi-step scenarios
  asserted as end states (row counts, absence windows, persisted trace shape, emitted
  records) — not leaf logic.
- `tests/e2e/README.md` (the T021 inventory) classifies 8 of 10 specs;
  `backprop-tool.spec.ts` and `telemetry.spec.ts` are unclassified additions.
- `tests/e2e/fixtures/kitchen-sink.ts` hand-mirrors fixture-only strings from the mock
  server (`PROPAGATE_*`, `OFFER_*`, `LEVER_TRIGGER_*`, `IMAGE_*`) with **no drift guard**
  (classification markers were already de-mirrored into `tests/fixtures/mock-llm/markers.mjs`).
- No lint/boundary rule governs `tests/` ↔ `src/` imports; `tsconfig.json` includes
  `tests` but excludes `tests/fixtures` (hence the dynamic-import precedent in
  `src/lib/ai/generate/classification-markers.test.ts`).
- CI: the `web` job (merge-blocking) runs `pnpm test` (root vitest = `src/**`); the `e2e`
  job (merge-blocking) boots the docker dev stack and runs `pnpm test:e2e`. Server tests
  run in neither — a known, separate gap.
- The flaky backprop e2e triage (session 2026-11-09) already recommended: split the
  data/loop invariants out, keep UI residue in the browser — do not relocate wholesale.

## D1 — Migration strategy: fill composed gaps first, then prune behavior-only e2e assertions

**Decision**: Two-step, per invariant: (1) author the composed end-state fast-tier test
(D2) and land it green; (2) prune from the e2e spec only the assertions whose *sole*
purpose is that data/loop invariant. Visible-content checks, reload-render persistence
checks, and all live-path steps stay in the browser tier.

**Rationale**: The triage shows leaf coverage already exists; migrating it again would
duplicate, not add. What the e2e suite uniquely proves beyond rendering is the composed
end state (e.g. "offer turn ⇒ exactly +2 durable rows, 0 approval asks, 0 parent writes,
offer-once") — and precisely those assertions are the slow, flake-prone ones (12s no-modal
windows, reload sweeps, mock-log scrapes). FR-008's add-before-remove ordering falls out
naturally.

**Alternatives considered**: Relocate whole specs into the fast tier (rejected: strands
genuine UI residue and live-path dispatches); mass-rewrite all 10 specs (rejected:
classification-only specs need no edits); migrate leaf invariants too (rejected: already
covered — duplication rots).

## D2 — New fast-tier composed scenarios (the parity ledger's build list)

**Decision**: Author these composed scenarios, colocated per house pattern:

1. **Backprop offer-turn end-state** — seeded branch chat, offer-classified reply turn ⇒
   exactly +2 durable message rows, 0 approval-ask rows, offer never repeats, parent chat
   untouched. New focused file `src/lib/chat/backprop-endstate.test.ts` (not growing the
   3.1k-line `chat.svelte.test.ts`).
2. **Backprop declined-turn end-state** — declined tool result persisted, `toolsRun` not
   invoked, never re-asked, parent untouched. Same file.
3. **Backprop root-trigger end-state** — root chat trigger ⇒ `propagate_unavailable`
   plain reply persisted, 0 ask rows, next turn's tool set excludes `propagate_to_parent`.
   Same file.
4. **Capability toggle → tool-less trace** — flip provider tool capability ⇒ next turn's
   persisted agent trace records 0 tool iterations. Extends `src/lib/agent/loop.test.ts`.
5. **Discovery → persisted settings merge** — successful model discovery merges the
   catalog into the persisted provider record. Near `src/lib/ai/connection-test.test.ts`
   / the provider store tests (exact home at task time).
6. **Telemetry per-turn record emission** — a real composed turn emits the chat-turn and
   title records with expected attrs; an aborted turn emits the aborted record; metadata
   mode carries no conversation text. Extends `src/lib/telemetry/` tests.
7. **Image reload-serves-from-row** — verify existing store-hydration coverage; add only
   if genuinely absent (ledger decision, not a committed build).

**Rationale**: Each is the fast-tier twin of a specific e2e assertion cluster named in
the triage; each fails today if the composition breaks (they are real gaps, not theater).

**Alternatives considered**: One mega "e2e-parity.test.ts" (rejected: blob, poor failure
names — violates FR-naming spirit); skip gaps, prune anyway (rejected: breaks FR-008).

## D3 — Shared fixture strings: single source in `tests/fixtures/mock-llm/`, no hand mirrors

**Decision**: Move the fixture-only assertion strings (`PROPAGATE_*`, `OFFER_*`,
`LEVER_TRIGGER_*`, `IMAGE_*`, …) into the mock-llm fixture module family next to
`markers.mjs` (extend it or a sibling `strings.mjs` — plain Node `.mjs`, importable by
`server.mjs`). `tests/e2e/fixtures/kitchen-sink.ts` imports them (precedent: it already
imports `quiz-fixture.mjs`/`lab-fixture.mjs`) instead of hand-mirroring. Fast-tier tests
that assert on those texts import them following the `classification-markers.test.ts`
dynamic-import precedent (`tests/fixtures` is tsconfig-excluded). A drift-guard test
asserts every exported constant matches what the mock serves.

**Rationale**: FR-005 — both tiers must fail identically on the same text change. Today
the e2e mirror can silently drift from the mock server; the fast tier has no access at
all. The mock server is plain-Node `.mjs`, so the source cannot live in typed `src/`;
the fixtures dir is its natural home and already the marker precedent.

**Alternatives considered**: Constants in `src/lib/` imported by the mock (rejected:
product tree importing test domain backwards; mock runs outside the tsconfig program);
keep duplicates + guard-only (rejected: keeps two copies, guard becomes the fixer);
copy constants into each new fast test (rejected: third copy).

## D4 — Parity ledger + classification home: extend `tests/e2e/README.md`

**Decision**: The maintained inventory stays `tests/e2e/README.md`. Extend its table
with (a) rows for the two unclassified specs and (b) a "behavior invariants → fast-tier
home" parity column; add the standing policy: every new browser spec must state a
UI-only or live-path purpose; behavior-proving additions are explicit mismatches.

**Rationale**: FR-004 needs a reviewable, living artifact; README is already the T021
inventory and travels with the code it describes. A second ledger file would drift.

**Alternatives considered**: Separate `PARITY.md` (rejected: second drifting artifact);
ledger only inside `specs/031-*` (rejected: spec dirs are frozen after completion);
CI-enforced ledger lint (rejected for now: policy-first, matches 025's review-discipline
stance on test-quality gaming).

## D5 — Live-path residue stays e2e by explicit classification

**Decision**: The browser → `/api/llm/proxy` → mock-llm dispatch steps (all `(c)`
assertions across specs) remain browser-tier, classified "live-path". Proxy mechanics
need no new in-process tests — `server/src/llm-proxy.test.ts` already covers them
in-process; the browser residue (CORS preflight, key storage → header assembly) is
genuinely UI wiring. `onboard`, `render`, `mock-classification`, `quiz`, `lab`,
`prompt-contract` get classification-only treatment (no assertion edits except where
D1 pruning applies).

**Rationale**: FR-009 — live-path proofs stay by explicit decision, not default. Moving
them server-side would duplicate `llm-proxy.test.ts`; moving them away entirely would
lose the only real-socket coverage of the fetch path.

**Alternatives considered**: Classify live-path steps as deprecated and drop them
(rejected: loses the only end-to-end wire check); new server-side proxy compositions
(rejected: duplicate coverage).

## D6 — CI: no new gate infrastructure

**Decision**: No workflow changes. New fast-tier tests land under `src/**` and are
automatically inside the merge-blocking `pnpm test` run of the `web` job; the `e2e` job
keeps running (and stays merge-blocking) with the reduced specs. Server-tests-in-CI gap
is explicitly out of scope (spec assumption).

**Rationale**: FR-007 is already satisfied by existing wiring; new infra would violate
the 025 no-new-gates stance and this spec's own assumptions.

**Alternatives considered**: Split vitest projects/fast-slow marks (rejected: no need —
suite already runs in one job); demote e2e to non-blocking (rejected: spec keeps both
tiers merge-blocking).

*(2026-11-12, feature 038 / issue #75: the CI workflow was subsequently edited — cache-backed image builds + shard rebalance; see `specs/038-test-infra-accuracy/`.)*

## D7 — Placement and naming of new fast-tier tests

**Decision**: Colocated `*.test.ts` beside the logic under test (house pattern):
`src/lib/chat/backprop-endstate.test.ts` (new), extensions to `src/lib/agent/loop.test.ts`,
`src/lib/telemetry/*` tests, connection/provider-store tests, and the drift guard beside
`classification-markers.test.ts`. No `+`-prefixed filenames (SvelteKit route namespace);
no new test helpers beyond what the scenarios need.

**Rationale**: AGENTS.md invariant (no `+` prefix) and the sanctioned seed-via-`repos`
proving path; colocated files keep failure → logic attribution obvious (FR: failures
name the invariant).

**Alternatives considered**: Central `tests/fast/` mirror tree (rejected: fights the
colocation pattern and the vitest include globs).

## D8 — E2E pruning boundary (what may be deleted)

**Decision**: Delete only assertions whose sole purpose is a data/loop invariant with a
landed fast-tier home: durable-row counts, absence windows (no-modal/no-toast/no-re-ask
sweeps), persisted-trace iteration counts, mock-log request scrapes. Keep: render checks,
reload-render persistence checks (they prove the boot/hydration wiring), breadcrumb/nav
checks, and every live-path step. The BootGate mid-turn-reload mitigations stay for
remaining turn-spanning UI checks.

**Rationale**: Preserves the browser tier's unique value (wiring, rendering, live wire)
while removing exactly the slow flake surface (SC-004/SC-005).

**Alternatives considered**: Prune render checks too (rejected: coverage loss — the
persisted state rendering is UI wiring); keep everything and only add fast tests
(rejected: SC-004 requires zero duplicated behavior-only assertions).
