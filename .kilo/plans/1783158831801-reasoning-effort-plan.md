# Plan — Reasoning Effort Control (3-tier)

Replace the binary Thinking on/off toggle with a **three-tier effort selector**
(`off` / `on` / `deep`) that controls reasoning depth per provider, wired through
the existing `providerOptions` → `streamText` path. Primary target: **Z.AI GLM-5.2**
(Coding Plan endpoint). Scope: **chat turns only** (structured generation unchanged).

## Decisions locked

- **3 tiers:** `off` / `on` / `deep`. Full provider spectrum (7 Z.AI levels) out of
  scope — 3 tiers map cleanly across all providers.
- **Default tier:** `'on'` (preserves current "thinking on" behavior; legacy
  `reasoningEnabled` boolean `true`/`undefined` → `'on'`, `false` → `'off'`).
- **Z.AI `reasoning_effort` handling:** ship it; verify with a manual gate. If it is
  still a no-op upstream, `deep` gracefully degrades to `on` (no error, just no extra
  reasoning) — no functional risk.
- **Scope:** chat turns only. `object-tool.ts` (labs/quizzes/briefs/titles) keeps the
  provider default reasoning (passes no `providerOptions`).
- **Labels:** generic — `Thinking: off / on / deep`.
- **Out of scope:** preserved thinking (`clear_thinking`), interleaved thinking config,
  AI SDK 7 `reasoning` top-level option (we're on SDK 6), reasoning for structured gen.

---

## Per-provider mapping (the core table)

`pKey = providerName?.toLowerCase() ?? 'openai'` (existing convention in
`providerOptionsForReasoning`, sdk-factory.ts:73).

| Provider / condition | `off` | `on` | `deep` |
|----------------------|-------|------|--------|
| openai-compatible + **GLM-5.2** | `{[p]:{thinking:{type:'disabled'}}}` | `{[p]:{thinking:{type:'enabled'},reasoning_effort:'high'}}` | `{[p]:{thinking:{type:'enabled'},reasoning_effort:'max'}}` |
| openai-compatible + **other** | `{[p]:{thinking:{type:'disabled'}}}` | `{[p]:{thinking:{type:'enabled'}}}` | `{[p]:{thinking:{type:'enabled'}}}` |
| anthropic | `{}` | `{anthropic:{thinking:{type:'enabled',budget_tokens:2048}}}` | `{anthropic:{thinking:{type:'enabled',budget_tokens:10000}}}` |
| gemini | `{google:{generationConfig:{thinkingConfig:{thinkingBudget:0}}}}` | `{}` | `{google:{generationConfig:{thinkingConfig:{thinkingBudget:32768}}}}` |
| ollama | `{}` | `{}` | `{}` |

- "on" for non-GLM-5.2 openai-compatible and for anthropic = **byte-for-byte today's
  enabled behavior** (regression-safe). `deep` adds the larger lever only where the
  provider exposes one.
- `reasoning_effort` is a **top-level** Z.AI body param per its OpenAPI spec; it is
  forwarded through the AI SDK under `[pKey]` exactly as the existing `thinking` field
  already is (proven working today). The manual gate verifies forwarding.

---

## Tasks

### 1. Types — `src/lib/ai/types.ts`
- Add `export type ReasoningEffort = 'off' | 'on' | 'deep';` (near line 33).
- Leave the legacy `ReasoningMode` type and `ChatStreamOptions.reasoning` in place
  (the legacy `Provider` interface references them; not worth ripping out).

### 2. `providerOptionsForReasoning` rewrite — `src/lib/ai/sdk-factory.ts:67`
- Change signature to accept `ReasoningEffort` + the model id:
  ```ts
  export function providerOptionsForReasoning(
    kind: ProviderConfig['kind'],
    effort: ReasoningEffort,
    providerName?: string,
    modelId?: string,
  ): Record<string, unknown>
  ```
- Implement the mapping table above.
- Add a GLM-5.2 detection helper (same file):
  ```ts
  function supportsReasoningEffort(modelId?: string): boolean {
    return !!modelId && /^glm-5\.2/i.test(modelId);
  }
  ```
  (handles `glm-5.2` and the `glm-5.2[1m]` 1M-context variant; case-insensitive.)
- For openai-compatible: emit `reasoning_effort` **only** when `supportsReasoningEffort(modelId)`
  is true; otherwise the `on`/`deep` tiers emit just `thinking: {type:'enabled'}` (today's behavior).

### 3. Thread the new type through the active path (rename `reasoning` → `effort`)
- `src/lib/agent/loop.ts`:
  - `AgentTurnDeps` field `reasoning: ReasoningMode` (line 22) → `effort: ReasoningEffort`.
  - call site (line 194) → `providerOptionsForReasoning(deps.config.kind, deps.effort, deps.config.name, deps.config.defaultModel)`.
- `src/lib/stores/chat.svelte.ts`:
  - `send(text, opts?: { effort?: ReasoningEffort; hidden?: boolean })` (line 168).
  - default (line 174): `const effort: ReasoningEffort = opts?.effort ?? 'on';`.
  - pass `effort` into the `runAgentTurn` deps.
- `src/routes/chat/[id]/+page.svelte`:
  - `onSend(text: string, effort: ReasoningEffort)` (line 305) → `chatStore.send(text, { effort })`.
  - update the import (`ReasoningEffort`).

### 4. Composer UI — `src/lib/components/chat/Composer.svelte`
- Replace `thinkingOn: $state(true)` + `reasoning` derived with `effort: $state<ReasoningEffort>('on')`.
- `onSend` prop type: `(text: string, effort: ReasoningEffort) => void | Promise<void>`.
- Click handler cycles: `on → deep → off → on`:
  ```ts
  const NEXT: Record<ReasoningEffort, ReasoningEffort> = { on: 'deep', deep: 'off', off: 'on' };
  async function cycleThinking() {
    if (streaming) return;
    effort = NEXT[effort];
    await repos.settings.set('reasoningEffort', effort);
  }
  ```
- Visual states (one button, lucide `Brain`):
  - `off`: outline variant, tooltip `Thinking: off`.
  - `on`: secondary variant, tooltip `Thinking: on`.
  - `deep`: secondary variant + a small accent indicator (e.g. a `Sparkles`/`Zap` glyph
    or a colored ring) + tooltip `Thinking: deep (more reasoning tokens)`.
- `sendChip`/`send` pass `effort` to `onSend`.
- **Persistence + legacy migration** in `onMount`:
  ```ts
  onMount(async () => {
    const v = await repos.settings.get<string>('reasoningEffort');
    if (v === 'off' || v === 'on' || v === 'deep') { effort = v; return; }
    const legacy = await repos.settings.get<boolean>('reasoningEnabled');
    effort = legacy === false ? 'off' : 'on';
    await repos.settings.set('reasoningEffort', effort);   // write new key
    await repos.settings.delete?.('reasoningEnabled');       // drop legacy (best-effort)
  });
  ```
  (If `settingsRepo.delete` is unavailable, just leave the orphan boolean; the read
  above ignores it once `reasoningEffort` exists.)

### 5. Tests — `src/lib/ai/sdk-factory` test (add/extend)
- `providerOptionsForReasoning` × all 4 kinds × 3 tiers (use the table above as the oracle).
- GLM-5.2-specific: `reasoning_effort` present on `on`/`deep`; **absent** for
  `glm-5.1`, `glm-5-turbo`, `glm-4.7`, and for `glm-5.2[1m]` it **is** present.
- `supportsReasoningEffort` cases (export it, or test via the function).
- `loop.test.ts` (line ~92): the `providerOptionsForReasoning` mock signature is
  unchanged in spirit — update the mock to the new arity if the test asserts call args.
- Composer migration: covered by manual gate (settings round-trip is repo-level already).

### 6. Lint / typecheck
- `pnpm check` and `pnpm lint` must be clean. No `ReasoningMode`/`reasoningEnabled`
  references should remain in the active chat path (grep to confirm).

---

## Manual acceptance gates

1. **Composer cycle:** `on → deep → off → on`; **reload** → tier persists (`reasoningEffort` KV).
2. **Z.AI GLM-5.2 verification (the uncertainty gate):** in a Build/Socratic chat, send the
   same prompt with `on` then `deep`; inspect reasoning token usage (network/`agent_traces`).
   Expect `deep` to use more reasoning tokens (`max` > `high`). **If no difference**, it is
   upstream no-op behavior — `deep` still works as plain enabled reasoning; note in UI tooltip.
3. **Anthropic `deep`:** larger thinking budget visibly produces longer thought process.
4. **Older GLM (5.1/4.7):** `on`/`deep` both stream with reasoning enabled, no `reasoning_effort`
   sent, no error.
5. **Ollama:** cycle does nothing harmful; no request error.
6. **Legacy migration:** a DB with `reasoningEnabled=false` boots into `off`; `true`/missing → `on`.

---

## Risks / edge cases

- **`reasoning_effort` forwarding:** relies on the AI SDK passing arbitrary keys under
  `[pKey]` into the openai-compatible request body. Proven today by `thinking`; gate #2
  confirms it for `reasoning_effort`. If it turns out the SDK strips unknown keys, the
  fallback is to add it via the keychain-fetch shim's body injection — but only if gate #2 fails.
- **Strict gateways 400 on unknown fields:** mitigated by only emitting `reasoning_effort`
  for the known-supported GLM-5.2 model id. Other openai-compatible providers never see it.
- **Token cost:** `deep` on Anthropic (10k budget) / Gemini (32k) increases output tokens;
  the tooltip flags it. No hard budget limit — the user chooses the tier.
- **Regression on "on" tier:** kept byte-for-byte today's enabled behavior per provider.
