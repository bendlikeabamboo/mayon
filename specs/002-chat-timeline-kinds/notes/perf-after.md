# Perf After-Rewrite Protocol — Chat Timeline Kind Model (T037)

**Scenario**: `tool-heavy-timeline` (must match `notes/perf-baseline.md`)
**Status**: PROTOCOL READY — same constraint as the baseline: numeric capture requires a human-driven browser session. Run AFTER merging the US1/US4 presentation rewrite, on the SAME legacy chat used for the baseline (post-migration — kinds now stored).

## How to capture

1. `pnpm dev` (or `pnpm dev:up`) — the dev stack now boots with the v2 schema; verify server logs show `pg: schema migration 1→2: …` on first boot against the legacy volume.
2. Open the SAME tool-heavy legacy chat used for the baseline.
3. Browser console:

   ```js
   window.__MAYON_PERF__ = 1;
   localStorage.mayon_perf_scenario = 'tool-heavy-timeline';
   ```

4. Reload, scroll the timeline top→bottom at a steady pace for ~30s, record the latest `[mayon-perf]` summary.

## Record here (after rewrite)

| Metric                                                   | Value                 | vs baseline       |
| -------------------------------------------------------- | --------------------- | ----------------- |
| fps / frame timing summary                               | _PENDING_             | —                 |
| longtasks (count, total ms)                              | _PENDING_             | must not be worse |
| layout shifts (count, score)                             | _PENDING_             | —                 |
| input latency p95                                        | _PENDING_             | —                 |
| render counts (`TimelineRow` counter — was `MessageRow`) | _PENDING_             | must not be worse |
| scenario tag confirmed                                   | `tool-heavy-timeline` | —                 |

## Constitution bar (IV)

Render counts and longtask totals must not be worse than `notes/perf-baseline.md`. The registry rewrite replaced per-row role ladders with one dispatch path and moved LazyMount to durable items only (live items excluded to avoid churn); the 12 Hz stream flush throttle is preserved (`RENDER_INTERVAL_MS`) — live text updates feed from `streamBufferRender`, never the raw buffer.
