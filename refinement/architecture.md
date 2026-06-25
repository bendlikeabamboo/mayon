# Mayon — Architecture

Single source of truth for the system design. Self-contained — build against this
without needing the refinement conversation. Phased delivery is in `phased-plan.md`.

## 1. Product summary

A personal, **local-first** learning app built around a **branchable chat graph**:

- Chat with an AI about a topic. When a response is too dense, **highlight a span**
  and **branch** a new conversation rooted in that excerpt — the child inherits the
  excerpt plus the full history up to that point.
- Every branch is a node in a **navigable tree** (sidebar tree + breadcrumb path to
  root) with optional **cross-links** between otherwise separate chats.
- From any chat, generate AI **labs** (hands-on guide + progress checklist) and
  **quizzes** (mixed MCQ / flashcard / AI-graded short answer). Both are **leaf
  artifacts** on a chat (they do not branch).
- Personal, single-user, offline. One codebase ships as a web SPA and an
  installable Tauri desktop app.

## 2. Locked decisions

| Area           | Decision                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Form factor    | One codebase: SvelteKit static SPA + Tauri v2 shell                                            |
| Framework      | SvelteKit, Svelte 5 (runes), SPA via `adapter-static`                                          |
| UI             | Tailwind v4 + shadcn-svelte (bits-ui), lucide icons                                            |
| Database       | SQLite — native (Tauri SQL plugin) / WASM+OPFS (browser); drizzle-kit schema                   |
| AI             | Provider-agnostic adapters (OpenAI/Anthropic/Gemini/Ollama), streaming                         |
| Branch context | Excerpt + full history up to the fork point                                                    |
| Branch storage | **Reference-based** — child reads ancestor messages up to a fork-point cutoff (no duplication) |
| Transport      | **Tauri-primary** (Rust/keychain); browser direct-fetch (IndexedDB)                            |
| Labs/Quizzes   | Leaf artifacts generated from a single chat                                                    |
| Toolchain      | pnpm 10, Node 22, Rust 1.95, Tauri v2 (no bun)                                                 |

### Key tradeoffs (recorded so they aren't relitigated)

- **Reference-based branching:** single source of truth, light storage; the accepted
  cost is that a _pre-branch_ edit in a parent propagates to descendants. If
  immutability is ever needed, add a content-hash/version column later (no schema break).
- **Tauri-primary, browser direct-fetch:** desktop keeps keys out of JS and avoids
  CORS entirely; the browser fallback may hit provider CORS limits (e.g. Anthropic
  needs `anthropic-dangerous-direct-browser-access: true`). Surfaced as a clear
  "use the desktop app for this provider" fallback in the UI rather than failing.

## 3. System architecture

One codebase, two runtimes. Application logic is framework-agnostic and identical in
both; only the bottom **drivers** swap via interfaces.

```
┌───────────────────────────────────────────────────────────┐
│  SvelteKit SPA (adapter-static) — Svelte 5 runes           │
│  routes: /chat · /lab · /quiz · /tree · /settings         │
├───────────────────────────────────────────────────────────┤
│  lib/ai      Provider interface · chat stream              │
│              generateLab · generateQuiz · gradeAnswer      │
│              assembleContext (reference-based walk)        │
│  lib/chat    tree ops · branch-from-highlight · crosslinks │
│  lib/db      schema · migrations · repositories           │
├─────────────────────────┬─────────────────────────────────┤
│ Tauri runtime           │ Browser runtime                 │
│ • SQLite (native plugin)│ • SQLite-WASM + OPFS            │
│ • LLM via Rust/reqwest  │ • LLM via streaming fetch       │
│ • key in OS keychain    │ • key in IndexedDB              │
└─────────────────────────┴─────────────────────────────────┘
        StorageDriver interface            ProviderTransport interface
```

Two seams make "both runtimes" cheap:

- **`StorageDriver`** — same SQL schema and repository code over a native or WASM SQLite.
- **`ProviderTransport`** — same provider adapters over a Rust-backed or fetch transport.

