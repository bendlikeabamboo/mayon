# LS4 — Depth & Resilience (Learning Structure epic)

Implementation plan for the `LS4` phase of `refinement/learning-structure-phased.md`.
Authoritative design: `refinement/learning-structure.md`. LS1–LS3 are **shipped**
(catalog 3 defaults + `brief.ts` integration; admonition in `render.ts`; Composer
`replies` chips). LS4 rounds out the catalog, wires the strategy through the profile
and the inferred brief, adds the Tier-2 structured gate, and a dev-only density linter.

> No DB schema change in this phase. The strategy rides the existing `chats.brief`
> JSON column; the Tier-2 gate rides the existing `messages.content` text column
> (stored raw, derived + stripped at render). **No `db:generate`, no `bundle:migrations`.**

## Resolved decisions (locked during planning)

1. **Tier 2 included.** Structured ```` ```gate ```` fence, context-aware chips, progress rail.
2. **Gate fence: store raw, derive + strip at render.** The assistant turn is persisted
   with the fence; the rail/chips are re-derived from the last assistant turn on every
   load (statelessness preserved, no schema change); the fence is stripped before render
   using a distinctive ```` ```gate ```` tag so normal ```` ```json ```` code blocks are
   never touched. (Mirrors "lab stores raw".)
3. **Catalog gating adopted.** Gated (chips + Tier-2 gate): `guided-curriculum`,
   `deep-dive`, `quick-orientation`, `workshop`, `tutorial`, `pair-programming`.
   Non-gated (free-form, no chips): `guided-inquiry`, `devils-advocate`, `case-based`,
   `reference-manual`.
4. **`resolveStrategy` validates mode-appropriateness.** It picks the first of
   brief→profile→default whose `modes` includes the resolved `brief.mode`; a cross-mode
   candidate is skipped in favor of that mode's default. Makes locked decision #1
   ("mode is the primary axis") actually true and makes the profile default safe. The
   profile config Structure select is **mode-scoped** + offers a **"(mode default)"**
   option that stores `undefined`.
5. **Dev density linter = console-only**, under `import.meta.env.DEV`. No UI/badge.

## Data flow recap (Tier-2 gate)

```
gated strategy block (prompt)  →  model appends trailing ```gate{...}``` to the turn
  →  chatStore.send persists assistant turn RAW (fence included)          [chat.svelte.ts:192]
  →  route derives gate = extractGateBlock(lastAssistant.content)         [/chat/[id] +page.svelte]
       chips = gate?.options ?? activeStrategy.replies                     (Tier-1 fallback intact)
       rail  = gate?.progress
  →  render strips the fence: stripGateFence(raw) before <Markdown>        [MessageRow, MessageList]
  →  on reload: messages reload raw → derive re-runs → rail/chips restore  (no extra storage)
```

The gate is **never parsed mid-stream** — derivation runs over persisted `messages`
(finished turns only). No `chatStore` change is required for the gate itself.

## Tasks (ordered)

### 1. Catalog + strategy↔mode safety — `src/lib/chat/strategies.ts`

- Add the **7 remaining strategies** to `SCOPE_STRATEGIES`, each with a `block` authored
  to the design §10 density contract (skeleton + word band + floor + format). Gating +
  `replies` per decision #3:
  - `deep-dive` (explainer, gated, `['continue','go deeper']`, floor 450)
  - `quick-orientation` (explainer, gated, `['continue','go deeper']`, floor 120)
  - `reference-manual` (explainer, **non-gated**, terse lookup, no `replies`)
  - `devils-advocate` (socratic, **non-gated**, no `replies`)
  - `case-based` (socratic, **non-gated**, no `replies`)
  - `tutorial` (build, gated, `['next','paste the error']`)
  - `pair-programming` (build, gated, `['next','paste the error']`)
- Append the Tier-2 emission instruction to **every gated** block (including the 3
  existing LS1 ones), e.g.:
  `After the prose, append ONE trailing ```gate fenced block (JSON, no prose after it) with { "nextUnit": "<title>", "options": ["continue","go deeper"], "progress": "Unit 2 / 5" }. The app parses it; it is never shown to the learner.`
  Non-gated blocks get no such instruction.
