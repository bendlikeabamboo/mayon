# Quickstart: Smooth Streaming (022) — Validation Guide

Proves the feature end-to-end: paced cadence, growth-edge visuals, preset setting, and zero regressions in the DOM-sensitive features (expound, search, copy). Implementation detail lives in [plan.md](plan.md) + [contracts/](contracts/); this file is the run/verification guide.

## Prerequisites

- Node 22, pnpm 10, Docker/Podman (`MAYON_DEV_ENGINE`).
- Fresh worktree: `pnpm install && pnpm --filter @mayon/shared build`, then `pnpm dev:build` if deps/config/shared changed.
- A configured LLM provider (any streaming-capable model) via the normal settings UI.

```bash
pnpm dev          # all-Docker dev stack; web on http://localhost:5173
pnpm check        # gate: svelte-check
pnpm lint         # gate: ESLint + Prettier
pnpm test         # gate: Vitest (pglite driver)
```

## 1. Automated gates

| Check | Command | Expected |
|---|---|---|
| Types | `pnpm check` | Clean |
| Lint/format | `pnpm lint` | Clean |
| Unit + store suites | `pnpm test` | All pass, including new `pacer.test.ts`, `pref.test.ts`, extended `chat.svelte.test.ts`, and **unchanged** `selection.test.ts`, `sourcemap.test.ts`, `wrap-range.test.ts`, `entries.test.ts` (regression guard for FR-010) |

Key unit scenarios (defined by [contracts/pacer-api.md](contracts/pacer-api.md) behavioral rules, asserted as timing bands per the `stagger.test.ts` convention):

- Word-safety: released prefix never ends mid-word across bursty arrival patterns.
- Adaptive cadence: hidden backlog stays within the accepted window under fast (all-at-once) arrival; slow trickle shows nothing held back.
- Drain: eased completion fully visible ≤ ~1 s after stream end; no single-tick dump.
- Abort: instant full flush from any mode; store persists raw buffer with `interrupted: true` (existing UJ behavior).
- Reset: critic-phase buffer clear resets release position.
- Preset unset/corrupt → `standard`; standard passthrough keeps every existing streaming test green byte-for-byte.

## 2. Manual smoke matrix (dev stack)

Stream a long, mixed reply (prose → fenced code block → list → table → prose) in one turn for each preset. Set via **Settings → Chat** section (appearance) → streaming-look select.

| # | Scenario | Steps | Expected |
|---|---|---|---|
| M1 | Default = Standard | Fresh profile (no key set), stream a reply | Looks and paces exactly like pre-feature; no overlay; settings show Standard preselected (FR-012) |
| M2 | Expressive cadence | Select Expressive, stream | Text grows in small steady increments — no chunk pop-in; words never half-appear (FR-001/002) |
| M3 | Expressive edge | Watch the growth point mid-prose | Soft blur/fade at the trailing edge; crisp, `pointer-events` inert; selection still works over it (FR-006/009) |
| M4 | Edge suppression | Stream so the reply ends inside/after a code block and a table | No blur smear over code/table (suppressed); lists softened (FR-008) |
| M5 | Completion | Let a fast model finish a long reply | Edge lifts with a short un-blur in step with the last text; full reply visible ≤ ~1 s after the model finishes; no terminal dump (FR-004/007, SC-002/005) |
| M6 | Calm preset | Select Calm, stream | Steady cadence + plain caret only; no blur (FR-011) |
| M7 | Stop mid-stream | Click Stop while Expressive is draining/streaming | All arrived text instantly visible; durable row shows `interrupted` note as today; no lingering blur (FR-005) |
| M8 | Error path | Point at an invalid key / kill network mid-stream | Same as M7 — nothing stays hidden or blurred |
| M9 | Persistence | Pick Calm, reload the app, stream | Calm still active; applies without reload (SC-004) |
| M10 | Invariants | With Expressive active (during **and** after streaming): select text → expound; copy a code block; run a full-text search | Expound selection + branch from a durable row works; clipboard contains exactly the code text (nothing injected inside `<pre>`); search finds the reply (FR-010) |
| M11 | Regenerate | Regenerate a reply mid-stream and after completion | Pacing resets cleanly; no stale overlay; normal stream follows |
| M12 | Reduced motion | Enable OS-level reduced motion, stream Expressive | Edge lift/caret transitions are disabled; cadence unaffected |

## 3. Performance measurement (constitution IV — mandatory)

Before/after comparison with the perf probe; unmeasured claims are not accepted.

```text
1. Open the app, set preset Expressive, open DevTools console.
2. window.__MAYON_PERF__ = 1
   localStorage.mayon_perf_scenario = 'smooth-streaming'
3. Stream 2–3 long replies; watch [mayon-perf] summaries (every 3 s).
4. Compare against a Standard-preset run:
   - fps p95 / dropped frames ≈ unchanged
   - cls ≈ 0 (overlay must not shift layout)
   - marks: 'pacing:flush' present; 'markdown:render' cadence unchanged (~12.5 Hz max)
   - renders: 'GrowthEdge' counted and bounded by flush cadence
```

## 4. Optional E2E extension (deferred)

`tests/e2e` (Playwright vs. dev stack + mock-llm fixture) currently asserts stream *end state*. Mid-stream pacing/edge assertions would first make `CHUNK_INTERVAL_MS` / `BLOCKS_PER_CHUNK` env-tunable in `tests/fixtures/mock-llm/server.mjs` (guardrail: still no `page.route` interception — requests must flow browser → `/api/llm/proxy` → mock-llm). Track as a follow-up task, not an MVP gate.

## Done when

- All gates green (`pnpm check`, `pnpm lint`, `pnpm test`).
- M1–M12 pass manually on the dev stack.
- Perf probe before/after captured with no regression (fps p95, CLS, markdown render cadence).
