# Research 001 — CopilotKit fit assessment for Mayon

**Date:** 2026-08-21
**Question:** Could CopilotKit (https://github.com/CopilotKit/CopilotKit) improve Mayon — especially its UI components and overall maintainability (less code for us to own)?

---

## TL;DR

**Not a fit — today or likely ever for this architecture.** Three blockers, in order of severity:

1. **No Svelte support.** CopilotKit is React-first (GA); Angular/Vue/RN adapters exist; Svelte is a single **unmerged community PR** with known streaming/autoscroll bugs and no theming. Adopting it would mean React-izing the SPA or waiting on an immature package.
2. **Architecture mismatch.** CopilotKit is a _full-stack agent framework_ (its own runtime server + AG-UI protocol + thread model), not a component library. It would **add** a backend layer between our UI and our agent loop — the opposite of "less to maintain."
3. **Data-model mismatch.** CopilotKit's world is **linear threads** (`threadId` + flat message list). Mayon's core is a **branchable chat graph** persisted in Postgres behind our `StorageDriver` seam. Its prebuilt components, thread drawer, and persistence runners cannot represent our tree without us writing a custom `AgentRunner` bridge — i.e., keeping all current persistence code **plus** an adapter.

The UI components we'd theoretically offload (message list, composer, markdown rendering) are precisely where our product differentiators live (expound source-maps, KaTeX/Mermaid pipeline, branch navigation). Verdict: keep the minimal-framework approach. Re-evaluate only if the Svelte SDK merges and matures.

---

## What CopilotKit actually is

Not "chat UI components" — a three-layer, opinionated framework for _agent-native apps_:

```
Frontend SDK (React hooks/components)          ← what they advertise
        │  HTTP POST /run (SSE)
CopilotRuntime (Node backend orchestrator)     ← you must host this
        │  AG-UI protocol (SSE events)
Agent (your logic, AG-UI endpoint)             ← your code, re-wrapped
```

- **Frontend:** `@copilotkit/react-core` (provider + ~16 hooks), `@copilotkit/react-ui` (prebuilt chat). Vue (`@copilotkit/vue`), Angular, React Native adapters exist with _partial_ parity (their own issue tracker documents feature gaps per platform).
- **Runtime:** a `CopilotRuntime` you host (Express/Hono/Next/etc.). Owns agent execution, SSE event piping, thread persistence via pluggable **`AgentRunner`s**.
- **Protocol:** AG-UI (SSE-based agent↔UI event protocol; genuinely well-adopted — the one piece with independent ecosystem value).
- **License:** MIT core. The polished persistence/memory/analytics tier ("Enterprise Intelligence", Rich Threads, insights) is a **commercial platform** (cloud, or self-hosted "with CopilotKit Engineering" — sales motion).

### The UI component catalog (the part we asked about)

| Component                                 | What it does                                             |
| ----------------------------------------- | -------------------------------------------------------- |
| `<CopilotChat />`                         | Full chat surface (transcript + input) wired to an agent |
| `<CopilotSidebar />` / `<CopilotPopup />` | Same thing in a side panel / floating bubble             |
| `<CopilotThreadsDrawer />`                | Thread list: rename, archive, delete, switch             |
| `<CopilotChatView />`                     | Scrollable transcript + input layout                     |
| `<CopilotChatMessageView />`              | Message list renderer                                    |
| `<CopilotChatAssistantMessage />`         | Markdown + tool-call chips + copy/regenerate toolbar     |
| `<CopilotChatUserMessage />`              | User message **with branch navigation**                  |
| `<CopilotChatInput />`                    | Composer with attachments, suggestions                   |

Slot-based (v2) — you can override each region with your own sub-components. Solid catalog **for a React app with linear conversations**. There is also a Lit-based `@copilotkit/web-components` package (framework-agnostic), but it currently ships **only** the threads drawer.

Key hooks: `useAgent`, `useFrontendTool` (agent calls browser functions), `useRenderTool`/`useComponent` (generative UI — agent renders your component inline), `useHumanInTheLoop`, `useInterrupt`, `useSuggestions`, `useThreads`.

---

## The three blockers in detail

### 1. Svelte is not supported

- Platform table (README, docs): React/Next **GA**; Angular ✅; Vue ✅ ("quickstart coming soon"); React Native ✅; **no Svelte row at all**.
- The only Svelte surface is **PR #5905 "feat(svelte): add initial Svelte SDK support"** — still **OPEN**, unmerged, a first-time community contribution.
- The maintainer review of that PR (worth reading) lists real bugs found live: streaming `STATE_DELTA` doesn't re-render (Svelte 5 `$state` identity bailout), autoscroll broken (confirmed live, stops ~289px short), stale-input desync, non-reactive `agentId`, a tool-call race, a thread-clone memory leak. Test coverage: **1 test file for the core wrapper; 0 tests across 11 hooks and 16 components.**
- Parity gaps called out in the PR itself: no theming/CSS exports, no CoAgent state rendering, no generative UI (A2UI), no memories, no threads drawer.
- Even CopilotKit's _supported_ non-React platforms have open parity complaints (e.g. RN lacks A2UI components; Vue has APIs React lacks and vice versa). Non-React is clearly second-class.

**Consequence for us:** adopting today = running Mayon's SPA on an unmerged, unthemed, untested package — or rewriting the frontend in React.

### 2. It's a framework, not a component drop-in

Adopting CopilotKit means:

- Hosting **`CopilotRuntime`** in our server container.
- Re-shaping `src/lib/agent/loop.ts` (our `streamText` + MCP tools loop) into an **AG-UI agent endpoint**.
- Replacing our streaming path (Vercel AI SDK → browser store) with: UI → CopilotRuntime → AG-UI → agent. One more hop, one more protocol, one more dependency tree.

Notably, CopilotKit's runtime **already wraps the Vercel AI SDK internally** (its service adapters produce AI SDK `LanguageModel`s). We use the AI SDK directly today. So CopilotKit would not remove our LLM code — it would sit _in front of_ it.

### 3. Threads ≠ our chat graph

CopilotKit's persistence model:

| Runner                                   | Reality                                                     |
| ---------------------------------------- | ----------------------------------------------------------- |
| `InMemoryAgentRunner` (default)          | Thread history in RAM; lost on restart                      |
| `SqliteAgentRunner`                      | File-backed SQLite; single-instance only                    |
| `IntelligenceAgentRunner`                | The commercial cloud platform (or sales-assisted self-host) |
| Custom subclass of `InMemoryAgentRunner` | DIY — the documented answer for "use your own DB"           |

- There is **no first-party Postgres runner.**
- Threads are **flat**: mint a UUID `threadId`, stream messages under it, replay on reconnect. Rename/archive/delete/paginate — a linear-conversation UX.
- Mayon persists a **tree** (`src/lib/chat/tree.ts`, `projection.ts`, `entries.ts`) in Postgres via drizzle, queried from the browser through the `RemotePgDriver` seam, with full-text `search_vec`, briefs, expound rows, cross-links. A `threadId` cannot express branch points, active-path projection, or sibling navigation.
- Mapping would require a custom `AgentRunner` that hydrates/replays from our Postgres graph — meaning we keep 100% of our storage code and add an AG-UI translation layer on top.

---

## What we'd gain vs. what we'd give up

### Hypothetically offloaded (if React + linear threads)

- Message list + streaming render state (~`MessageList.svelte`, `MessageRow`)
- Composer basics (`Composer.svelte`)
- Copy/regenerate toolbar, loading/typing indicators, suggestions
- Thread drawer UI (we don't want linear threads anyway)

### We'd keep regardless (no net reduction)

- Branchable chat graph + Postgres persistence (+ new runner bridge)
- Markdown pipeline: KaTeX, Mermaid, sanitize, admonitions, focusables
- **Expound system** (`sourcemap.ts`, `selection.ts`, `wrap-range.ts`, `Highlighter`) — depends on our exact DOM/render structure; their assistant-message component renders _their_ markdown
- MCP client (25+ modules: transports, elicitation, sampling, trust, lifecycle) — CopilotKit's MCP story (MCP Apps) is about _rendering remote UI_, not our browser→server stdio relay
- BYO-key management + LLM CORS proxy (their model assumes server-held keys / their cloud)
- Provider config, personas, quizzes, briefs, profiles

### New costs

- React-in-Svelte (or waiting on an immature Svelte SDK)
- CopilotRuntime + AG-UI protocol in the server container
- A custom AgentRunner adapter
- Dependency weight: react-ui alone pulls react-markdown, syntax-highlighter, headlessui, rehype/remark stack (duplicating ours)
- Known upstream UI bugs reported by users even on React: virtual-scroll jank, stale state, cursor issues — bug reports we can't fix at our layer
- Gravitational pull toward the commercial tier for anything durable/multi-instance

---

## What _is_ genuinely interesting (steal-worthy ideas, not dependencies)

1. **`<CopilotChatUserMessage />` branch navigation** — validates that branching chat UX is a real pattern; ours is strictly more capable (tree vs. prev/next).
2. **`useRenderTool` / `useComponent` (generative UI)** — agent emits a typed tool call that renders a _live Svelte component_ inline. We already have the raw machinery for this (tool results in `result-shape.ts`, quiz rendering); making a tool call render an interactive component is a nice future pattern and needs **no framework** — just a component registry keyed by tool name.
3. **AG-UI as a protocol** — if Mayon ever grows non-browser surfaces (CLI, editor plugin), AG-UI is the emerging standard for agent↔UI events (adopted by LangChain/Google/AWS/Microsoft per CopilotKit's claims; MIT). Note for the future, not a reason to adopt the framework.
4. **Human-in-the-loop / interrupt hooks** — relevant to MCP elicitation/sampling approval flows we hand-rolled (`ElicitationDialog`, `SamplingApprovalCard`); their API shape is a decent design reference.

---

## Verdict

| Criterion                                 | Score | Notes                                                                     |
| ----------------------------------------- | ----- | ------------------------------------------------------------------------- |
| Svelte 5 compatibility                    | 0/5   | Unmerged community PR, buggy, unthemed, untested                          |
| UI component usefulness to us             | 1/5   | Linear-thread assumptions; our differentiators live in the replaced parts |
| Maintained-by-others surface gained       | 1/5   | Runtime + protocol + runner bridge = net **more** code/ops for us         |
| Persistence fit (Postgres, local-first)   | 1/5   | No PG runner; custom subclass = we keep everything + adapter              |
| Architecture fit (SPA, no server lock-in) | 1/5   | Requires hosting CopilotRuntime; commercial tier gravity                  |
| Ideas worth borrowing                     | 4/5   | Generative-UI tool pattern, HITL API shape, AG-UI as future protocol      |

**Recommendation: do not adopt.** Mayon's "least framework possible" stance is the right one here — our crown jewels (branchable graph, expound source-maps, MCP client, local-first Postgres seam) are all things CopilotKit either cannot represent or would force us to re-implement as adapters. The framework solves problems we already solved, and charges us in complexity for the parts we'd "offload."

**If revisited later (checklist):** Svelte SDK merged + 6 months of releases + theming + tests; first-party Postgres or pluggable storage runner; tree/branching conversation support; headless UI usable without CopilotRuntime. Until all four hold, re-evaluation isn't worth the time.

---

## Sources

- Repo/README (platform table): https://github.com/CopilotKit/CopilotKit
- Svelte PR + maintainer review: https://github.com/CopilotKit/CopilotKit/pull/5905 (OPEN, unmerged as of 2026-08-21)
- SDK reference (component/hook catalog): https://docs.copilotkit.ai/reference
- AgentRunner & persistence tiers: https://docs.copilotkit.ai/backend/agent-runner
- Threads lifecycle (linear `threadId` model): https://docs.copilotkit.ai/threads-lifecycle
- Rich Threads / Enterprise Intelligence (commercial tier, self-host = sales): https://docs.copilotkit.ai/langgraph-typescript/threads
- Web components (Lit) package: `packages/web-components/README.md` in the repo
- `@copilotkit/react-ui` dependency tree: https://www.npmjs.com/package/@copilotkit/react-ui
- Community/ex-competitor context (AI SDK is intentionally headless; CopilotKit UI bugs are its debt): zread issue-tracker analysis of CopilotKit/CopilotKit
