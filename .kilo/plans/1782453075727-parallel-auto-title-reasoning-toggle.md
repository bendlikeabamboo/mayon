# Parallel Auto-Title (First-Message) + Reasoning Toggle

## Goal

When the first message is sent in a fresh "New chat", fire a **parallel**
title-generation request — reasoning **off**, 3–10 words, output only the title —
so the title lands **before** the main assistant reply finishes. Also expose a
composer "Thinking on/off" toggle that controls reasoning for normal replies.

> Companion to P2 (`1782392095799-p2-chat-branching-navigation.md`). Touches only
> the AI layer + chat store + composer UI. **No schema change → no migration.**

## Context (verified in code)

- Title gen already exists: `src/lib/ai/generate/generate-title.ts` (`generateTitle`,
  `cleanTitle`, `DEFAULT_TITLE = 'New chat'`). Prompt currently says "At most 6 words".
- It fires **after** the assistant stream completes: `chatStore.send` →
  `void this.autoTitleRoot(provider)` at `src/lib/stores/chat.svelte.ts:136` (inside
  the `if (streamBuffer.length > 0)` block, post-stream).
- **No reasoning control anywhere.** `ChatStreamOptions` = `{ signal?, model? }`
  (`src/lib/ai/types.ts:27`). The openai-compatible adapter always sends
  `{ model, messages, stream: true }` (`src/lib/ai/adapters/openai-compatible.ts:47`).
- Default provider = Z.AI/GLM `glm-5.2` (`registry.ts` PROVIDER_TEMPLATES).
  GLM-5.2 reasons by default (`reasoning_effort` defaults to `max`). Z.AI disables
  thinking via `thinking: { type: "disabled" }` in the request body (confirmed vs
  Z.AI docs `guides/capabilities/thinking` / `glm-4.5` / `chat-completion`).
- Concurrent streams from one provider are safe: the Tauri transport keys each
  stream by a unique `streamId` (`tauri-transport.ts`); the HTTP transport uses
  independent `fetch`es. No shared mutable state on the adapter/provider.
- The chat title is surfaced reactively in `<svelte:head>` via `chatStore.chat?.title`
  (`src/routes/chat/[id]/+page.svelte:130`); the `/chat` list reads from DB on mount.
- Settings KV pattern for overrides: see `readLabPrompt()` in `generate/generate.ts`
  (`repos.settings.get`), and `settingsRepo` in `repositories/settings.ts`.

## Decisions (confirmed)

1. **Title request runs in parallel** with the main assistant stream (not awaited,
   does not block the reply). Fires at send-time on the first message.
2. **Reasoning control** is a reusable `reasoning` flag on `ChatStreamOptions`,
   honored by adapters, used by title-gen (always `disabled`) **and** by a new
   composer "Thinking on/off" toggle for normal replies (persisted as a settings KV
   default).

## Implementation tasks

### 1. `src/lib/ai/types.ts` — add reasoning to options

```ts
export type ReasoningMode = 'auto' | 'enabled' | 'disabled';

export interface ChatStreamOptions {
  signal?: AbortSignal;
  model?: string;
  /** Reasoning/thinking control. `'auto'` (or omitted) = provider default. */
  reasoning?: ReasoningMode;
}
```

### 2. Adapters — map `reasoning` to each wire shape

- **`src/lib/ai/adapters/openai-compatible.ts`** (primary; Z.AI/GLM + OpenAI):
  build the request body conditionally:
  - `'disabled'` → include `thinking: { type: 'disabled' }`
  - `'enabled'`  → include `thinking: { type: 'enabled' }`
  - `'auto'`/absent → omit.

  Document: this is the Z.AI/GLM wire shape. For stock OpenAI it is an unknown
  field (ignored or, on strict gateways, a 400 that only kills the title call —
  best-effort, swallowed). Do **not** gate by `baseUrl`.

- **`src/lib/ai/adapters/anthropic.ts`** (best-effort):
  - `'disabled'`/`'auto'` → omit thinking (Anthropic default = no extended thinking).
  - `'enabled'` → add `thinking: { type: 'enabled', budget_tokens: 2048 }` and
    ensure `max_tokens` > budget. (Secondary provider; minimal.)

- **`src/lib/ai/adapters/gemini.ts`** (best-effort):
  - `'disabled'` → `generationConfig: { thinkingConfig: { thinkingBudget: 0 } }`.
  - `'auto'`/`'enabled'` → omit.

- **`src/lib/ai/adapters/ollama.ts`**: no-op (no reasoning concept).

### 3. `src/lib/ai/generate/generate-title.ts` — prompt + reasoning-off

