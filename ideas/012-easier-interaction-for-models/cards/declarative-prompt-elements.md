---
card: 004
name: declarative-prompt-elements
origin: dealt
bet: Wins if most awaited features are additive data/prompt slots rather than interactions — config where you expected code
played: yes
---

# Card 004 — Declarative prompt elements (reframe)

## Story

You stop asking how agents test features and shrink the feature surface itself: the system prompt becomes a schema-driven list of elements, so "user background" is a new entry in a declarative config — label, storage key, prompt slot — rendered generically by the existing UI. The agent's job for many features drops to defining a config record and its logic-layer test, and there is almost nothing left to drive in a browser. Features like the example stop being code at all.

## Playthrough (2026-10-31)

- **How it goes**: Week one you define the element schema — each prompt element is a record: key, label, storage key, prompt fragment, ordering — with a generic settings renderer and a registry-driven assembler slot; existing prompt settings (per-surface custom instructions, briefs) migrate into the registry, generalizing the already-documented prompt-settings contract (`docs/history/appendices/020-prompt-settings-contract.md`). Then "user background" arrives and is not a feature: a row (key, label, storage, `## About the user\n{value}` fragment) plus one assembler test — an hour, no component written, no browser opened. A whole class of the queue dissolves into configuration.
- **Snags**: (1) The schema is a commitment — the day an element wants conditional logic ("include X only for model Y"), you either grow the schema toward a config programming language (the classic trap) or fall back to code; the declarative boundary needs policing. (2) One generic UI trades per-element craft for uniformity; odd elements (rich text, uploads) force escape hatches, each eroding the "no UI work" promise. (3) Migration touches prompt assembly — the most sensitive code in the app — for zero user-visible change, and reshapes the settings UI for existing users. (4) Eats only additive-slot features; interaction features untouched, so the deck's what still needs another card's story for those. Centralized risk: one assembler bug breaks all elements at once.
- **Trade-offs**: Uniformity over craft; schema rigidity over per-feature freedom; upfront surgery on sensitive code; risk concentrated in the single generic path.
- **Delivers the what?**: Partially — spectacularly for additive prompt/data features (browser fully out of the loop, agent's job shrinks to a row + test); nothing for every other feature class.
- **Difficulty vs payoff**: difficulty M · payoff H for the additive-slot subset · time-to-first-value ~1–2 weeks (schema + migration before config-only features flow).
- **Your take**: "additive slots are not that much i think. there will be a good mix of output parsing, ui building, etc. not just additive prompt slots." — The card's bet ("wins if most awaited features are additive slots") effectively loses: the additive fraction is small in the user's real queue. Notable signal for the verdict: the queue's mix includes output parsing (logic-layer, already text-verifiable today) and UI building (the class that keeps browser testing alive) — the residual hard class for every card in this deck.
