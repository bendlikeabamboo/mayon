---
card: 005
name: screenshot-baselines
origin: dealt
bet: Wins if the regressions you currently catch by eye are visual ones that word-assertions miss
played: yes
---

# Card 005 — Screenshot baselines

## Story

The mock LLM already guarantees byte-stable replies — so you freeze the render too: Playwright screenshot baselines for each quiz and lab state (empty, in-progress, completed), diffed on every run. Assertions stop being sentences about the DOM and become pixel diffs; a styling, layout, or math-render regression shows up as a red image before you would have spotted it by eye. Accepting an intentional change is one `--update-snapshots` command.

## Playthrough (2026-09-05)

- **What & why**: RC releases get verified by automated UI regression runs instead of a manual quiz-and-labs pass — because every manual RC pass is a repeatable chore that grows and gets skipped.
- **How it goes**: You take the same fixture groundwork as cards 001/002 — quiz-shaped and lab-shaped replies from the mock are a precondition, since pixel diffs only hold if content is byte-stable — then drive the UI into each meaningful state (quiz list empty, quiz in progress, quiz graded, lab running, lab done) and freeze each render as a baseline. From then on the run diffs pixels, and Mayon's intentionally low-contrast theme works *for* you here: the subtle contrast and spacing shifts the eye slides over on a manual pass are exactly what a pixel diff catches. An intentional redesign is one `--update-snapshots` pass with the diff reviewed and the new baselines committed.
- **Snags**: (1) Pixels are only as deterministic as their inputs — fonts must render identically in CI and locally (bundle them or pin them), animations disabled, fixed viewport, pinned browser build (every Playwright upgrade can re-render the world), and screenshots taken only after the render settles. This is the card's real work, and it bites in week one, not month three. (2) It is an assertion style, not a standalone path — it ships no flow coverage: a wrong grade that renders confidently still looks "right" to a pixel diff. (3) Baseline churn — every intentional UI change to quiz/labs means regenerating and reviewing baselines; friction scales with how much that UI iterates.
- **Trade-offs**: near-zero per-assertion maintenance and the only visual-regression coverage in the deck, in exchange for a determinism harness (fonts, viewport, engine pinning) and blindness to behavior/logic unless stacked on card 001's specs.
- **Delivers the what?**: partially — automates and hardens exactly the by-eye layer of the manual RC pass, but says nothing about whether answering a question produces a grade; strongest as a layer on 001.
- **Difficulty vs payoff**: difficulty M (the determinism harness is the work) · payoff M–H as a complement · time-to-first-value days–1 week
- **Your take**: (none)
