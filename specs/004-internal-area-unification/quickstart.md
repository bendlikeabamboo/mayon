# Quickstart: Internal Area Unification

Validation guide for `specs/004-internal-area-unification`. Run on the dev stack (`pnpm dev` → web http://localhost:5173, server :4319). Prerequisite: an MCP server configured with at least one **high-risk** tool (e.g. a Brave Search server — its `brave_web_search` is `risk: 'high'`), and the reported brave-search chat kept as a live regression fixture (it must look correct after the fix **with no data change**).

## Quality gates (constitution — run all before merge)

```bash
pnpm check                                   # svelte-check
pnpm lint                                    # ESLint + Prettier
pnpm test                                    # main suite (incl. golden + new regressions)
pnpm --filter @mayon/server test             # server guard (no server changes expected)
```

New/extended suites: `entries.test.ts` (merge + status derivation), `chat.svelte.test.ts` (buffer retire), `ToolActivity` tests (status table + clamp), `loop.test.ts` (trace fidelity), `repositories.test.ts` (`ok` persistence). Golden tests must pass **unmodified**.

## US1 — exactly-once text across the approval wait

1. New chat, ask: "use brave search to get the latest git version".
2. While the model's pre-tool sentence streams and the approval card appears: the sentence renders **once**; below it the tool row (awaiting, per US2) and one approval card.
3. Approve → tool runs → the turn continues; after completion the sentence still renders exactly once, in place. `suggestedReplies` chips never appear (US4).
4. Multi-iteration turn (text → tool → text): each earlier segment appears once; only the last segment's bubble is live.

## US2 — pending reads as pending

1. Freeze on the approval ask: tool row shows a waiting presentation — **no red X, no "No result recorded"**.
2. Reload the page while an approval is pending: the undecided ask row renders and its tool row still reads undecided — never failed.
3. Decline a call: tool row shows the distinct declined presentation; the model continues per its instructions.
4. Stop a turn mid-way through a normal tool call (reload): genuine-gap marker ("No result recorded" + X) remains — the 003 contract is intact.
5. A failed MCP result (new rows now store `ok: false`) shows the red X; the choices offer shows the neutral terminal mark.

## US3 — collapsed results

1. Open the reported brave-search chat: every result renders as one truncated line with a "Show result" expander; expanding shows the full payload in a bounded scrollable block; collapsing works. No data change (verify row content via Drizzle studio or the API if desired).
2. A deterministic tool (e.g. branch) still shows its short summary line as before.
3. Provider context unchanged: golden tests green (covered by gates).

## US4 — interaction in the internal lane only

1. Run a gated curriculum chat to a pacing point: the offer renders in the timeline with **tappable** options; the compose area shows no chips and no progress text in any state (check idle, streaming, gate pending, ask pending).
2. Tap "continue": the user reply sends and links to the offer (taken option marked, read-only, survives reload).
3. Free-typing still works at any time; artifact nav chips under the composer are unchanged.

## US5 — honest trace

1. In a chat with a choices offer + tool call, open diagnostics and inspect the captured request: the system prompt appears exactly once; the choices row is visibly a tool interaction (`kind`/tool identity), not a bare "The Three Trees" assistant message.
2. The traced message sequence matches what the provider received (regression asserts equality with the projection).

## Perf probe (constitution IV — before/after)

```text
window.__MAYON_PERF__ = 1
localStorage.mayon_perf_scenario = 'mcp-approval'
```

Compare `[mayon-perf]` summaries on the brave-search chat before and after: frame timing, longtasks, and `TimelineRow` render counts during the approval wait and result render. Record numbers in the PR; expect flat-or-better (one ask component instead of two; clamped single-line payload).