## 4. UI stack

- **SvelteKit** in SPA/static mode (no SSR for a local app) — instant loads.
- **Svelte 5 runes** (`$state` / `$derived`) — minimal re-renders, ideal for streaming.
- **Tailwind v4** + **shadcn-svelte** (on **bits-ui**) — accessible, modern components.
- **lucide-svelte** icons; **marked** + **DOMPurify** for markdown; **KaTeX** (math)
  and **shiki** (code) optional.
- **Highlighter component**: Selection/Range API → captures `startChar`/`endChar` on a
  message and surfaces a "Branch from here" action.
- **Streaming render** of assistant tokens; optimistic UI for branching, checklist
  ticks, and quiz answers.

## 5. Database

SQLite everywhere. Schema + migrations via **drizzle-kit**; queries through a typed
**repository layer** over the `StorageDriver`. IDs are text UUIDs; timestamps are
epoch-ms integers.

### 5.1 Tables

**chats** — a node in the conversation tree.
| column | type | notes |
|---|---|---|
| id | TEXT pk | |
| parent_id | TEXT → chats.id | nullable; null = root |
| root_id | TEXT → chats.id | self for root; fast subtree queries |
| branch_point_message_id | TEXT → messages.id | message in _parent_ that this child forked from; null for root |
| title | TEXT | |
| depth | INTEGER | tree depth (display) |
| provider | TEXT | |
| model | TEXT | |
| created_at / updated_at | INTEGER | |

**messages** — content of a single chat.
| column | type | notes |
|---|---|---|
| id | TEXT pk | |
| chat_id | TEXT → chats.id | |
| role | TEXT | system \| user \| assistant |
| content | TEXT | markdown |
| ord | INTEGER | ordering within the chat |
| model | TEXT | nullable |
| tokens | INTEGER | nullable |
| created_at | INTEGER | |

**branch_sources** — records the exact span a branch came from (traceability).
| column | type | notes |
|---|---|---|
| id | TEXT pk | |
| source_message_id | TEXT → messages.id | |
| start_char / end_char | INTEGER | span within the message |
| excerpt | TEXT | snapshot of the highlighted text |
| branch_chat_id | TEXT → chats.id | the child created from this highlight |
| created_at | INTEGER | |

**cross_links** — references between otherwise separate chats.
| column | type | notes |
|---|---|---|
| id | TEXT pk | |
| from_chat_id / to_chat_id | TEXT → chats.id | |
| note | TEXT | |
| created_at | INTEGER | |

**labs** — leaf artifact on a chat.
| column | type | notes |
|---|---|---|
| id | TEXT pk | |
| chat_id | TEXT → chats.id | |
| title | TEXT | |
| content | TEXT | markdown body (intro + steps) |
| checklist | TEXT | JSON `[{id, text, done}]` |
| model | TEXT | |
| created_at / updated_at | INTEGER | |

**quizzes** / **quiz_questions** — leaf artifact, generated from one chat.
| table.column | type | notes |
|---|---|---|
| quizzes.id, chat_id, model, created_at | | |
| quiz_questions.id, quiz_id, ord | | |
| quiz_questions.type | TEXT | mcq \| flashcard \| short |
| quiz_questions.prompt | TEXT | |
| quiz_questions.payload | TEXT | JSON, type-specific (see below) |

`payload` by type:

- `mcq`: `{ options: [...], answerIndex }`
- `flashcard`: `{ front, back }`
- `short`: `{ rubric }`

**quiz_attempts / quiz_answers** — taking and grading a quiz.
| table.column | type | notes |
|---|---|---|
| quiz_attempts.id, quiz_id, score, started_at, finished_at | score nullable until graded | |
| quiz_answers.id, attempt_id, question_id | | |
| quiz_answers.answer | TEXT | |
| quiz_answers.is_correct | INTEGER | nullable |
| quiz_answers.ai_feedback | TEXT | nullable; for short-answer AI grading |
| quiz_answers.graded_at | INTEGER | nullable |

