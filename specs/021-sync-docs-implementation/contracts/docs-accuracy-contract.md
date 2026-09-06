# Contract: Documentation Factual Accuracy

**Feature**: specs/021-sync-docs-implementation | **Date**: 2026-09-06

This feature has no public API. The "interface" it must honor is the factual accuracy of
the documentation itself: every checkable claim a page makes is a contract between the
page and the product. This file fixes the ground truth each page must state, so tasks and
review can verify compliance mechanically. Ground truth was verified against the code in
research.md; if code changes before implementation, re-verify the affected line — the
product, not this file, is authoritative.

## Global contract (all pages)

1. Product names (screens, buttons, settings, routes) appear exactly as the UI spells
   them.
2. A page states only behavior a current user can observe; capability-dependent behavior
   says when it applies (e.g., server-present vs browser-only operation).
3. Overlapping topics agree; the page designated primary wins.
4. Prose is complete, plain professional writing for non-developers (owner requirement).
5. No page presents unreleased functionality as available.

## Per-page factual contract

| Page | Must state (ground truth) |
|---|---|
| tutorials/getting-started.qmd | DB status pill reads "DB ready" with a separate "Runtime: …" line (`DbStatus.svelte`); first run lands on the `/` dashboard ("continue learning" / in-progress labs), not directly in a chat; boot failure shows a full-screen "Cannot reach the Mayon server." with a `docker compose up` hint and a Retry button. |
| tutorials/chat-and-branching.qmd | Branch actions are labeled "Branch from this" (highlight) and "Branch from this text" (context menu); provider/model choice is made in Settings → Providers ("Set active"), not in the chat composer; the sidebar lists flat Parents / Branches / Siblings sections; the visual tree is the dedicated /tree page; breadcrumbs and cross-links as currently rendered (verify cross-link placement before writing). |
| how-to/providers.qmd | Template picker offers 18 templates (DeepSeek, xAI, Moonshot Kimi, Qwen, Groq, Mistral, OpenCode Zen, LiteLLM, Vercel AI Gateway, Requesty, Z.AI (GLM), Kilo Gateway, OpenRouter, OpenAI, Anthropic, Google Gemini, Ollama (local), GitHub Copilot); no template is "default" (DeepSeek leads the list); GitHub Copilot uses server-side auth, not a pasted key; Ollama base URL `http://localhost:11434/api`; buttons "Add provider", "Set active", "Save key"; keys are stored locally and never echoed ("Replace API key (stored locally)"). |
| how-to/labs.qmd | Labs persist in the server's Postgres database like all other data — no local SQLite, server required (align with data-and-privacy.qmd); button "Generate lab"; checklist progress shows "{done}/{total} done"; custom "Lab generation prompt" setting exists in Settings; regenerate behavior described as actually implemented (verify checklist reset before documenting). |
| how-to/quizzes.qmd | Button "Generate quiz"; question payloads mcq/flashcard/short as shipped; attempt history with switching; custom "Quiz generation prompt" setting; describe the actual default quiz-runner mode after verifying it in the UI. |
| how-to/data-and-privacy.qmd | Already compliant — keep in sync if related facts change elsewhere. |
| how-to/building.qmd | Already compliant — keep in sync; commands must continue matching package.json scripts. |
| how-to/contributing.qmd | Must agree with CONTRIBUTING.md on branch naming and commit convention; one of the two is primary (decide in tasks; suggestion: qmd is primary for flow, CONTRIBUTING.md mirrors it). |
| index.qmd | Include the install one-liner as the fastest path (owner: path of least resistance), then dev-stack instructions. |
| reference/seams.qmd | Already compliant — re-check only if neighbors' corrections touch described seams. |
| explanation/architecture.qmd | Route list includes `/`, `/login`, `/chat`, `/lab`, `/quiz`, `/search`, `/tree`, `/settings`; schema section includes `chats.mcp_config`, `messages.parts`, `agent_traces`; provider enumeration matches the 18-template registry incl. `github-copilot`; product summary mentions image parts, personas/Learner Profile, section peek strip, custom prompt settings. |
| README.md | Provider enumeration includes GitHub Copilot; install one-liner stays the lead. |
| CONTRIBUTING.md | Branch prefix and commit convention match how-to/contributing.qmd exactly (Conventional Commits, `feat/…`-style prefixes per the chosen primary). |

## Acceptance

A page satisfies the contract when every row above that applies to it is true in the
rendered docs, verified by performing the described steps (quickstart.md).
