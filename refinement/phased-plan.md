# Mayon — Phased Build Plan

A personal, local-first learning app built around a **branchable chat graph**,
with AI-generated **labs** and **quizzes**.

This plan is derived from the refined architecture (see conversation / `prompts/start.md`).
Each phase ships a working, demonstrable slice and is a prerequisite for the next.

## Locked architecture (recap)

| Area         | Decision                                                                     |
| ------------ | ---------------------------------------------------------------------------- |
| Form factor  | One codebase: SvelteKit static SPA + Tauri v2 shell                          |
| Framework    | SvelteKit, Svelte 5 (runes), SPA via `adapter-static`                        |
| UI           | Tailwind v4 + shadcn-svelte (bits-ui), lucide icons                          |
| Database     | SQLite — native (Tauri SQL plugin) / WASM+OPFS (browser); drizzle-kit schema |
| AI           | Provider-agnostic adapters (OpenAI/Anthropic/Gemini/Ollama), streaming       |
| Branching    | Reference-based: child reads ancestor messages up to a fork-point cutoff     |
| Transport    | Tauri-primary (Rust/keychain); browser direct-fetch (IndexedDB)              |
| Labs/Quizzes | Leaf artifacts generated from a single chat                                  |
| Toolchain    | pnpm 10, Node 22, Rust 1.95, Tauri v2 (no bun)                               |

---

## Milestones at a glance

| Phase | Name                         | Result                                                  | Size |
| ----- | ---------------------------- | ------------------------------------------------------- | ---- |
| P0    | Foundation & data layer      | App boots; DB initialized in both runtimes; schema live | L    |
| P1    | Provider & AI layer          | Streams an LLM response in both runtimes                | M    |
| P2    | Chat, branching & navigation | Full core loop: chat → highlight → branch → navigate    | L    |
| P3    | Labs                         | Generate + run a lab with persisted checklist           | M    |
| P4    | Quizzes                      | Generate + take a mixed quiz with AI grading            | M    |
| P5    | Tauri shell & packaging      | Installable, offline, secure desktop app                | M    |

> Tauri is introduced as a **thin dev shell in P0** so both runtimes are testable
> from day one; full packaging/distribution is **P5**.

---

## P0 — Foundation & data layer `Size: L`

**Goal:** a running skeleton with the full data model and the storage abstraction
that everything else depends on, working in **both** web and Tauri.

**Scope**

- pnpm workspace / SvelteKit project (SPA, `adapter-static`).
- Tailwind v4 + shadcn-svelte + lucide; base app shell (sidebar + content).
- drizzle-kit schema for **all** tables (chats, messages, branch_sources,
  cross_links, labs, quizzes, quiz_questions, quiz_attempts, quiz_answers, settings).
- Migrations; **storage driver interface** with two adapters:
  - Browser: SQLite-WASM + OPFS.
  - Desktop: Tauri SQL plugin (native SQLite).
- Repository layer (typed queries) over the driver interface.
- Routing skeleton: `/chat`, `/lab`, `/quiz`, `/tree`, `/settings`.
- Thin Tauri v2 dev wrapper (boot only — validates the native driver).
- Settings KV store (provider config, theme, key references).
- Project hygiene: `.gitignore`, lint/format (biome or eslint+prettier),
  `AGENTS.md` (commands for the assistant: build/lint/test/migrate).

**Acceptance**

- `pnpm dev` boots the web build; `pnpm tauri dev` boots the desktop build.
- A seed/test writes and reads a `chats` row through the repository in **both**
  runtimes and persists across restart.
- Migrations run clean on an empty DB in both runtimes.

**Dependencies:** none (entry point).

---

## P1 — Provider & AI layer `Size: M`

**Goal:** send a prompt and stream tokens back, provider-agnostic, in both runtimes.

**Scope**

- `Provider` interface: `chatStream(messages, opts): AsyncIterable<Token>`.
- Adapters: OpenAI, Anthropic, Gemini, Ollama (local). Configurable via Settings.
- Two transports behind the interface:
  - Desktop: Rust `reqwest` via Tauri commands, streamed over event channels.
  - Browser: streaming `fetch`; key in IndexedDB.
- API-key handling: OS keychain (`keyring`) / Tauri `stronghold` on desktop;
  IndexedDB on browser.
- **Context-assembly helper** (reference-based): walk ancestors, collect messages
  with `order <=` the branch-point cutoff — ready for P2.