**settings** — key/value store (JSON values).
| column | type | notes |
|---|---|---|
| key | TEXT pk | |
| value | TEXT | JSON |

Provider configs live here. API keys are **not** stored in plaintext: desktop keeps
them in the OS keychain/stronghold (settings holds a handle); browser keeps them in
IndexedDB (settings holds an opaque reference).

### 5.2 Reference-based context assembly (the core)

A child inherits "excerpt + full history up to the fork point" by **reading** ancestor
messages — never copying. `branch_point_message_id` on a node points to a message in
its **parent** and defines how many of the parent's own messages the child sees.

```
assembleContext(target):           # messages to send to the LLM for `target`
  parts = []
  # 1) target's own messages: all of them
  parts += messages(target, ord <= ∞)
  # 2) walk up; for each ancestor, include its own messages up to the cutoff
  #    recorded on the child that links into it
  node = target.parent
  while node != null:
      cutoff = child_of(node).branch_point_message_id    # the node we came from below
      parts += messages(node, ord <= ord(cutoff))        # root: cutoff is null → all
      node = node.parent
  return parts sorted by depth asc, then ord asc
```

- The fork's **excerpt** is injected as a branching seed (e.g. a system note) so the
  child's first turn is anchored to the highlighted text.
- Messages created in a parent _after_ a fork (ord > cutoff) never leak into the child.
- Sidebar tree + breadcrumb derive from `parent_id` / `root_id`; cross-links render as
  distinct reference edges.

## 6. Provider / AI layer

- **`Provider` interface:** `chatStream(messages, opts): AsyncIterable<Token>`, plus
  `generateLab`, `generateQuiz`, `gradeAnswer` (structured output / tool calls).
- **Adapters:** OpenAI, Anthropic, Gemini, Ollama (local) — all configurable in Settings.
- **Two transports** behind the interface:
  - Desktop: Rust `reqwest` via Tauri commands, streamed over event channels.
  - Browser: streaming `fetch`.
- **Key handling:** OS keychain (`keyring`) / Tauri `stronghold` (desktop); IndexedDB (browser).
- **Generation helpers** use provider structured-output to produce typed lab/quiz payloads.
- **Grading:** MCQ/flashcard auto-scored; short-answer AI-graded against the stored rubric.

## 7. Labs & quizzes

- Triggered from a chat; input = that **single** chat's assembled messages.
- **Lab** = structured output `{ title, intro, steps[], checklist[] }`; runner renders
  markdown steps + interactive checklist persisted in `labs`.
- **Quiz** = mixed questions; runner has per-type UX; auto-score + AI grading; attempts
  and answers persisted with score + feedback view.
- Both are **leaf artifacts** — reachable from their parent chat, no branching.

## 8. Performance posture

Local SQLite reads = instant · token streaming = perceived-instant responses · static
SPA = no round-trips · optimistic UI everywhere. Keep WASM DB queries off the UI thread
(web worker) where latency is observable.

## 9. Project structure

```
src/
  lib/
    ai/        provider interface, adapters, transports, generation + grading
    chat/      tree ops, branch-from-highlight, crosslinks, assembleContext
    db/        schema, migrations, StorageDriver + adapters, repositories
    components/ MessageList, Highlighter, Composer, TreeSidebar, Breadcrumb,
               LabRunner, QuizRunner, ProviderSettings
  routes/      /chat /lab /quiz /tree /settings
src-tauri/     Rust: commands, SQL plugin, reqwest transport, key storage
```

## 10. Future seams (out of scope now)

- **Cloud sync:** plug a sync adapter into the `StorageDriver` interface; no app-logic change.
- **Spaced repetition** for flashcards.
- **Runnable lab sandbox** (code execution in-app).

## 11. Non-goals

- Multi-user / accounts / sharing (personal, single-user).
- Server-side hosting of the primary experience (local-first).
- Server-side rendering.
