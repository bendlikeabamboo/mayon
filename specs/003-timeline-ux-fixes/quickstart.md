# Quickstart: Timeline UX Fixes — Validation Guide

Defect verification against the four reported observations. Dev stack: `pnpm dev` (web http://localhost:5173). Prerequisite: a chat captured with the **current (pre-fix) build** that shows the reported symptoms — assistant reply before its reasoning, PRESENT_CHOICES rendered as a tool call with "No result recorded", spinner spinning on completed replies — plus any session where an MCP server reconnected (for the crash). Keep that chat as the regression fixture; it must look correct after the fix **without any data change**.

## 0. Gates (all must pass; baseline: 10 pre-existing check errors in server-stdio.test.ts)

```bash
pnpm check
pnpm lint
pnpm test              # includes the new regressions + 002 golden fixtures unmodified
pnpm --filter @mayon/server test   # unchanged code, still green
```

## 1. Diagnostics crash fixed (US1 — do FIRST, unblocks everything)

1. Open the app with a session that had an MCP server connect and disconnect (the crash reproducer from the bug report).
2. Open the diagnostics panel → it opens; both lifecycle events render as separate rows (connect, disconnect).
3. No `each_key_duplicate` in the browser console; chats open normally.

## 2. Spinner honest (US2)

1. Open any **completed past chat** → no spinner anywhere; reload → still none.
2. Send a new prompt → spinner appears while streaming ("Thinking…" before first token, orbit spinner beside the label once text flows) and disappears the moment the reply completes.

## 3. Deterministic turn order (US3) — use the pre-fix symptom chat

1. Open the chat that previously showed reply → reasoning → offer: it now shows **reasoning → reply → choices offer** (presentation-time reorder; no data rewritten).
2. Multi-iteration sanity: run a tool-heavy prompt; the finished turn reads thinking → text/tool activity per iteration, chronologically; nothing jumps when the durable rows replace the live ones.
3. New turns: reasoning is stored before the reply of the same iteration (reload preserves the canonical order via storage, not the reorder pass — verify the DB `ord` if convenient).

## 4. Honest terminal tools (US4)

1. Trigger the pacing choices flow → the offer renders with its options (read-only) and the taken option marked after tapping a chip — no red X, no "No result recorded".
2. A legacy chat (pre-002 storage, offer + result pair) also renders the offer cleanly.
3. Abort a turn mid-way through a normal (non-terminal) tool call → that call still shows the failure mark + "No result recorded".
4. A genuinely failed tool result still shows the failure mark.
5. Tool pairing sanity: a normal tool call + result renders as ONE grouped unit at the result's position (not trailing the timeline) — this validates the pairing-key repair that the choices symptom rode on.

## 5. Provider context unchanged

`pnpm test` — the 002 golden projection fixtures pass unmodified; no new migration, no schema-version change (restore/backups unaffected).

## References

- Presentation rules and regression bars: [contracts/timeline-presentation.md](./contracts/timeline-presentation.md)
- Root causes and decisions: [research.md](./research.md)
- Presentation entities: [data-model.md](./data-model.md)
