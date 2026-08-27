# SC Verdicts — Final validation pass (quickstart.md, T047)

Date: 2026-08-27 · Branch `feat/ui_overhaul` · Dev stack `mayon-dev`
(web :5173 HTTP 200, `/api/health` ok v0.3.0 caps incl `pg`).
Method: implementation-phase story evidence (`us1…us9`) + final live
playwright-cli sweep at 1440×900 re-sampling the remaining light-theme legs
(`/quiz`, `/lab`, `/tree`, font inventory; captures `t047-*.png`) and the
T045 known-ripple probes (`t045-*.png`). Gates green post-T044/T045 edits
(see tail notes).

| SC | Verdict | Proof |
| --- | --- | --- |
| SC-1 | PASS | Accent/hover identifiability across screens: `us1-accent-light.png`; uniform `hover:bg-accent` idiom on all 5 swept surfaces (`us5-micro.md` §T024); light quiz/lab/tree walk captured (`t047-quiz-light.png`, `t047-lab-light.png`, `t047-tree-light.png`) — no control lacked a cue. |
| SC-2 | PASS | Surface-role ranking correct on every sampled screen in both themes: per-screen ladder table + computed token ordering (`us2-ladder.md`); card = border+shadow recipe verified live (FR-7). |
| SC-3 | PASS | Resume/start ≤ 2 interactions measured: resume card = tab stop → Enter, mouse = 1 click (`us4-home.md` "Interactions-to-start"); home invitation elements re-verified live against chat `us3seed-0001-chat`. |
| SC-4 | PASS | All three launchers' outcomes survived full reload as real Postgres rows: quiz/lab/branch reload-proof table (`us3-launchers.md` §Persistence proof). |
| SC-5 | PASS (informal) | Single canonical copy · branch · regenerate strip, hover+keyboard-revealed, aria-labeled: `us5-hover-actions.png`, clipboard read-back probe (`us5-micro.md` §T022); informal self-walkthrough substitute for an unfamiliar-user panel. |
| SC-6 | PASS | Legacy db/server status facts all reachable in ≤ 2 actions from ONE indicator row (`us6-chips.md` fact-retention table + T027–29 enumeration); contract pinned by `StatusIndicator.compose.test.ts`. |
| SC-7 | PENDING-OWNER | Owner sign-off checkbox unticked by design (`us7-warm-charcoal.md` §AWAITING OWNER SIGN-OFF, T035 gate); token table + before/after pairs assembled there for the review. |
| SC-8 | PASS | Zero serif text faces shipped/loaded: all Newsreader/Fraunces `@font-face` + imports removed in T044 (`src/app.css`, `src/routes/+layout.svelte`); live `document.fonts` inventory this session = KaTeX_* math families only + Bpmf Huninn + Fira Sans. Unreferenced git-tracked Newsreader binaries remain in `static/fonts` (inert, not fetched). |
| SC-9 | PASS | Reduced-motion traversal: 0 WAAPI animations created, animated nodes render at opacity 1 immediately under CDP `reduce` (`us9-loading.md` §Reduced-motion verification); gate in `src/lib/motion/stagger.ts` + unit tests in `stagger.test.ts`; caret rotate endpoint survives suppression (`us5-micro.md` §T023). |
| SC-10 | PASS | No capability loss / forced extra scrolling: zero-fact-loss compression tables (`us6-chips.md`), RowCard anatomy parity across chat/quiz/lab/home lists (`us8-rows.md`), post-restyle list content intact in final captures (`t047-quiz/lab/tree-light.png`, `us4-home-with-history.png`). |

## Footnotes

1. Known pre-existing issue (recorded in us4/us5/us8/us9, reproduced once on
   cold load this session): direct/hard URL loads can hit a "Database not
   bootstrapped yet" boot race; SPA navigation unaffected. Not caused by
   feature 012; flagged for follow-up at the data-layer seam.
2. The `bg-primary` current-node fill on `/tree/<id>` params remains a dead
   code path (no such links exist); its hover/current collision was fixed
   regardless (T045, `tree/+page.svelte` `rowHoverTint`, forced-class +
   screenshot proof `t045-tree-currentnode-dark.png`).
3. Gates at T047 close: `pnpm check` 0 errors/0 warnings · `pnpm lint`
   clean · `pnpm test` 98 files / 1538 tests · server suite 10 files /
   85 tests (unchanged since last green run).
