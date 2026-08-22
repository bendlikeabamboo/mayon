# Research 002 — Svelte AI-chat UI components: the broader landscape

**Date:** 2026-08-21
**Question:** Beyond CopilotKit, do off-the-shelf Svelte (or framework-agnostic) AI-chat UI components exist that could reduce what we hand-maintain in Mayon?

---

## TL;DR

The Svelte AI-UI ecosystem is real but young, and it splits into four families:

1. **Svelte AI Elements** (shadcn-svelte registry) — the standout. Same stack as us (Svelte 5 + bits-ui + Tailwind + lucide), MIT, 308★, active, and consumed by **copying components into our repo** (shadcn model) — no new runtime dependency to maintain. Cherry-pickable.
2. **Framework-agnostic web components** (`deep-chat`, `Loquix`) — mature/apolished but all-or-nothing widgets in Shadow DOM. Shadow DOM is effectively incompatible with our expound DOM-walking (`selection.ts`), branch tree UI, and custom markdown pipeline.
3. **First-party `@ai-sdk/svelte`** — the official Vercel AI SDK Svelte bindings (Apache-2.0, huge adoption). Its `Chat` class is linear-chat state; we already built a superior tree-shaped equivalent on the same `ai` core. Useful as reference, not replacement.
4. **Tiny one-maintainer kits** (SvelteChatKit, sv-prompt-kit, svelte-ai-chat) — too immature to bet on.

**Recommendation:** treat **Svelte AI Elements as a component donor**, not a framework. Cherry-pick 2–4 commodity blocks (tool `confirmation`, `model-selector`, `suggestion`, maybe `task`/`tool` panels) where we currently maintain undifferentiated UI. Skip everything that touches the message-render path (expound/markdown/tree) — that's our product. Re-check Loquix in a year if it grows.

---

## Landscape at a glance