- Update `TITLE_PROMPT` to request a **3 to 10 word** title (replace "At most 6
  words"). Keep the "ONLY the title / no quotes / no markdown / no trailing
  punctuation / no emoji / plain text" rules.
- In `generateTitle`, forward reasoning off to the stream: call
  `provider.chatStream(turns, { ...opts, reasoning: 'disabled' })` (title is always
  fast; a caller `signal` still propagates).

### 4. `src/lib/stores/chat.svelte.ts` — parallel first-message title

Restructure `send(text)`:

1. Trim/guard as today; persist the user row + `repos.chats.touch(chatId)`; reflect
   in `this.messages`.
2. Resolve the provider **early**: `const [ctx, provider] = await Promise.all([
   assembleContext(chatId), getActiveProvider() ])` (same as now, moved up).
3. **If this is a fresh placeholder root with no prior messages** (i.e.
   `chat.parentId === null && chat.title === DEFAULT_TITLE && this.messages` had no
   prior user/assistant rows before this send) → fire the title request
   concurrently, **without awaiting**:
   `void this.autoTitleRoot(provider, prompt)` — pass the first user message
   directly (do NOT re-walk `assembleContext`).
4. Begin the main assistant stream, passing the composer reasoning:
   `provider.chatStream(ctx, { signal: this.controller.signal, reasoning })`.
   Accept `reasoning` via an options arg (see task 6).
5. Remove the post-stream `void this.autoTitleRoot(provider)` call (now fired
   at send-time). Persist assistant row on finish as today.

Refactor `autoTitleRoot(provider, firstMessage)`:
- Context = `[{ role: 'user', content: firstMessage }]` (no `assembleContext` call).
- Keep `generateTitle(provider, ctx)` (which forwards `reasoning:'disabled'`).
- Keep the `titling` re-entrancy guard and the stale-chat re-check before persist
  (`this.chat?.id === chat.id && this.chat.title === DEFAULT_TITLE`).
- Keep error swallowing (title failures never break the chat).
- Give it its **own** `titleController: AbortController | null`; pass its signal
  into `generateTitle`. Abort it in `load()` (switching chats) and `deleteChat()`
  to avoid stale writes / wasted bandwidth. `stop()` aborts only the main stream.

Add to `send` signature:
```ts
async send(text: string, opts?: { reasoning?: ReasoningMode }): Promise<void>
```
Default `reasoning` to `'auto'` when omitted.

### 5. `src/lib/components/chat/Composer.svelte` — Thinking toggle

- Add local `$state` `reasoning` of type `ReasoningMode`, seeded on mount from the
  `reasoningEnabled` settings KV (boolean; default `true` → `'auto'`). Persist user
  changes back to that KV (`repos.settings.set('reasoningEnabled', boolean)`).
- Add a small toggle button ("Thinking: on/off" pill) next to Send; disabled while
  `streaming`.
- Change `onSend` to carry the mode: `onSend(text, reasoning)`; call
  `void onSend(text, reasoning)`.

### 6. Route wiring — `src/routes/chat/[id]/+page.svelte`

- Update `onSend` to forward reasoning: `async function onSend(text, reasoning) {
  await chatStore.send(text, { reasoning }); }` and pass it to `<Composer {onSend} …>`.
  (The expound auto-send path at `loadAll`/line ~53 calls `chatStore.send(p)` with no
  opts → defaults to `'auto'`.)

### 7. Tests

- **`src/lib/ai/generate/generate-title.test.ts`**: assert `generateTitle` forwards
  `reasoning: 'disabled'` (provider stub captures `chatStream` opts) and that the
  new prompt mentions "3 to 10" words. Keep existing `cleanTitle` cases.
- **`src/lib/ai/adapters/openai-compatible.test.ts`**: assert the request body
  includes `thinking: { type: 'disabled' }` when `reasoning:'disabled'`, omits it
  on `'auto'`, and includes `{ type:'enabled' }` on `'enabled'` (mirror existing
  stub-transport patterns).
- **`src/lib/stores/chat.svelte.test.ts`** — `chatStore auto-title` suite:
  - Existing happy-path ("auto-generates and persists a title") still passes; relax
    the "first exchange" wording since the title now derives from the **first user
    message only**, fired in parallel (the `titleAwareProvider` stub already returns
    the title whenever `messages[0].role === 'system'`, so it works either way).
  - Add: title is requested with `reasoning:'disabled'` and context = `[user msg]`
    only (stub that records the per-call message list + opts).
  - Add: title lands even when the main reply stream is still/blocked (proves
    parallelism — use a provider whose main stream resolves after a tick).
  - Keep: no retitle for a non-placeholder title; no retitle for a child chat.
  - Add: switching chats (`load`) aborts an in-flight title request.
  - Add: `send(text, { reasoning: 'disabled' })` forwards `reasoning` to the **main**
    stream (stub records main-stream opts).

## Failure modes / caveats

- Z.AI may ignore `thinking: { type: 'disabled' }` on some configs (reported in the
  wild). Title-gen is best-effort and swallowed → worst case: no/late title, never a
  broken chat. The param matches the official docs.
- Stock OpenAI / strict OpenAI-compatible gateways may reject the unknown `thinking`
  field (400). Only the title call (and, if the user toggles thinking off, the main
  reply) is affected — never crashes. Do not gate by `baseUrl`.
- Extra tiny call per new chat counts toward rate limits (acceptable).
- No schema/migration changes (title column + settings KV already exist). Run
  `pnpm check`, `pnpm lint`, `pnpm test` after changes; **no** `db:generate`.

## Validation (acceptance gates)

- `pnpm test` green (updated suites above).
- `pnpm check` + `pnpm lint` clean.
- Browser: `pnpm dev` → `/chat` → new chat → send "I want to learn Terraform"; the
  tab title updates to a short title (e.g. "Learn Terraform Basics") **while/shortly
  after** the reply is still streaming; reload → title + provider/key persist.
- Toggle "Thinking off" in the composer → the next reply is faster / no reasoning
  content; reload → the toggle's state persists.
- Child/branched chats are not auto-retitled; chats with a custom title are not
  overwritten.
