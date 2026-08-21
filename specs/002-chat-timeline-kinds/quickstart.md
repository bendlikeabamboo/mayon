# Quickstart: Chat Timeline Kind Model — Validation Guide

End-to-end validation for the feature against the spec's acceptance criteria. Assumes the dev stack (`pnpm dev` → web on http://localhost:5173, server `:4319`, project `mayon-dev`). Build `@mayon/shared` first after any change to it (`pnpm dev:build` inside the dev stack).

## Prerequisites

- Node 22 + pnpm 10; Docker running.
- A legacy dev database with variety: at least one chat with tool calls (JSON results), one with a `present_choices` offer + tapped chip, one with hidden prompts (expound branch), one multi-iteration reasoning turn. (If absent: run one tool-heavy turn before upgrading — e.g. a quiz/lab creation flow that triggers approvals and choices.)

## 0. Gates (run after every phase; all must pass)

```bash
pnpm check                                   # svelte-check
pnpm lint                                    # ESLint + Prettier
pnpm test                                    # Vitest (pglite) — incl. projection golden tests
pnpm --filter @mayon/server test             # server suite — incl. migration registry tests
```

## 1. Migration & backfill (spec SC-005)

1. `docker volume ls | grep pg-data-dev` — keep the pre-upgrade volume (this is the legacy corpus).
2. Rebuild + restart the dev stack with the v2 code: `pnpm dev:build && pnpm dev:up`.
3. Watch server logs: drizzle `ALTER` applied → `pg: schemaVersion 1 < 2` → migration `1→2` ran → stamped 2.
4. Verify backfill inside the server container's psql (or via a scratch query):
   - `SELECT kind, count(*) FROM messages GROUP BY kind;` — no NULLs; shapes match expectations (tool calls/results, one or more `choices`, user/assistant messages).
   - `SELECT count(*) FROM messages WHERE kind IS NULL;` → **0**.
   - `SELECT id FROM messages LIMIT 5;` unchanged vs. pre-upgrade snapshot (IDs preserved).
5. Branch/expound integrity: open a branched chat and an expound-created branch — branch headers render, expound selection menu still works on old assistant messages.

## 2. Timeline presentation (spec SC-001, SC-002 — wall of text fixed)

1. Open the tool-heavy legacy chat.
2. Tool activity renders as internal-lane grouped units: header (tool name + ok/fail), one-line summary, detail **collapsed by default**; one click expands the structured detail (the previously-unrendered `metadata` payload).
3. No blank rows, no raw muted walls, no `present_choices` bookkeeping rows. The old offer shows its options read-only.
4. Regression check: user bubbles right/foreground; assistant bubbles left/bordered; hidden prompts stay hidden.

## 3. Reload honesty (spec SC-003)

1. New turn that triggers a **permission ask** → approve; reload → ask line shows outcome chip "approved".
2. Second ask → decline; reload → "declined". Abort a turn mid-ask (Stop) → reload → "undecided" (not an interactive card).
3. Turn that hits the pacing **gate** → chips appear; tap one; reload → offer shows options with the taken one marked; the tapped chip is a user message linked to the offer.
4. Multi-iteration tool turn → reload → reasoning renders as separate per-iteration internal entries; final assistant text contains **no** glued reasoning.
5. (If critic fires) turn with a broken mermaid/code block corrected → reload → `self_corrected` internal note with issues/attempts.

## 4. Provider context unchanged (spec SC-004)

```bash
pnpm test    # projection golden fixtures: legacy corpus deep-equal, zero diffs
```

Manual spot-check: continue an old tool-heavy chat — the model's behavior/awareness of prior tool results is unchanged.

## 5. Live/durable unification (spec SC-006)

1. Send a prompt; while streaming, reasoning toggle + bubble appear in place.
2. On completion, persisted entries replace live output with no visual jump (same renderer).
3. Search the chat in global search: internal entries (reasoning/asks/offers) do **not** appear; user/assistant messages still do.

## 6. Restore gate (spec FR-014)

1. Take a backup (settings → backup, downloads a dump stamped v2).
2. If a pre-v2 dump exists: restore it → notice mentions `1→2` auto-migrate → post-restore backfill verified as in §1.4.
3. Restore a v2 dump onto an older (v1) server build → refused with "newer schema" notice (existing gate).

## 7. Perf probe (constitution IV — required for the presentation rewrite)

```js
// browser console before/after the rewrite, same tool-heavy chat
window.__MAYON_PERF__ = 1;
localStorage.mayon_perf_scenario = 'tool-heavy-timeline';
```

Compare `[mayon-perf]` summaries: row render counts and longtask totals not worse than baseline.

## References

- Kind payloads & backfill table: [contracts/entry-kinds.md](./contracts/entry-kinds.md)
- Presentation registry: [contracts/presentation-registry.md](./contracts/presentation-registry.md)
- Projection & golden tests: [contracts/projection.md](./contracts/projection.md)
- Migration: [contracts/migration-v2.md](./contracts/migration-v2.md)
- Entities & state transitions: [data-model.md](./data-model.md)
