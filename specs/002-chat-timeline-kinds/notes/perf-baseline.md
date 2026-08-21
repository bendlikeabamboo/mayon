# Perf Baseline Protocol — Chat Timeline Kind Model (T001)

**Scenario**: `tool-heavy-timeline`
**Status**: PROTOCOL READY — numeric capture requires a human-driven browser session against the dev stack; automated capture is not available in the implementation environment. Capture BEFORE merging the Phase 3 (US1) presentation rewrite.

## How to capture

1. Bring up the dev stack: `pnpm dev` (web on http://localhost:5173, server :4319, project `mayon-dev`).
2. Open a **legacy tool-heavy chat** (several tool calls + results; ideally one with structured JSON result detail and one `present_choices` offer). If none exists, create one first (e.g. run a quiz/lab creation flow that triggers approvals and choices) on the PRE-migration database.
3. In the browser console:

   ```js
   window.__MAYON_PERF__ = 1;
   localStorage.mayon_perf_scenario = 'tool-heavy-timeline';
   ```

4. Reload the chat, scroll the timeline top→bottom at a steady pace for ~30s, then record the latest `[mayon-perf]` JSON summary.

## Record here (baseline — before US1 rewrite)

| Metric                                    | Value                 |
| ----------------------------------------- | --------------------- |
| fps / frame timing summary                | _PENDING_             |
| longtasks (count, total ms)               | _PENDING_             |
| layout shifts (count, score)              | _PENDING_             |
| input latency p95                         | _PENDING_             |
| render counts (`MessageRow` / components) | _PENDING_             |
| scenario tag confirmed                    | `tool-heavy-timeline` |

## After the rewrite (T037)

Repeat verbatim on the same chat and record into `notes/perf-after.md`; compare against this table. Constitution IV: render counts and longtask totals must not be worse than baseline.
