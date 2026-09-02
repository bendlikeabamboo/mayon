---
card: 002
name: kitchen-sink-fixture
origin: dealt
bet: Wins if regression risk is concentrated in rendering/expound rather than the chat request path — and coverage is wanted this week, not this sprint
played: yes
---

# Card 002 — Kitchen-sink fixture (smaller)

## Story

No provider work at all: you ship a test-only route (or a seeded conversation) that renders one stored assistant message holding the kitchen-sink markdown document, and Playwright loads it directly. Within an afternoon, every rendering assertion — markdown structure, math, mermaid, code copy buttons, expound alignment, full-text search — becomes testable without touching the AI layer. What you give up: nothing about onboarding, sending, streaming, or the request path is exercised; the fixture starts _after_ the reply already exists.

## Playthrough (2026-09-02)

- **Goal (what & why)**: run meaningful automated Playwright tests of the whole chat experience — onboarding, send/receive, rendering — with no real LLM, key, or network.
- **How it goes**: You skip the AI layer entirely: one seeded conversation (or a gated dev route) whose single assistant message is the kitchen-sink markdown document. Playwright opens it directly and the rendering suite lands within days — deep assertions on markdown structure, copy buttons, math, mermaid, and especially expound alignment, which finally gets deterministic content with fixed source offsets. It stays green and nearly free to maintain. The bill arrives later: the first time someone wants to test "user sends a message, a reply comes back", there is still no way to produce a reply without a live provider.
- **Snags**: (1) It parks the core pain rather than solving it — the send path still needs a real LLM, so the original flaky-skipped-tests problem survives for every request-path test. Bites the first time a send/receive test is wanted; certain. (2) Variant choice carries its own trade: a dev route ships in the prod SPA bundle unless gated; a DB seed keeps the product untouched but means building seeding mechanics. (3) Same kitchen-sink rot as Card 001 — new render features don't auto-appear in the fixture, so "everything we support" drifts. Slow, months.
- **Trade-offs**: zero coverage of onboarding, sending, proxy, receive/error paths; the fixture stays a second source of truth for the renderer's feature list; request-path test debt remains on the books.
- **Delivers the what?**: partially — rendering coverage is deep, deterministic, and immediate; onboarding and send/receive are not covered at all.
- **Difficulty vs payoff**: difficulty S · payoff M · time-to-first-value days
- **Your take**: "too small of a scope" — the user wants the request path covered, not just rendering.
