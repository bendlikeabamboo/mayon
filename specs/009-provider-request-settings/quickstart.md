# Quickstart: Validate Provider Request Settings (Feature 009)

**Spec**: [spec.md](./spec.md) | **Contracts**: [resolution](./contracts/request-settings-resolution.md),
[catalog](./contracts/dialect-catalog.md), [UI/trace](./contracts/settings-advanced-ui.md)

## Prerequisites

- pnpm 10 / Node 22 toolchain (repo pins).
- Dev stack reachable: `pnpm dev` (web on http://localhost:5173, server `:4319`).
- At least one provider configured in Settings with a working API key (any kind; an
  OpenAI-compatible router such as OpenRouter exercises the most paths). For
  dialect-specific scenarios, a matching provider/model is needed.

## 1. Automated verification (fast, no keys)

```bash
pnpm check   # svelte-check (constitution gate)
pnpm lint    # ESLint + Prettier (constitution gate)
pnpm test    # Vitest — must include src/lib/ai/dialects.test.ts
```

Expected: all green; `dialects.test.ts` covers layer precedence, router prefixes,
namespace-key regression (case/dot), every catalog entry, omit-empty, extraBody
validation, dropped-keys, `describeDialect` metadata. The old
`providerOptionsForReasoning` describes in `sdk-factory.test.ts` are gone.

Targeted run while iterating:

```bash
pnpm vitest run src/lib/ai/dialects.test.ts
```

## 2. Manual smoke — sampling defaults reach all four call paths (SC-001)

1. Settings → provider → Advanced: set `temperature` = 0.7, `maxOutputTokens` = 2048.
2. Send a chat message → open the chat's Diagnostics panel (Mayon console) → the
   request trace shows `callSettings: {temperature: 0.7, maxOutputTokens: 2048}` and
   the Copy payload includes them; the provider received them (provider-side usage
   dashboards or request inspection confirm).
3. Trigger the other paths: a critic correction (send malformed markdown that forces a
   correction pass), a lab/quiz generation, and a first-message title generation —
   each trace shows the same `callSettings`.
4. Clear both fields → send again → trace shows **no** sampling keys (omit-empty).

## 3. Manual smoke — dialect resolution (SC-002)

Using the Diagnostics panel's rendered `providerOptions` (or its Copy payload):

1. **Router-prefixed GLM**: OpenRouter/Kilo provider, model `z-ai/glm-5.2`, effort On
   → `reasoning_effort` present under the provider namespace (old code: silently absent).
2. **Anthropic**: effort On → `thinking: {type:'adaptive', …}` + `effort`; **no**
   `budget_tokens` anywhere.
3. **Gemini**: model `gemini-2.5-flash` → `thinkingConfig.thinkingBudget`;
   `gemini-3-flash` → `thinkingConfig.thinkingLevel`. Both at the namespace root.
4. **Groq**: effort On → `reasoning_format: 'parsed'`; streamed replies show no raw
   `<think>` tags.
5. **Kimi k3** (any route): effort Off → no thinking parameter sent; model still
   reasons (expected hazard).
6. **Title generation**: request trace for the title call carries effort-off
   resolution (no thinking params on thinking-capable dialects).

## 4. Manual smoke — capability-aware UI (spec AC-4)

1. Settings → Kimi provider with a kimi-k3 model selected → Advanced: sampling inputs
   disabled + "fixed temperature/top_p" hazard shown; preview shows no sampling fields.
2. Switch the model to an unconstrained model → inputs enable, preview updates live.
3. Preview effort selector Off/On/Deep → providerOptions block changes per the
   [catalog](./contracts/dialect-catalog.md) for the selected provider/model.

## 5. Manual smoke — extraBody guardrails (spec AC-5, SC-003/SC-004)

1. Enter `{"top_k": 40}` on an OpenAI-compatible provider → saves; send a message →
   `top_k: 40` visible in the traced `providerOptions` and forwarded in the body.
2. Add a dialect-colliding key (e.g. set `reasoning_format` on a Groq provider) →
   user value wins in the trace.
3. Enter `{"api_key": "sk-..."}` → UI error, not persisted. Same for `{"headers": {…}}`,
   a non-object (`[1,2]`), and an oversized object (> 16 KiB).
4. On an Anthropic provider, enter `{"top_k": 40, "speed": "fast"}` → dropped-keys
   warning lists `top_k`; `speed` applies (visible in trace).

## 6. Regression bar (SC-006)

Configure nothing (fresh provider, no Advanced settings) → requests are identical to
pre-feature behavior except the two documented fixes: namespace key case (reasoning
params now actually consumed on cased-name providers) and Gemini `thinkingConfig`
nesting. Verify via trace on a provider that sent nothing before (e.g. plain OpenAI):
still nothing invented.
