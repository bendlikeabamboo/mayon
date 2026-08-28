# Performance Baseline (pre-change): Settings Page Navigation

**Captured**: 2026-08-28, before any implementation task touched page code (after T002–T008, which only added unused modules/utilities — `/settings` DOM and behavior unchanged).
**Page**: http://localhost:5173/settings (dev stack, `mayon-dev` compose; Vite HMR)
**Method**: Playwright-driven. `window.__MAYON_PERF__ = 1` injected via `page.addInitScript` (the probe checks the flag once at module init, so it must be set before load), `localStorage.mayon_perf_scenario = 'settings-nav-baseline'`, reload, then 14× 800px wheel-down + 14× wheel-up (~7 s of scrolling), summaries read from `[mayon-perf]` console output.

## Baseline numbers (3-second summary windows during/after scroll)

| Window | frames | avg frame | p95 | max | dropped | longtasks | cls |
|--------|--------|-----------|-----|-----|---------|-----------|-----|
| t=6.0s (scrolling) | 179 | 16.67 ms | 16.80 ms | 16.80 ms | 0 | 0 reported | 0 reported |
| t=9.0s (scrolling) | 179 | 16.67 ms | 16.70 ms | 16.80 ms | 0 | 0 reported | 0 reported |
| t=12.0s (scrolling) | 179 | 16.67 ms | 16.70 ms | 16.80 ms | 0 | 0 reported | 0 reported |
| t=15.0s (idle) | 179 | 16.67 ms | 16.70 ms | 16.80 ms | 0 | 0 reported | 0 reported |

**Interpretation**: rock-steady ~60 fps (179 frames per 3 s window), zero dropped frames, no long tasks or layout shifts reported in any window. The probe omits zero-valued sections from the JSON.

**Acceptance for T024 (post-change)**: frame timing/longtask metrics remain at this level with rail + search + mobile affordance mounted and exercised (scroll + jumps).

**Note for re-measurement**: `window.__MAYON_PERF__ = 1` set from the console after load is inert (`probe.ts` checks once at init); inject before load (addInitScript) and reload. Scenario tag in `localStorage.mayon_perf_scenario` persists across reloads.

## T024 post-change result (2026-08-28)

Identical protocol with rail + search + mobile affordance mounted (feature fully wired, desktop 1536px):

| Window | frames | avg frame | p95 | dropped | longtasks |
|--------|--------|-----------|-----|---------|-----------|
| scroll + idle, t=3s…t=45s | 179–180 | 16.666 ms | ≤ 16.8 ms | 0 | 0 reported |

**Verdict**: no regression — frame timing, dropped frames, and long tasks are indistinguishable from the pre-change baseline.

## Supplemental stress test (2026-08-28, playwright-driven)

Workload: 24 rapid rail jumps in 3 passes over all 8 sections (~400 ms apart, deliberately overlapping smooth scrolls through the retarget path), plus 40 aggressive wheel events (~48,000 px total scroll). `PerformanceObserver({ entryTypes: ['longtask'] })` armed before the workload; probe running concurrently.

| Metric | Result |
|--------|--------|
| Long tasks (entire run) | **0** |
| Total blocking time | **0 ms** |
| Frames during stress windows | 179–180 per 3 s (~60 fps), p95 ≤ 16.8 ms, 0 dropped |
| Jump settle latency (24 jumps) | avg 608 ms, min 183 ms, max 1614 ms — smooth-scroll animation duration incl. the 1600 ms fallback cap on full-page traverses; main-thread never blocked |
