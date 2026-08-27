# Baseline Evidence — 012-ui-visual-articulation

Captured pre-change on branch `feat/ui_overhaul`, before any T003/T004 edits.
Feeds US2 ladder comparison (T011), US7 warm-charcoal gate (T035), and US9 perf
loop closure (T043).

## Gates at capture time (T001)

| Gate         | Result |
| ------------ | ------ |
| `pnpm check` | PASS — `svelte-check found 0 errors and 0 warnings` |
| `pnpm lint`  | PASS — eslint clean; prettier "All matched files use Prettier code style!" (after owner-approved whitespace restore of the `--font-serif` custom property to prettier-canonical wrapping; Fraunces @font-face residue preserved byte-identical) |
| `pnpm test`  | PASS — `Test Files 92 passed (92)` / `Tests 1478 passed (1478)` |

## Dev stack state

- `pnpm dev:up` (docker compose project `mayon-dev`): web + server + db all
  running; db healthy. Engine: docker.
- `http://localhost:5173/` → HTTP 200 (SPA shell, title "Mayon").
- `/api/health` → HTTP 200 via Vite proxy (`{"ok":true,"version":"0.3.0","caps":["stdio-mcp","llm-proxy","sandbox-db","backup","pg"],"restoring":false}`).
- Note: dev server port 4319 is internal-only in the dev compose topology; host
  health verification must go through `http://localhost:5173/api/health`.
  A direct `curl http://localhost:4319/api/health` hangs by design.

## Screenshot artifacts (1440×900 viewport, chromium via playwright-cli)

Light theme (`mayon.theme` unset/system):

- `home-light.png` — route `/`
- `chat-light.png` — route `/chat`
- `tree-light.png` — route `/tree`

Dark theme via the app's own ThemeToggle in the sidebar footer (cycles
light → dark → system; writes `localStorage['mayon.theme']` AND the settings
KV through `bindThemePersistence`), settled ~3s per route and verified before
every shot with `document.documentElement.classList.contains('dark')`:

- `home-dark.png`
- `chat-dark.png`
- `tree-dark.png`

Together these show the app shell + sidebar footer, composer, home, lists,
and tree surfaces in both themes as required by US9/SC-7 comparisons.

## Perf baseline

- `perf-traversal.txt` — verbatim playwright-cli output of an instrumented
  traversal: `window.__MAYON_PERF__ = 1` injected via `addInitScript` BEFORE
  first paint on each route (`/` → `/chat` → `/tree`), one `[mayon-perf]`
  summary captured ~3s into each route's idle dwell.
- Summary: every route reports fps avg ≈16.67ms/frame, p95 ≈16.80ms,
  `dropped: 0`. No longtasks/layout-shift/input-latency anomalies surfaced in
  the summaries; idle-frame health is the reference point for T043.

## Limitations

1. Perf probe emits its JSON console summary every 3s; captures therefore
   reflect the steady-state window after load, not sub-300ms load timings.
   T042's loading-honesty audit still needs devtools-style timing.
2. Only one `[mayon-perf]` summary line landed per route (first 3s tick);
   later ticks during longer dwells were not separately retained.
3. Dark mode was reproduced through the app's own ThemeToggle rather than
   OS-level emulation; behaviorally identical (class toggle) but does not
   exercise `prefers-color-scheme` fallback.
4. First dark-capture attempt (localStorage `mayon.theme=dark` + reload) was
   discarded: the async boot in `src/routes/+layout.svelte` hydrates the theme
   from the settings KV (`repos.settings.get('theme')`) after mount and
   overrode the injected localStorage value, so early shots silently reverted
   to light. Clicking ThemeToggle writes both stores, making dark durable
   across reloads; per-shot class verification confirms validity.
5. Console noise at capture time: a single benign `favicon.png` 404 per load.
6. Screenshots are viewport-sized (1440×900), not full-page scrolls; below-fold
   list content is not in frame.
