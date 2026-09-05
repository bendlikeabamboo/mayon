---
card: 002
name: quiz-only-smoke
origin: dealt
bet: Wins if RC regressions are "the feature is simply broken" breaks, which a smoke catches as cheaply as possible
played: yes
---

# Card 002 — Quiz & labs smoke run

## Story

You write two short specs instead of a suite: generate a quiz from the kitchen-sink chat, answer one question, see the grade; generate a lab, run its first step. That is the whole RC check — a fraction of the work of card 001, green in seconds. Deep flows (every question type, every lab tool, failure paths) stay on your manual list until the smoke proves itself worth extending.

## Playthrough (2026-09-05)

- **What & why**: RC releases get verified by automated UI regression runs instead of a manual quiz-and-labs pass — because every manual RC pass is a repeatable chore that grows and gets skipped.
- **How it goes**: You keep it deliberately small: two specs, one happy path each — quiz generated from the kitchen-sink chat, one question answered, grade rendered; lab generated, first step runs, done. Day one you still meet the mock's one-reply problem, because quiz and lab generation are separate provider calls and the mock speaks only chat markdown — so a minimal version of the dialect fixture work is unavoidable. That is this card's secret: it shrinks the *assertion* surface, not the *fixture* surface. The discrimination work is largely the same; you just skip every question type, the grading-fail path, and full lab flows. From week one on, the RC check is seconds of automation, and nothing built here is thrown away if the deck is later extended — this is card 001's payment plan.
- **Snags**: (1) The mock fixture work is unavoidable but gets amortized over two shallow specs — worst cost-to-coverage ratio in the deck if never extended. (2) False confidence — the green check feels like coverage; the first subtle regression past the happy path (say, short-answer grading) sails through a green suite and bites at release, teaching you what the smoke actually covers. (3) The manual list doesn't die — it shrinks; the question is whether the shrink is worth the build.
- **Trade-offs**: a coverage ceiling by design; deep flows stay manual indefinitely unless the smoke later grows (which converges on card 001 anyway); the fixture library still exists and still drifts with prompt changes, just serving less.
- **Delivers the what?**: partially — automates the RC check's shallow layer; the manual quiz/labs pass shrinks but does not vanish.
- **Difficulty vs payoff**: difficulty S · payoff M · time-to-first-value days
- **Your take**: "Too small of a scope." User rejected the coverage ceiling; the smoke-only path is out unless revived as a subset of a bigger card.