- Provider config + CORS-fallback UX (e.g. Anthropic direct-browser header;
  "use desktop for this provider" notice where a provider blocks browser CORS).

**Acceptance**

- A `/hello` (or settings) route streams a real response from a configured provider.
- Switching providers in Settings works; API key is stored securely and survives restart.
- The context-assembly helper, given a mock tree, returns the correct ordered message set.

**Dependencies:** P0.

---

## P2 — Chat, branching & navigation `Size: L`

**Goal:** the product's core loop — chat, highlight a dense span, branch, navigate.

**Scope**

- Message list with streaming render; composer; markdown (marked + DOMPurify),
  optional KaTeX/Shiki.
- **Highlighter component**: capture selection → store `startChar`/`endChar` +
  excerpt on the source message; show a "Branch from here" affordance.
- Branch action creates a `chats` row (`parentId`, `rootId`,
  `branchPointMessageId`) + a `branch_sources` row; wires context assembly so the
  child sees **excerpt + full history up to the fork point**.
- Tree sidebar (built from `parentId`/`rootId`) + breadcrumb path to root.
- Cross-link creation (references between otherwise separate chats).
- Optimistic UI for branching and navigation; virtualization if chats grow large.

**Acceptance**

- From an assistant message, highlight text and branch: the child conversation
  inherits the excerpt + history, and the highlight is traceable back to its parent.
- Tree shows parent/child; breadcrumb navigates to any ancestor; cross-links render
  as distinct reference edges.

**Dependencies:** P0, P1.

---

## P3 — Labs `Size: M`

**Goal:** generate a hands-on, textbook-style lab from any chat and run it.

**Scope**

- Lab generator: structured-output call producing `{ title, intro, steps[],
checklist[] }` from the **single** chat's messages.
- Lab runner UI: render markdown steps + interactive checklist.
- Persist lab + checklist state to the `labs` table (leaf artifact on the chat).
- "Generate lab" action on a chat; user-editable prompt for the lab agent.

**Acceptance**

- One click generates a lab grounded in the current chat.
- Checklist ticks persist across reloads; lab is reachable from its parent chat.

**Dependencies:** P2 (chat + provider layer).

---

## P4 — Quizzes `Size: M`

**Goal:** generate a mixed quiz, take it, and get graded.

**Scope**

- Quiz generator: mixed output — MCQ (options + answer), flashcards (front/back),
  short-answer (prompt + rubric) — from the single chat.
- Quiz runner: per-type UX (select/flip/write).
- Grading: MCQ/flashcard auto-scored; short-answer **AI-graded** via the rubric.
- Persist `quizzes`, `quiz_questions`, `quiz_attempts`, `quiz_answers`.
- Score + per-question feedback view; attempt history.

**Acceptance**

- Generate quiz → take it → MCQ scores instantly, short answers get AI feedback,
  attempt + score saved and reviewable.

**Dependencies:** P2 (chat + provider layer). Independent of P3 (can reorder).

---

## P5 — Tauri shell & packaging `Size: M`

**Goal:** ship an installable, offline, secure desktop app.

**Scope**

- Finalize Tauri v2 wrapper (matured beyond the P0 dev shell).
- Harden native SQLite, keychain/stronghold key storage, and Rust LLM transport.
- Auto-update config; app icon/metadata; windowing.
- Build/distribute (`pnpm tauri build`); minimal CI (build + lint on push).

**Acceptance**

- Installable build runs fully offline with secure key storage and streaming.

**Dependencies:** all prior phases.

---

## Cross-cutting concerns

- **Testing:** unit tests for context assembly, repository, and provider adapters
  (Vitest); a few component tests for the highlighter and quiz grading flow.
- **Error handling:** provider/transport failures surface actionable messages
  (e.g. CORS fallback, missing key, rate limit) — never silent.
- **Observability:** local-only structured logging; no telemetry (personal app).
- **Performance budget:** instant local reads, streaming tokens, optimistic UI,
  no blocking work on the UI thread. Keep WASM DB queries off the main thread (web worker) where it matters.
- **Future seam:** sync layer — the storage driver interface is the place a future
  cloud-sync adapter plugs in without touching app logic.

## Recommended sequencing

`P0 → P1 → P2 → (P3 ‖ P4) → P5`

P3 and P4 are independent and can be built in either order or in parallel.
P0 is the long pole; getting the storage abstraction right here pays off in every later phase.