- **Rewrite `resolveStrategy`** for mode-appropriateness: candidate must satisfy
  `strategy.modes.includes(mode)`; iterate brief→profile→default and return the first
  valid one, else the mode default. (Currently any valid id wins regardless of mode — a
  bug once all 10 are registered.)

### 2. Profile default — `src/lib/chat/profile.ts` + `LearnerProfileConfig.svelte`

- `profile.ts`: in `getLearnerProfile`, validate `scopeStrategy` with `isScopeStrategyId`
  before returning it (mirror the existing level/mode guards). `setLearnerProfile` needs
  no change (already overwrites the whole object). `DEFAULT_PROFILE` stays without a
  `scopeStrategy` (≡ "mode default").
- `LearnerProfileConfig.svelte`: add a **Structure** `<select>` below Mode. Options =
  `strategiesForMode(modeVal)` **plus a leading "(mode default)" option** bound to
  `undefined`. Re-derive options when `modeVal` changes (mirror `BriefCard.svelte:62-68`
  `$effect` that resets an out-of-range pick to the mode default). Seed from the profile
  in `onMount`; include `scopeStrategy` in `save()` (omit key when unset) and `reset()`;
  fold it into the `isDefault` computation.

### 3. Inferred brief — `src/lib/ai/generate/generate-brief.ts`

- Add `scopeStrategy` to `GeneratedBriefSchema` (`.strict()` stays): `.optional()`, enum
  of `SCOPE_STRATEGY_IDS`.
- Extend `GeneratedBrief = Pick<LearningBrief, … | 'scopeStrategy'>`.
- Update `DEFAULT_BRIEF_PROMPT`: add the field line + include it in the example + the
  "no other fields" instruction. Tell the model to pick a strategy consistent with the
  inferred `mode`.
- Update `CORRECTION_INSTRUCTION` to mention the valid strategy ids.

### 4. Tier-2 gate — new `src/lib/ai/generate/generate-gate.ts` + generalize `fence.ts`

