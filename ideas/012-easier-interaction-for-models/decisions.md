# Decisions: 012-easier-interaction-for-models

- Created: 2026-10-31

## What & Why (confirmed at deal)

- **What**: AI agents can implement and verify new Mayon features end-to-end, with browser automation no longer the bottleneck of feature work.
- **Why**: Agent-driven feature work funnels through Playwright-style UI testing, which is slow and brittle, even though most of a feature's risk lives below the UI — in data and logic that text can reach directly.
- **Scope note (2026-10-31)**: prompt-quality evaluation ("how good is the prompt", guardrail checks, prompt-engineering iteration) is handled outside Mayon's codebase — the user operates Langfuse for that workflow, decoupled from application code. Idea 012 stays focused on agents implementing and verifying features against data/logic as text; the LLM-as-judge idea is out of scope for this deck.

## Verdict

- **Winner**: Card 001 — text-first-runtime (`cards/text-first-runtime.md`), in its revised boundary-freeze form; absorbs Card 002's logic-layer-first rule as the placement policy and Card 003's agent's map + enforcement ladder (lint wire, CI direction rules) as the delivery vehicle. User's framing: "enforce-able, text-focused tier. if a feature can be put there without much effort, it should be there."
- **Runner-up**: Card 002 — logic-layer-first (same day-to-day result, cheaper still; rejected as sole winner because it is rule-only with no gate, and the user works mostly with agents and wants machine guardrails).
- **Why**: Most of the tier already exists (repos/`StorageDriver`/pglite harness/`context.test.ts`/mock-LLM rig — see research.md); remaining work is declaration + freeze + enforcement + agent's map — difficulty M, first value in days. Card 004's additive fraction too small per user; Card 005 killed unplayed.
- **Date**: 2026-10-31
- **Spec seed**: `spec.md`
