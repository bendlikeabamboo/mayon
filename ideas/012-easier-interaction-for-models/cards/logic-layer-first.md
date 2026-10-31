---
card: 002
name: logic-layer-first
origin: dealt
bet: Wins if the pain is verification cost rather than architecture — repo/driver tests catch what Playwright catches today, at a fraction of the price
played: yes
---

# Card 002 — Logic-layer verification first (smaller)

## Story

Nothing is re-architected; you change the rule for feature work instead: every feature lands with vitest tests against the pglite driver and repositories — text in, assertions out — and browser tests cover only what logic can't reach (layout, wiring, visual behavior). "User background" ships as a settings-schema change plus prompt-assembly tests that an agent writes and runs in seconds, never opening a browser. The ideas/007 hybrid — logic-layer tests for quiz/labs alongside Playwright — becomes the default posture for all features, not a one-off.

## Playthrough (2026-10-31)

- **How it goes**: No audit, no architecture. Day one you write the rule down — a feature isn't done until its logic passes in vitest against pglite; the browser only tests what logic can't reach — and point agents at it. The first feature ("user background") obeys the rule the same day: settings key, prompt-assembly slot, repo-seeded test, done. Most features that follow fit; the genuinely visual ones go to Playwright without guilt, which is what the rule says anyway. Everything we learned in Card 001's dialogue (harness standing, prompt constructor already tested this way) means this card is mostly _admitting_ what already works and demanding it every time.
- **Snags**: (1) Nothing enforces it — it's a convention, not construction; a tired session or a lazy agent can skip the logic layer and no gate fails. The boundary is social, not physical. (2) Stragglers stay put — the rule covers new features; old logic still living in components only moves when a feature happens to touch it, so the codebase converges opportunistically, slowly. (3) No door gets built — if a long-lived external text client (REST/MCP) is ever wanted, this card built nothing to attach it to.
- **Trade-offs**: Gives up enforcement (no gate, review discipline only); gives up a completeness story for legacy logic; gives up any future client surface by design.
- **Delivers the what?**: Mostly — every feature that obeys the rule loses the browser bottleneck, which is the day-to-day same result as Card 001's boundary-freeze scope. The gap: nothing stops backsliding except attention.
- **Difficulty vs payoff**: difficulty S · payoff H · time-to-first-value days (starts paying with the very next feature).
- **Your take**: Wants enforcement, not convention — "for me to be honest, I want it enforced because I'll mostly be working with agents. It will serve as strong guardrails for them." The no-gate snag is disqualifying for 002 standing alone; points toward a hybrid where the logic-layer-first rule is paired with machine enforcement.