- **`fence.ts`**: generalize to `extractFencedBlock(raw, tag?: string)` (tag `undefined`
  ⇒ current `extractFencedJson` behavior: ```` ```json ```` or bare). Refactor
  `extractFencedJson` to delegate. Keep nested-fence/greedy-close semantics.
- **`generate-gate.ts`**:
  - `GateBlock` Zod schema (`.strict()`): `{ nextUnit: string; options: string[]; progress: string }`.
  - `extractGateBlock(raw): GateBlock | null` — `extractFencedBlock(raw, 'gate')` →
    `JSON.parse` → `GateBlockSchema.safeParse`; any failure → `null` (Tier-1 fallback).
  - `stripGateFence(raw): string` — return the text **before** the first ```` ```gate ````
    occurrence (guarantees prefix semantics so expound offsets stay valid against the
    stored raw); unchanged if no gate fence.
- **`MessageRow.svelte`** (assistant branch): compute `const visible = stripGateFence(message.content)`
  and pass `visible` to **both** `<Highlighter raw={visible}>` and `<Markdown raw={visible}>`.
  Prefix semantics keep branch/expound offsets valid (the gate is a trailing suffix).
- **`MessageList.svelte`** (streaming bubble): `<Markdown raw={stripGateFence(streamBuffer)} />`
  so a partial gate fence is hidden mid-stream too.
- **`/chat/[id]/+page.svelte`**:
  - Derive `const gate = $derived(activeStrategy?.gated ? extractGateBlock(lastAssistantRaw) : null)`
    where `lastAssistantRaw` is the last `assistant` message's `content`.
  - `const suggestedReplies = $derived(gate?.options ?? activeStrategy?.replies)` (replaces
    the current `activeStrategy?.replies` line — Tier-1 fallback intact).
  - Render a small **progress rail** (e.g. `gate.progress`) near the composer when present.
  - `Composer.svelte` needs **no change** (same `suggestedReplies?: string[]` contract).

### 5. Dev density linter — new `src/lib/dev/strategy-lint.ts`

- Pure scorer `lintTurn(strategyId: ScopeStrategyId, raw: string): LintResult` where
  `LintResult = { pass: boolean; strategy; words; checks: { name; ok; detail? }[] }`.
  Internally `stripGateFence` first, then evaluate the design §10 contract for that id:
  required skeleton parts present (heuristic regex per strategy), word count ≥ floor
  (gated/unit strategies), callout count ≤ budget. The per-id density contract lives in
  this dev module (keeps the shipped registry lean); source the numbers from §10 + the
  new blocks. Unknown id → `{ pass: true, checks: [] }` (no false noise).
- **`chat.svelte.ts`**: after the assistant turn is appended (`send` step 5), under
  `if (import.meta.env.DEV)` resolve the root strategy (parse root brief via
  `parseBrief`/`strategyForBrief`) and `console.warn`/`console.info` the `LintResult`.
  Best-effort + fully guarded (never throws into the chat path).

## Tests

- **`strategies.test.ts`** — update the LS1 "exactly one per mode" assertions to
  "**≥1 per mode and a defined default**"; add "all 10 ids resolve to exactly one registry
  entry"; "every gated strategy has non-empty `replies`, every non-gated has `undefined`";
  "each mode offers its full expected id set"; **rewrite** the cross-mode
  `resolveStrategy` case (`{scopeStrategy:'workshop', mode:'socratic'}` now →
  `guided-inquiry`, the mode default) and add positive mode-match + brief-wins-over-profile
  within-mode cases.
- **`generate-brief.test.ts`** — schema accepts a valid `scopeStrategy`; rejects an
  unknown id; rejects an extra key (`.strict()` still holds). Add a fenced example that
  includes `scopeStrategy` to the parse happy-path.
- **`generate-gate.test.ts`** (new) — `extractGateBlock` parses a trailing ```` ```gate ````
  into `{nextUnit,options,progress}`; returns `null` on a missing fence, malformed JSON,
  schema mismatch, or unknown tag (```` ```json ```` is ignored); `stripGateFence` returns
  the prose prefix and is a no-op without a fence; a normal ```` ```json ```` content block
  is **not** stripped.
- **`strategy-lint.test.ts`** (new) — a skeleton-complete, above-floor turn scores
  `pass:true`; a turn missing a required part, under the floor, or over the callout
  budget scores `pass:false` with the failing check named; the gate fence is excluded
  from the word count.

## Acceptance

- `pnpm test` / `pnpm check` / `pnpm lint` clean.
- **Manual:** Settings → set a profile default strategy → "New chat" intake pre-selects
  it; override per-brief and both persist independently (snapshot). "Just start chatting"
  → inferred brief proposes a strategy → "Use this" recalibrates. Switch a strategy
  mid-chat → structure changes next turn. A gated turn shows **context-aware chips** +
  a **progress rail**; **reload** restores both (proving store-raw/derive). A non-gated
  chat shows no chips/rail. Switching a chat's mode away from a profile strategy falls
  back to that mode's default (no wrong-mode strategy). Branching mid-curriculum
  inherits the root strategy + gate.

## Failure modes / invariants

- **Cross-mode strategy** (profile or stale brief) → mode default via the new
  `resolveStrategy` validation; never a wrong-mode block.
- **Unknown / malformed gate tag** → `extractGateBlock` returns `null` → Tier-1 static
  `replies` keep working; turn still renders (strip is a no-op).
- **Sanitize unaffected** — the gate fence is stripped **before** `renderMarkdown`, so the
  `rehype-sanitize` allowlist needs no widening for gates; admonition (LS2) behavior is
  unchanged. A stray unstripped ```` ```gate ```` would degrade to a code block (never raw).
- **Expound/branch offsets** — stripping is a **prefix** operation (gate is a trailing
  suffix), so offsets computed against the stripped prose map identically into the stored
  raw; branch excerpts stay valid.
- **Backward compat** — old briefs have no `scopeStrategy` → resolve to the mode default
  (richer than today, never worse); `parseBrief` already total. No migration.
- **Dev linter** — `import.meta.env.DEV`-gated, never throws into the chat path, never
  shipped to users.

## Out of scope (explicit)

- Per-branch strategy overrides (branches inherit the root brief by design).
- Persistent lesson-state / resumable course objects (stateless reconstruction suffices).
- A UI badge for the linter (console-only by decision #5).
- Admonition renderer changes (LS2 is done).
