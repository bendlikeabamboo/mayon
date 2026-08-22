# Quickstart: Validating First-Class Inference Provider Templates

**Feature**: specs/007-inference-provider-templates
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Runnable validation scenarios proving the feature end-to-end. Field values: see
[data-model.md](./data-model.md); behavioral guarantees: see
[contracts/provider-templates.md](./contracts/provider-templates.md).

## Prerequisites

- Dev stack running: `pnpm dev` (web on http://localhost:5173, server on :4319).
- At least one provider API key (Groq's free tier is the zero-cost option). Keys are
  optional for the automated checks below.
- No `@mayon/shared` changes involved; no rebuild beyond the normal dev stack.

## Automated validation (no keys needed)

```bash
pnpm check   # svelte-check — must pass
pnpm lint    # ESLint + Prettier — must pass
pnpm test    # Vitest — includes new registry + capability tests
```

Expected outcomes:

- New `src/lib/ai/registry.test.ts` passes: six new templates present, correct shape,
  correct catalog order (data-model.md validation rules 1–3).
- Extended `src/lib/agent/capability.test.ts` passes: tools resolve on for all nine
  new gateway base URLs and off for an unknown URL (rule 4).

## Manual validation scenarios (browser, dev stack)

### Scenario 1 — Catalog presence & ordering (spec FR-001/FR-007, SC-002)

1. Open Settings → Add provider.
2. **Expected**: DeepSeek, xAI (Grok), Moonshot Kimi, Qwen (DashScope), Groq, Mistral
   appear first, in that order, each with a one-line description; existing entries
   follow unchanged.

### Scenario 2 — One-click setup (SC-001)

Per provider (repeat with each key you hold; DeepSeek minimum):

1. Pick the provider entry; **Expected**: base URL prefilled, no endpoint typing.
2. Paste the API key; proceed.
3. **Expected**: model list populates (live discovery where `discoverable`; Qwen may
   show the curated list).
4. Send a chat message; **Expected**: a reply streams from that provider.

### Scenario 3 — Tools on by default (FR-004, SC-004)

1. With a provider configured (e.g. DeepSeek), open a chat with a tool enabled (e.g.
   a search MCP tool).
2. Send a message that should trigger the tool.
3. **Expected**: the tool is invoked and its result used — no settings change needed.

### Scenario 4 — Regional endpoint switch (FR-004, User Story 3)

1. Edit the Kimi (or Qwen) provider's base URL to the `.cn` / CN variant.
2. Re-run discovery and a tool-using chat.
3. **Expected**: discovery still works and tools remain on by default.

### Scenario 5 — No-server operation (FR-005, User Story 5)

1. Stop the server (or open the app with the server unreachable) and configure Groq.
2. **Expected**: chat works via direct browser connection.

### Scenario 6 — CORS proxy fallback (FR-005)

1. With the server connected, use a CORS-blocked provider (e.g. DeepSeek).
2. **Expected**: chat streams via the existing proxy automatically — no extra
   configuration, no error.

### Scenario 7 — DeepSeek reasoning inertness (edge case)

1. Chat with `deepseek-chat` while toggling the reasoning option.
2. **Expected**: no error; reasoning behavior follows the model alias
   (`deepseek-reasoner` thinks, `deepseek-chat` doesn't).

### Scenario 8 — Docs updated (FR-008, User Story 7)

1. Check `README.md`'s provider line.
2. **Expected**: all six new providers named; "and more" still points custom
   OpenAI-compatible providers at the custom-endpoint path.

## Regression guard

- Existing provider templates still function: add/use an OpenAI or Z.AI provider and
  confirm chat + tools (SC-005).
- `pnpm test` shows no failures in pre-existing suites.

## Validation results (2026-08-22)

| Scenario                         | Status                                  |
| -------------------------------- | --------------------------------------- |
| 1 - Catalog presence & order     | Covered by T023 order test (67/67 pass) |
| 2 - One-click setup              | Requires user validation with API keys  |
| 3 - Tools on by default          | Requires user validation with API keys  |
| 4 - Regional endpoint switch     | Requires user validation with API keys  |
| 5 - No-server operation          | Requires user validation with dev stack |
| 6 - CORS proxy fallback          | Requires user validation with dev stack |
| 7 - DeepSeek reasoning inertness | Requires user validation with API key   |
| 8 - Docs updated                 | Automated: README bullet updated (T022) |
