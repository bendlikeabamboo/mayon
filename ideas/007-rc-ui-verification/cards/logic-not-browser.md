---
card: 004
name: logic-not-browser
origin: dealt
bet: Wins if quiz/lab bugs live in logic and data seams, not the DOM, and e2e maintenance would cost more than it catches
played: yes
---

# Card 004 — Push coverage down, not out

## Story

You build no quiz/labs browser specs at all. Instead, quiz generation, grading, and lab flows get Vitest integration coverage on the pglite driver — deterministic by construction, milliseconds per run, no browser to feed — while the RC keeps a two-minute manual smoke for pixels. The browser layer stays limited to the existing chat, onboard, and render specs. The contrarian bet: the DOM is the most stable part of quiz/labs, and the expensive e2e layer is the wrong place to hunt their bugs.

## Playthrough (2026-09-05)

- **What & why**: RC releases get verified by automated UI regression runs instead of a manual quiz-and-labs pass — because every manual RC pass is a repeatable chore that grows and gets skipped.
- **How it goes**: You stub the provider at its interface and put the whole logic layer under Vitest on pglite: quiz reply → parse → `toQuizQuestions` → rows in Postgres; every grading bucket (correct, wrong, short-answer); lab generation and step flows; the error paths (`QuizGenerationError`, `LabGenerationError`, malformed and truncated replies). The suite runs in seconds, covers more of quiz/labs logic than any browser deck could affordably reach, and the mock's dialect problem never appears — the mock is the interface stub itself, so `tests/fixtures/mock-llm/` stays untouched.
- **Snags**: (1) The bet is testable and probably half-right — quiz/lab *bugs* often are logic bugs — but the chore you actually want dead is a *whole-feature* check: does the quiz page render the rows, does the lab tool wiring in `generative-tools.ts` reach the provider, does the flow hold together. Logic tests say nothing about those seams, so the manual pass shrinks but persists — you automate the layer you trusted most and keep hand-checking the wiring you don't. (2) Stubbing at the interface bypasses the real request path — prompt assembly, proxy hop, key path — so "don't break how we intercept the data" has no automated witness here; a broken prompt or proxy change sails through green. (3) UI regressions are invisible by design, and the 2-minute manual smoke is forever.
- **Trade-offs**: deepest logic coverage in the deck for the least runtime, but it explicitly leaves the user's stated surface — "I'm only talking about the UI" — unautomated; the card bets against the user's own framing.
- **Delivers the what?**: partially — deep deterministic coverage of the logic layer, but the UI verification the idea asked for stays manual.
- **Difficulty vs payoff**: difficulty S–M · payoff M (for the stated what: low) · time-to-first-value days
- **Your take**: "Card 4 is interesting also. Might be a good idea to have this test as well, actually" — user sees it as a complement to a UI deck (grading buckets and error paths are miserable to cover through a browser), not a rival. PICKED (2026-09-05) as the complement in the 001+004 hybrid; spec seed persisted at `spec.md` in the idea folder.
