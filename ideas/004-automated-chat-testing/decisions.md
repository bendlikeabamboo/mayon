# Decisions: 004-automated-chat-testing

- Created: 2026-09-02T04:14:37Z

## Verdict

- **Winner**: Card 003 — stock-mock-server (`cards/stock-mock-server.md`)
- **Runner-up**: Card 001 — mock-llm-provider (`cards/mock-llm-provider.md`)
- **Why**: most complete delivery of the what — onboarding (dummy key through the real key path), send/receive through the LLM proxy, and deterministic kitchen-sink rendering — with zero product changes, days to first value, and a clean CI fit (no LLM secrets, no per-run cost, no third-party flake). User's reasoning: "the most complete and does the job well". Card 001's purpose-built seam remains the honest runner-up; its kitchen-sink reply is expected to live on as the mock's fixture body.
- **Date**: 2026-09-02
