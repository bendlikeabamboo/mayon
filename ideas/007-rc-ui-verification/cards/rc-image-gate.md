---
card: 003
name: rc-image-gate
origin: dealt
bet: Wins if what you need to trust is the release artifact, and dev-stack green never proved image green
played: yes
---

# Card 003 — RC image gate

## Story

When CI tags `vX.Y.Z-rcN`, a workflow pulls the published `:rc` web and server images, boots the prod-shaped compose with the mock-llm service attached, and runs the quiz/labs Playwright deck against that stack, posting a green/red check on the GitHub Release. You stop testing the dev stack and start testing the exact artifact about to ship — what later lands in `:latest` is precisely what the deck blessed. The deck itself can start as card 002's smoke and grow.

## Playthrough (2026-09-05)

- **What & why**: RC releases get verified by automated UI regression runs instead of a manual quiz-and-labs pass — because every manual RC pass is a repeatable chore that grows and gets skipped.
- **How it goes**: You wire the workflow once: on an `vX.Y.Z-rcN` tag, pull the published `:rc` web and server images, boot the prod-shaped compose with the mock-llm service attached (017's CI already boots mock-llm and health-checks it from the server container, so there is precedent), run the quiz/labs deck against that stack, and post the green/red check on the GitHub Release. First RC through, you read the tick and ship. The card's money moment comes a few RCs later: local dev stack green, gate red — the workflow just caught a build/packaging-class regression that dev-stack testing structurally cannot see, on the exact artifact that would have shipped.
- **Snags**: (1) It is a delivery mechanism, not content — it ships zero specs of its own, so it stacks on card 001 or 002's work; picking it alone verifies nothing. (2) Feedback arrives after publish — the check lands on an already-published `:rc`, so a red gate means an rcN+1 cycle (cheap under the RC rules, no file edits, but still a cycle). (3) Debugging runs against images, not your working tree — repro means pulling the same `:rc` and running the same compose, a slower loop than dev-stack failures. (4) Flake discipline becomes existential — a release gate that flakes even occasionally trains you to ignore red, which is the most dangerous state a gate can be in.
- **Trade-offs**: slower, heavier CI (compose boot, healthchecks, full browser run per RC) and post-publish feedback, in exchange for trust in the exact artifact and the only coverage in the deck for packaging/build regressions.
- **Delivers the what?**: fully, and more-than — it answers "can I trust this RC?" with a check on the release itself; but partially on its own, since it presumes deck content from 001/002.
- **Difficulty vs payoff**: difficulty M for the mechanics (stacks on 001/002's content) · payoff H · time-to-first-value 1–2 weeks (needs at least the smoke specs to exist first)
- **Your take**: "No, I'm testing the app code" — the trust gap is code, not the packaged artifact; Docker already gives good enough reproducibility to not invest more in image-gating. Card effectively declined as a primary path.