| Option                                                            | Model                                      | License    | Activity (2026-08)                 | Svelte 5                 | Fit                    |
| ----------------------------------------------------------------- | ------------------------------------------ | ---------- | ---------------------------------- | ------------------------ | ---------------------- |
| [Svelte AI Elements](https://github.com/SikandarJODD/ai-elements) | shadcn registry (copy-paste, code you own) | MIT        | 308★, pushed 2026-06               | ✅ runes                 | **High (selective)**   |
| [deep-chat](https://github.com/OvidijusParsiunas/deep-chat)       | Web component widget, npm dep              | MIT        | 3.7k★, v2.5.0 2026-07              | ✅ via custom element    | Low                    |
| [Loquix](https://github.com/loquix-dev/loquix)                    | Web components (Lit 3), npm dep            | MIT        | 40★, pushed 2026-08                | ✅ (any framework)       | Low–Medium             |
| [`@ai-sdk/svelte`](https://www.npmjs.com/package/@ai-sdk/svelte)  | npm state library (`Chat` class)           | Apache-2.0 | 5.0.73, ~418k wk downloads         | ✅ (peer `svelte ^5.31`) | Reference only         |
| [SvelteChatKit](https://github.com/kristofers322/SvelteChatKit)   | npm component kit                          | MIT        | 11★, created 2026-07, 1 maintainer | ✅                       | Too immature           |
| [sv-prompt-kit](https://github.com/SikandarJODD/sv-prompt-kit)    | shadcn registry, lightweight               | MIT        | 10★ (same author as AI Elements)   | ✅                       | Subset of above        |
| [llum](https://github.com/zakkor/llum)                            | Full chat **app**, not a library           | MIT        | 220★, stale since 2025-05          | n/a                      | None                   |
| markstream (Svelte flavor)                                        | Streaming-markdown renderer                | —          | 2.9k★ multi-repo                   | ✅                       | Conflicts with expound |

(Context: CopilotKit's Svelte SDK is still unmerged — see `research/001-copilot-kit.md`. Vercel's official AI Elements is React-only; the Svelte port below is community.)

---

## The four families, assessed

### 1. Svelte AI Elements — the one worth using

**What:** a community port of Vercel's React AI Elements, built **on top of shadcn-svelte**. Not an npm dependency: a **registry** — you `npx shadcn-svelte add`-style copy components into `src/lib/components/`, and from then on it's our code (no upgrades, no API drift, no breaking changes; also no upstream bugfixes).

**Why it fits us specifically:** our `ui/` folder is already shadcn-svelte styled on bits-ui, and we already depend on `@lucide/svelte` + `bits-ui` — the registry's core deps. Most blocks pull in **zero new runtime dependencies**. (Some pull `runed`, `mode-watcher`, `@shikijs/themes`, or `streamdown-svelte` — we'd avoid or vet those.)

**Catalog (24 blocks, from the live registry):**

| Block                                                                                                           | What it gives                                                 | Mayon relevance                                                 |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------- |
| `confirmation`                                                                                                  | Tool-approval card (request/response states, action handling) | **Direct** — MCP elicitation / sampling approval UI             |
| `model-selector`                                                                                                | Searchable model-picker dialog (command + dialog)             | **Direct** — our `ModelSelect.svelte`                           |
| `suggestion`                                                                                                    | Prompt-suggestion button set                                  | Direct — starter prompts                                        |
| `tool`                                                                                                          | Collapsible tool-call block (params + result)                 | Direct — tool-call rows                                         |
| `task` / `checkpoint` / `plan`                                                                                  | Agent task panels, workflow checkpoints, plan cards           | Future (agent UX)                                               |
| `chain-of-thought` / `reasoning`                                                                                | Collapsible reasoning w/ streaming duration                   | We have `Reasoning.svelte`; compare                             |
| `context`                                                                                                       | Token/cost/model usage hover-card                             | Nice-to-have                                                    |
| `sources` / `inline-citation`                                                                                   | Citation lists, hover-card source links                       | Overlaps cross-links; different model                           |
| `conversation`                                                                                                  | Sticky-bottom scroll container + scroll-to-bottom             | We have `scroll-bus.ts`; compare                                |
| `prompt-input`                                                                                                  | Composer w/ attachments + action menus                        | Partial — ours is deeply tied to personas/modes                 |
| `message`                                                                                                       | Message system w/ **branching**, attachments, actions         | ⚠️ linear branching ≠ our tree; renders via `streamdown-svelte` |
| `response` / `code` / `copy-button` / `loader` / `shimmer` / `image` / `web-preview` / `queue` / `open-in-chat` | Assorted primitives                                           | Cherry-pick                                                     |

**Caveats:** single primary maintainer (SikandarJODD, also active in shadcn-svelte community); 308★ is promising, not proven. Because it's copy-paste, "maintenance" means we own what we take — the win is starting from tested, accessible code instead of blank files, with zero lock-in.

### 2. Framework-agnostic web components — mature but wrong shape

- **deep-chat** (3.7k★, MIT, actively released): one-line embeddable chat widget; direct connections to 20+ AI APIs, webcam/mic, TTS/STT. Works in Svelte/SvelteKit (SvelteKit needs `onMount` import). But it is a **closed, all-in-one widget** — message rendering, history, input all inside. Customizing it to a branchable Postgres-backed tree graph with expound highlights is not what its extension points are for.
- **Loquix** (40★, MIT, new but well-engineered: Lit 3, strict TS, CI+codecov): 50+ composable web components (`loquix-message-list`, `-composer`, `-search-dialog`, …), themed via CSS custom properties, framework-agnostic. The composition model is _much_ better than deep-chat's monolith. The blocker for us is **Shadow DOM encapsulation**: our expound system walks rendered DOM text (`src/lib/chat/selection.ts`, `wrap-range.ts`) and wraps ranges in our own pipeline's DOM (`Markdown.svelte`) — shadow boundaries + foreign internals would break the source-map alignment that AGENTS.md marks as a hard invariant. Fine for greenfield apps; wrong for ours.

**Rule of thumb:** Shadow-DOM components are fine _around_ our chat (dialogs, pickers) but cannot sit _inside_ the message-render path.

### 3. `@ai-sdk/svelte` — first-party but superseded for us

Official Vercel bindings: `Chat`, `Completion`, `StructuredObject` classes (Svelte 5, Apache-2.0, 418k weekly downloads). `Chat` manages a **flat `messages[]`** with streaming status — the same linear-thread assumption that disqualified CopilotKit. We already use the `ai` core directly (`streamText` in `src/lib/agent/loop.ts`) with our own tree-projection store, which handles branching, persistence, briefs, and expound. Adopting `Chat` would mean rewriting our store into a subset of itself. **Keep as reference** for their streaming-state edge-case handling (e.g. abort/resume semantics).

### 4. Small single-maintainer kits

- **SvelteChatKit** (11★, July 2026): provider-abstraction chat kit (OpenAI/Ollama/Dify/n8n/custom SSE). Clean design (20-line `ChatProvider` interface), but one maintainer, one month old, localStorage persistence, linear history. Not foundation material.
- **sv-prompt-kit** (10★): the lightweight sibling of AI Elements by the same author — 8 blocks; subsumed by it.
- **svelte-ai-chat** (12★): a copy-paste glassmorphism widget, single `Chat` component — too shallow for us.

---

## What we could actually take (concrete proposal)

Adopt nothing wholesale. Instead, evaluate these AI Elements blocks as **donor code** into our existing component conventions:

1. **`confirmation`** → replace/augment `ElicitationDialog.svelte` + `SamplingApprovalCard.svelte` chrome (approval states, request/response rendering, action buttons).
2. **`model-selector`** → upgrade `ModelSelect.svelte` to a searchable command-dialog (we already have `command`-capable bits-ui).
3. **`tool` + `task`** → richer tool-call presentation than `ToolSources.svelte` (20 lines today) when we expose agent tool traces more prominently.
4. **`suggestion`** → starter-prompt chips if we add onboarding prompts.

All four are leaf UI (no data model, no render pipeline), so they carry **zero risk to the expound/tree/markdown invariants**. Estimated new runtime deps: none (or just `runed`, itself a tiny runes utility from the Svelte ecosystem).

**Do not take:** `message`, `response`, `conversation`, `prompt-input` — they overlap the render path our product is built on (tree projection, expound source-maps, KaTeX/Mermaid, personas).

---

## Verdict

| Criterion                | Svelte AI Elements            | deep-chat  | Loquix        | @ai-sdk/svelte | Small kits |
| ------------------------ | ----------------------------- | ---------- | ------------- | -------------- | ---------- |
| Svelte 5 / our stack     | ✅ native                     | ✅ wrapper | ✅ any        | ✅ native      | ✅         |
| Zero new lock-in         | ✅ copy-paste                 | ❌ dep     | ❌ dep        | ❌ dep         | ❌/✅      |
| Fits tree/expound model  | partial (leaf blocks yes)     | ❌         | ❌ shadow DOM | ❌ linear      | ❌         |
| Maturity/maintenance     | Medium (1 maintainer, active) | High       | Low (new)     | High (Vercel)  | Low        |
| Net maintainability gain | **Yes, selective**            | No         | No            | No             | No         |

**Bottom line:** the ecosystem finally has a good Svelte-native donor — AI Elements — and its shadcn copy-paste model is the only "adoption" that genuinely _reduces_ maintained-by-us code without adding a dependency or touching our invariants. Web-component kits solve a problem we don't have (embedding a working chat fast) at the cost of the problems we've already solved better.

---

## Sources

- Svelte AI Elements: repo https://github.com/SikandarJODD/ai-elements · docs https://svelte-ai-elements.vercel.app · live registry JSON `https://svelte-ai-elements.vercel.app/r/index.json`
- deep-chat: https://github.com/OvidijusParsiunas/deep-chat · https://deepchat.dev · npm `deep-chat@2.5.0` (MIT)
- Loquix: https://github.com/loquix-dev/loquix · https://loquix.dev (MIT, Lit 3)
- @ai-sdk/svelte: npm 5.0.73 (Apache-2.0) · https://ai-sdk.dev/docs/getting-started/svelte
- SvelteChatKit: https://github.com/kristofers322/SvelteChatKit · sv-prompt-kit: https://github.com/SikandarJODD/sv-prompt-kit
- streamdown-svelte (AI Elements dep): npm 3.0.6, Apache-2.0 — noted, unused by us
- Prior finding: CopilotKit Svelte SDK unmerged — `research/001-copilot-kit.md`
