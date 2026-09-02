---
card: 001
name: mock-llm-provider
origin: user
bet: Wins if the provider seam is cheap to extend and most regression risk lives in the send → render pipeline
played: yes
---

# Card 001 — Mock LLM provider (your card)

## Story

You add a built-in "Mock" provider through the normal provider onboarding flow — no API key, no network. You pick a model, send a message, and every turn comes back with the same static kitchen-sink reply: headings, lists, tables, code blocks with copy buttons, math, mermaid, links, blockquotes, task lists — everything the Markdown renderer supports, plus content shaped so highlight/expound selection can be exercised. Playwright now drives the real onboarding → send → stream → render pipeline on every commit, deterministically and for free.

## Playthrough (2026-09-02)

- **Goal (what & why)**: run meaningful automated Playwright tests of the whole chat experience — onboarding, send/receive, rendering — with no real LLM, key, or network; today any E2E test through a chat reply needs a live provider, so tests get skipped or flake.
- **How it goes**: You make "mock" a sixth provider kind beside the five real ones and wire it through settings onboarding like any provider. The first weeks are the honeymoon: Playwright onboards the provider, sends a message, and asserts against the same kitchen-sink reply every run — deterministic, free, offline. Then maintenance reality sets in: the mock is product code now, so every provider-seam refactor drags it along, and every new renderer feature has to be manually added to the static reply or the "tests everything we support" claim quietly rots. Over months, tests increasingly assert the fixture's content rather than app behavior, and the fixture becomes a second source of truth for "all supported elements".
- **Snags**: (1) The seam is wider than the factory — `sdk-factory.ts` is a closed switch over 5 kinds, but `dialects.ts` also tables per-kind extra-body allowlists, effort levels, sampling locks, and template mapping; the mock must be threaded through all of them or excluded explicitly. Bites at every provider refactor; chronic. (2) Kitchen-sink rot: new markdown/render features don't auto-appear in the static reply, so coverage drifts silently. Bites months in, medium damage. (3) A keyless mock skips the `hasProviderKey`/IndexedDB key path by construction — half the onboarding story goes untested. Bites when writing the onboarding test; awkward. (4) Hunch (unverified): a static single reply may not exercise chunked/streaming render the way real providers do.
- **Trade-offs**: test scaffolding ships inside product code forever — or hides behind a dev flag, which weakens the "onboard like a real provider" story; the mock reply duplicates the renderer's feature list; the LLM-proxy protocol path is bypassed entirely.
- **Delivers the what?**: partially — onboarding, send, and render are covered deterministically, but only for whatever the sink contains; the key-handling path and the proxy protocol path are skipped by construction.
- **Difficulty vs payoff**: difficulty M · payoff H · time-to-first-value ~1–2 weeks
- **Your take**: (none)
