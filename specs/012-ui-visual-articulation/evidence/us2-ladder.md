# US2 Surface-ladder verification (T011) — SC-2

**Date**: 2026-08-27 · **Branch**: `feat/ui_overhaul` · **Viewport**: 1440×900
**Method**: dev stack (`pnpm dev:up`, project `mayon-dev`), `http://localhost:5173`,
global playwright-cli + chromium; dark mode via the app's own ThemeToggle
(cycles light → dark → system, writes settings KV; `html.dark` verified before
every dark shot). Screenshots compared by inspection against
`evidence/baseline/{home,chat}-{light,dark}.png`.

## After screenshots

- `us2-chat-light.png` — route `/chat` (2 chat rows visible)
- `us2-chat-dark.png` — route `/chat`
- `us2-home-light.png` — route `/` (recents + quizzes cards)
- `us2-home-dark.png` — route `/`

## Token values after T008 (computed live from the served CSS)

| Theme | `--sidebar` (L1 panel) | `--background` (L0 canvas) | `--card` (L2 raised) | Ordering |
|---|---|---|---|---|
| Light | `oklch(0.945 0.01 90)` | `oklch(0.955 0.012 90)` | `oklch(0.975 0.008 90)` | sidebar < canvas < card ✓ (quietest-light) |
| Dark | `oklch(0.18 0 0)` | `oklch(0.301 0 0)` | `oklch(0.205 0 0)` | sidebar < card < canvas ✓ (darkest-dark) |

Adjacent lightness deltas:

- Light: sidebar→canvas **1.0**, canvas→card **2.0**, sidebar→card **3.0** — all within the ~2–3-point budget.
- Dark: sidebar→card **2.5** ✓. Canvas→card is **9.6** — pre-existing (both values
  untouched by US2; separation there is carried border-first per GP-1 and the dark
  neutral block is re-owned by US7/T034). Sidebar→canvas role inversion (darkest
  region) is the deliberate contract §2 L1 dark behavior.
- No foreground/text token changed in this wave (GP-1 text/background rule intact).

## Per-screen ladder ranking (observed)

| Screen | Canvas (L0) | Panel (L1) | Raised card (L2) | Ranks correctly? |
|---|---|---|---|---|
| us2-chat-light | flat page backdrop, borderless | sidebar slightly darker/quieter than canvas, hairline `border-sidebar-border` right edge | chat list rows: lighter fill + 1px border + soft shadow | ✓ 3 levels readable edge-first |
| us2-chat-dark | mid-gray canvas | sidebar visibly **darkest** band, hairline separator | rows lighter than canvas + hairline (white/10%) + shadow | ✓ |
| us2-home-light | flat backdrop | sidebar quietest | recent-chat / recent-quiz cards raised (border+shadow) | ✓ |
| us2-home-dark | mid canvas | sidebar darkest | cards lighter + border+shadow | ✓ |

## Card border+shadow confirmation (FR-7)

Computed style of a chat list row (light theme, live DOM):
`border: 1px oklch(0.922 0.006 90)` + `box-shadow: oklch(0.25 0.03 85 / 0.07) 0px 2px 10px` +
`radius: 10px` + `bg: oklch(0.975 0.008 90)` — border and shadow present together
via the single `surface-card` utility. Same recipe verified visually on home cards.

## Sidebar role statements

- **Light**: quietest region — `--sidebar` 0.945 sits slightly *below* canvas 0.955
  (was 0.962, i.e. above canvas / emphasized before T008); separation from canvas
  is the hairline right border, not a luminance jump.
- **Dark**: darkest region — `--sidebar` 0.18 sits below both canvas 0.301 and card
  0.205 (was tied with card at 0.205 before T008).

## Residual ad-hoc surfaces (unchanged, out of T009 scope)

Sites still hand-rolling `border border-border bg-card` without the shadow recipe:
`QuizRunner.svelte`, `LabRunner.svelte`, `FlashcardQuestion.svelte`,
`McqQuestion.svelte`, `QuizSummary.svelte`, `AttemptHistory.svelte`,
`ExpoundCard.svelte`, `AskEntry.svelte`, `SamplingApprovalCard.svelte`,
`chat/[id]/+page.svelte:631` (inline brief card), home empty-state boxes
(`+page.svelte:76,89`), tree node rows (`tree/+page.svelte:117`), shadcn
`dialog-content`/`alert` primitives. These are candidate adopters for US3/US8
(RowCard / composer card) rather than US2 defects; ladder ranking is unaffected.

## Notes

- `surface-card` composed cleanly at all six call sites; only tree root boxes
  changed radius `rounded-xl → rounded-lg` (recipe semantics) and traded
  `shadow-sm` for the tuned `--shadow-card`.
- Console noise during capture: benign `favicon.png` 404 + one transient
  "Database not bootstrapped yet" race on hard reload of `/chat` (pre-existing;
  SPA navigation unaffected).
