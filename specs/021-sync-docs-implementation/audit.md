# Audit Tracker — Sync Docs With Current Implementation

Seeded from data-model.md. Statuses per data-model.md state machines.
Page status: `unverified` → `drifted`|`current` → `corrected` → `verified`.
Discrepancy status: `open` → `doc-fixed` | `defect-recorded` | `wontfix (justification)`.

## Documentation Pages

| Path | Audience | Priority | Status | Verified via |
|---|---|---|---|---|
| docs/tutorials/getting-started.qmd | beginner | P1 | verified | Claims re-verified against code (DbStatus.svelte:15,47-49; BootGate.svelte:16,48-56; src/routes/+page.svelte:220-245,306-364; starters.ts:22-27; sections.ts:14; LearnerProfileConfig.svelte:100; chat/+page.svelte:50-60,108) and running dev stack (`/` serves the dashboard shell, HTTP 200); `quarto render docs` exit 0 |
| docs/tutorials/chat-and-branching.qmd | beginner | P1 | verified | Claims re-verified against code (Highlighter.svelte:496-501,177-186; ContextMenu.svelte:86; ProviderConfig.svelte:516; ChatRail.svelte:44,69,90,183; CrossLinks.svelte:18-19,29,55-60,104-106; Composer.svelte:88-89,145-159,197-212,403,612-652; images.ts:20; strip/pref.ts; client.ts:36-41; context.ts:71,74-79; routes/tree/+page.svelte) and running dev stack (`/`, `/chat`, `/tree`, `/settings` HTTP 200); `quarto render docs` exit 0 |
| docs/how-to/providers.qmd | everyday | P2 | verified | Walkthrough PASS after one fix ("gear icon in the header" → "in the sidebar" — Settings lives in the app nav, AppShell.svelte:33, Sidebar.svelte:25). Claims verified against code (registry.ts:54-269 — 18 templates, order, labels, base URLs, key requirements, discoverable flags; ProviderConfig.svelte:450, 516, 743-769, 778, 793 — Add provider / Set active / Reconnect / Connect GitHub account / key field labels / Save key; model-select.svelte:73-76 — searchable picker; keystore/browser.ts:32-53 — IndexedDB; errors.ts:28-29, 73-79 — CORS notice; server/src/llm-proxy.ts:14 — same-origin proxy; server/src/copilot-auth.ts:149-291 — server-side device flow; schema.ts:39-40 — chats keep their provider/model) and running dev stack (`/`, `/settings` HTTP 200; `/api/health` advertises `llm-proxy`) |
| docs/how-to/labs.qmd | everyday | P2 | verified | Claims verified against code (chat/[id]/+page.svelte:809-810 and ChatRail.svelte:123 — "Generate lab"; ChatRail.svelte:127-142 — labs listed in the chat sidebar; LabRunner.svelte:30-31, 60-73, 81 — back-to-chat link, "{done}/{total} done" counter, crossed-off checked items, toggle; labs.svelte.ts:182-203 — optimistic toggle with immediate persist; schema.ts:142-156 — labs table, checklist JSON [{id,text,done}]; generate/lab.ts:115-124 and lab.test.ts:185-194 — fresh checklist items always `done: false`; GenerationPromptConfig.svelte:61-99 + LabPromptConfig.svelte:14 + sections.ts:16 — read-only contract, appended custom instructions, "Reset instructions") and running dev stack (`/lab` HTTP 200). Note: the page's old "lab is marked complete when all items are checked" claim was deleted during the rewrite, not blessed — no completion state exists in code |
| docs/how-to/quizzes.qmd | everyday | P2 | verified | Walkthrough PASS after three fixes (grading is a single non-streaming round-trip — "streams back" reworded per generate-quiz.ts:294-331; finishing an attempt lands on an intermediate review state with a "Take me to the results" button, not automatic results — QuizRunner.svelte:130-160, quizzes.svelte.ts:64, 352-355; attempt score is recorded when every question is answered, not "graded" — quizzes.svelte.ts:491-503). Remaining claims verified against code (QuizRunner.svelte:70, 52-56, 76-94 — "Start quiz", progress line, numbered jump buttons at ≥5 questions; quizzes.svelte.ts:275-298 — immediate MCQ/flashcard scoring; schema.ts:169-205 — mcq/flashcard/short payloads, per-answer correctness + AI feedback, attempt timestamps; ShortQuestion.svelte:48-94 — rubric, "Grading…" spinner, verdict + feedback; AttemptHistory.svelte:23-48 — attempt list with Review switching; QuizSummary.svelte:29-46 — score summary; QuizPromptConfig.svelte:14 + sections.ts:17 — "Quiz generation prompt") and running dev stack (`/quiz` HTTP 200) |
| docs/how-to/data-and-privacy.qmd | everyday | P2 | verified | No edits needed — every claim re-verified: Postgres in Docker with `pg-data` volume (docker-compose.yml:30-39, 51-53); drizzle `migrate()` at server boot, applying all migrations to an empty DB and only new ones afterwards (server/src/pg.ts:104-108, server/src/server.ts:213-221); keys never in `settings` (schema.ts:226-231 "NO secrets"); keys in same-origin IndexedDB, sent only to the provider endpoint or the same-origin CORS proxy (keystore/browser.ts:32-53, server/src/llm-proxy.ts:14); no telemetry/analytics dependencies anywhere in `src/`; server required (labs/quizzes/chat all server-backed); Ollama template points at localhost so local-only streaming works offline (registry.ts:240-249). AGREES with the rewritten labs.qmd (labs.qmd:44) — both state labs persist in the server's Postgres database |
| docs/index.qmd | everyday | P2 | verified | No edits needed — install one-liner leads the Quick start section (index.qmd:35-43) with the same URL as README.md:46; dev-stack note (`pnpm dev`, :5173) matches package.json scripts; all six section links exist |
| README.md | everyday | P2 | verified | No edits needed — provider enumeration lists all 18 templates including Z.AI (GLM) and GitHub Copilot (README.md:22-25), matching registry.ts:54-269; install one-liner leads (README.md:45-47) |
| docs/how-to/building.qmd | contributor | P3 | verified | Commands executed as written on this worktree: `pnpm build` exit 0, `pnpm check` exit 0 (0 errors/0 warnings), `pnpm lint` exit 0, `pnpm test` exit 0 (123 files, 1908 tests) after building `@mayon/shared` once (fresh checkout prerequisite — added to the page, D-25), `pnpm --filter @mayon/server test` 285/286 (one pre-existing server defect, see US3 notes — not a doc issue). `quarto render docs` exit 0 after the edit |
| docs/how-to/contributing.qmd | contributor | P3 | verified | Convention realigned to actual repo history (D-15): `git log --oneline -40` is uniformly Conventional Commits (`feat:`, `fix:`, `docs:`, `chore(deps):`, `style:`); across all local+remote branches, 26 use `feat|fix|chore|test|docs/` prefixes (16 of them `feat/…`) and zero use `feature/…`. Docs page is primary for flow; convention content now matches history and CONTRIBUTING.md. `quarto render docs` exit 0 |
| CONTRIBUTING.md | contributor | P3 | verified | No edits needed — already states Conventional Commits with examples (CONTRIBUTING.md:63-74) and `feat/your-feature-name` branching (CONTRIBUTING.md:60), which is exactly the convention the repo history shows and that contributing.qmd now states; the two files agree |
| docs/explanation/architecture.qmd | contributor | P3 | verified | Edits verified against code: routes `ls src/routes` → `/`, `/login`, `/chat` (+`/chat/[id]`), `/lab`, `/quiz`, `/search`, `/tree`, `/settings` (D-16); schema gains `chats.mcp_config` (schema.ts:55), `messages.parts` (schema.ts:97), new `agent_traces` table (schema.ts:209-224) (D-17); provider enumeration rewritten to the 5 kinds (`openai-compatible`, `anthropic`, `gemini`, `ollama`, `github-copilot` — registry.ts kinds) behind the 18-template list incl. GitHub Copilot (registry.ts:56-251) (D-18); product summary gained image parts, Learner Profile, section peek strip (strip/pref.ts:2), and Expound/Lab/Quiz prompt settings (GenerationPromptConfig.svelte) (D-19); project-structure tree gained `components/generation/` (dir exists) and the two new routes. `quarto render docs` exit 0. Final consistency pass (T022) also tightened the cross-links sentence (D-26) |
| docs/reference/seams.qmd | contributor | P3 | verified | No edits needed — load-bearing claims spot-checked against code: gate hook `onRequest` + 403 bad origin (server/src/auth/gate.ts:43,49), PUBLIC_ALLOWLIST matches the doc's route list (gate.ts:20-28); restore-time 503 on `/api/db/query` (server/src/pg.ts:145), `pg_restore --data-only --single-transaction` (server/src/pg-backup.ts:67-68), `__drizzle_migrations` excluded from restore (pg-backup.ts:503); projection `EXCLUDED_KINDS` + `input: {}` quirk + branch_artifact deliberately not excluded (src/lib/chat/projection.ts:12,146,210); `StorageDriver` query/batch/exec (src/lib/db/driver/types.ts:18-24), sandbox SQLite at `/data/sandbox.sqlite` with WAL + `busy_timeout = 5000` (server/src/db.ts:35-38) |

(Out of scope, historical: docs/dev-notes/*, docs/history/* — research D5.)

## Discrepancies

| ID | Page | Kind | Doc claim → Actual | Status |
|---|---|---|---|---|
| D-01 | tutorials/getting-started.qmd | stale-label | "DB ready (pg)" badge → pill reads "DB ready" + separate "Runtime: …" line | doc-fixed |
| D-02 | tutorials/getting-started.qmd | missing-capability | (silent) → first run lands on `/` continue-learning dashboard, not a chat | doc-fixed |
| D-03 | tutorials/chat-and-branching.qmd | stale-label | "Branch from here" → "Branch from this" / "Branch from this text" | doc-fixed |
| D-04 | tutorials/chat-and-branching.qmd | stale-behavior | provider/model switcher in chat view → active provider/model set in Settings → Providers ("Set active"); chats use the global active provider | doc-fixed |
| D-05 | tutorials/chat-and-branching.qmd | stale-behavior | sidebar shows expandable conversation tree with depth → rail shows flat Parents/Branches/Siblings; visual tree is the /tree page | doc-fixed |
| D-06 | how-to/providers.qmd | wrong-fact | 7 templates listed → 18 shipped (src/lib/ai/registry.ts:54-269) | doc-fixed |
| D-07 | how-to/providers.qmd | missing-capability | GitHub Copilot kind absent → kind `github-copilot` with server-side auth | doc-fixed |
| D-08 | how-to/providers.qmd | wrong-fact | "Z.AI / GLM — Default template" → no default-template concept; DeepSeek leads; label "Z.AI (GLM)" | doc-fixed |
| D-09 | how-to/providers.qmd | wrong-fact | Ollama base URL http://localhost:11434 → http://localhost:11434/api | doc-fixed |
| D-10 | how-to/labs.qmd | stale-behavior | labs persist in local SQLite, "no server involved" → labs persist in server Postgres (schema.ts:142-156), server required | doc-fixed |
| D-11 | how-to/labs.qmd | stale-label | "Generate Lab" → "Generate lab" | doc-fixed |
| D-12 | how-to/labs.qmd | missing-capability | (silent) → custom "Lab generation prompt" setting exists | doc-fixed |
| D-13 | how-to/quizzes.qmd | stale-label | "Generate Quiz" → "Generate quiz" | doc-fixed |
| D-14 | how-to/quizzes.qmd | missing-capability | (silent) → custom "Quiz generation prompt" setting | doc-fixed |
| D-15 | how-to/contributing.qmd + CONTRIBUTING.md | internal-contradiction | branch prefix feature/… vs feat/…; commit style vs Conventional Commits | doc-fixed (contributing.qmd realigned to the convention the repo history actually uses — Conventional Commits + `feat|fix|chore/…` prefixes; CONTRIBUTING.md already conformed, untouched) |
| D-16 | explanation/architecture.qmd | missing-capability | route list missing `/` (dashboard) and `/login` | doc-fixed (routes list and diagram updated; verified against `src/routes/`) |
| D-17 | explanation/architecture.qmd | missing-capability | schema tables missing chats.mcp_config, messages.parts, agent_traces | doc-fixed (schema.ts:55, schema.ts:97, schema.ts:209-224) |
| D-18 | explanation/architecture.qmd | wrong-fact | provider list stale vs 18-template registry incl. github-copilot | doc-fixed (locked-decisions row and Adapters bullet now state the 5 kinds / 18 templates; registry.ts:56-251) |
| D-19 | explanation/architecture.qmd | missing-capability | product summary missing image parts, personas/Learner Profile, section peek strip, custom prompts | doc-fixed (summary bullet added; strip/pref.ts:2, LearnerProfileConfig.svelte, GenerationPromptConfig.svelte) |
| D-20 | index.qmd | missing-capability | omits install.sh one-liner README leads with | doc-fixed |
| D-21 | README.md | missing-capability | provider enumeration omits GitHub Copilot | doc-fixed (added by coordinator during US2) |
| D-22 | tutorials/chat-and-branching.qmd | wrong-fact | "Cross-linked chats appear as distinct reference edges in the sidebar" → no sidebar reference edges; cross-links render only in the rail's Cross-links panel (ChatRail.svelte:183, CrossLinks.svelte:50-119) | doc-fixed |
| D-23 | how-to/providers.qmd | wording-review | CORS quote vs shipped notice text → quote is a verbatim-accurate substring of the shipped hint (src/lib/ai/errors.ts:28-29, 73-79) | wontfix (verbatim quote, accurate) |
| D-24 | README.md | wrong-fact | provider enumeration omitted Z.AI (GLM) → now listed (README.md:24) | doc-fixed (added by coordinator during US2) |
| D-25 | how-to/building.qmd | missing-capability | Testing section said `pnpm test` needs no setup beyond `pnpm install` → on a fresh checkout tests fail to resolve `@mayon/shared` (packages/shared/package.json:13-15 has no install-time build hook); building it once (`pnpm --filter @mayon/shared build`) is required | doc-fixed (prerequisite sentence added to the Testing section) |
| D-26 | explanation/architecture.qmd | internal-contradiction | "cross-links render as distinct reference edges" (same phrasing D-22 struck from the tutorial, readable as a sidebar claim) → cross-links render only in the chat rail's Cross-links panel (ChatRail.svelte:183, CrossLinks.svelte); no sidebar edges exist | doc-fixed (final consistency pass T022: sentence now names the `cross_links` rows and the Cross-links panel as the only render site) |

Additional discrepancies discovered during implementation get IDs D-22+ appended here.

### US3 notes (T017–T021)

**Contributor convention decision (T017, closes D-15).** The repo's actual
history decides the convention content; the Quarto how-to page stays the
primary source for flow, and CONTRIBUTING.md mirrors it. Evidence from
`git log --oneline -40`: commit subjects are uniformly Conventional Commits
(`feat:`, `fix:`, `docs:`, `chore(deps):`, `style:`); the only non-conforming
subjects are bare topic words on ideas/spec seed commits. Evidence from
`git branch -a`: 26 branches use `feat|fix|chore|test|docs/` prefixes (16 of
them `feat/…`), and none use the old `feature/…` spelling that
contributing.qmd claimed. Both files now state: branch names
`feat/…`, `fix/…`, `chore/…`; commit messages Conventional Commits with a
short imperative subject.

**Pre-existing server test defect (found during T018, not a doc
discrepancy).** `pnpm --filter @mayon/server test` fails deterministically in
`src/auth-ratelimit.test.ts:353-378` ("locks the forwarded address while
other clients on the same socket stay unaffected"): with `trustProxy: 1`
(server/src/server.ts:123-125), a login from a *different* `x-forwarded-for`
address on the same socket is expected to get 401 but receives 429 — the
rate limiter's `request.ip` key (server/src/auth/index.ts:314) does not
follow the forwarded header the way the test asserts. This is a product/test
defect, not doc drift; building.qmd merely lists the command and makes no
pass/fail claim, so the page is still accurate. Defect recorded here per D2;
a decision-history entry (FR-010) is left to the owner. All 285 other server
tests pass, as do the full root suite (1908 tests) and `pnpm build` /
`pnpm check` / `pnpm lint`.

### US2 walkthrough fixes (T015)

The fixes applied in place during walkthrough verification:
providers.qmd said the Settings gear icon is "in the header" — it is in the
sidebar navigation (AppShell.svelte:33, Sidebar.svelte:25); quizzes.qmd said
grading responses "stream back" — short-answer grading is a single
non-streaming object round-trip (generate-quiz.ts:294-331); and quizzes.qmd
said you are "taken to your results" when the last question is answered — an
intermediate review state with a "Take me to the results" button appears first
(QuizRunner.svelte:130-160). The attempt-score wording was corrected to match
the answered-not-graded finalisation rule (quizzes.svelte.ts:491-503).

## Baseline render (T002)

`quarto render docs` at baseline: exit 0, no warnings, no broken-link reports.

## Ground-truth spot check (T004)

Dev stack up (mayon-dev-web-1/-server-1/-db-1): web 200 at :5173; `/api/health` via proxy
returns `{"ok":true,"version":"0.6.0","caps":["stdio-mcp","llm-proxy","sandbox-db","backup","pg"]}`.

- 18 provider templates confirmed (`grep -c "label: '" src/lib/ai/registry.ts` = 18),
  order: DeepSeek, xAI (Grok), Moonshot Kimi, Qwen (DashScope), Groq, Mistral,
  OpenCode Zen, LiteLLM (self-hosted), Vercel AI Gateway, Requesty, Z.AI (GLM),
  Kilo Gateway, OpenRouter, OpenAI, Anthropic (Claude), Google Gemini, Ollama (local),
  GitHub Copilot (registry.ts:57-252). No contract change needed.
- Branch labels: `Highlighter.svelte:496-499` "Branch from this";
  `ContextMenu.svelte:86` "Branch from this text". ✓
- "Generate lab" / "Generate quiz": `chat/[id]/+page.svelte:809-810, 825-826`. ✓
- DB pill "DB ready": `DbStatus.svelte:15` (+ "DB ready (self-check failed)" :14). ✓
- Routes exist: `/` (+page.svelte), `/login`, `/tree`. ✓
- Ollama baseUrl `http://localhost:11434/api` (registry.ts:244). ✓

Contract verified as-is; no ground-truth updates required.

## Final consistency pass & gates (T022–T025)

**T022 — contract walkthrough.** Walked `contracts/docs-accuracy-contract.md` row by
row against the current docs: global items 1–5 and all 13 per-page rows PASS, with
claims spot-checked against code where cheap (DbStatus.svelte:14-15,48; BootGate.svelte:16,49,55;
Highlighter.svelte:496-499; ContextMenu.svelte:86; registry.ts 18 `label:` entries in
contract order; chat/[id]/+page.svelte:809-810,825-826; ProviderConfig.svelte:450,516,743-769,778,793;
ChatRail.svelte:183 + CrossLinks.svelte; `ls src/routes`; schema.ts:55,97,209-224;
package.json scripts vs building.qmd's command table). One genuine miss found and
fixed: architecture.qmd still said cross-links "render as distinct reference edges" —
the exact phrasing D-22 struck from the tutorial — now D-26 (doc-fixed). The ledger is
fully terminal: D-01…D-26 are `doc-fixed` or `wontfix` (D-23, with justification);
none `open`.

**T025 — decision history (FR-010).** Created `docs/history/021-sync-docs-implementation.qmd`
(Goal / Why / Outcome & reversals / a defect-not-a-doc-fix paragraph / Learnings, matching
the 019 page pattern) covering the owner's priority rationale, the five drift themes, the
corrections, the perform-the-steps + code-evidence verification method, and the recorded
product defect (login rate limiter 429-vs-401, server/src/server.ts:123-125 +
server/src/auth/index.ts:314) as a pending fix for a future feature. Linked it from
`docs/history/index.qmd` (Arc E table row, Arc E intro, "Where the story stands" — count
now twenty-five, defect added to the recorded follow-ups) and from the Decision-history
sidebar in `docs/_quarto.yml` (Arc E). This closes the FR-010 obligation noted in US3.

**T023 — render.** `quarto render docs` in this worktree exits 0 but silently renders
zero files: the worktree lives under `<repo>/.kilo/worktrees/`, and the main checkout's
`.git/info/exclude` pattern `.kilo/worktrees/` makes quarto's git-based project
discovery treat every docs file as ignored (pre-existing environment condition, not
caused by this feature; earlier "clean render" observations in this worktree were the
same empty render). Verified instead by rendering a bit-identical copy of this
worktree's `docs/` outside the excluded path: exit 0, 54/54 pages rendered, zero
warnings, zero errors; the new history page renders, and the history index, landing
page, and every sidebar nav resolve its links (checked in the rendered HTML). D-26's
sentence verified in `explanation/architecture.html`.

**T024 — gates (exact results).**

- `pnpm check` — exit 0, "svelte-check found 0 errors and 0 warnings".
- `pnpm lint` — exit 0 (eslint clean; Prettier: "All matched files use Prettier code style!").
- `pnpm test` — exit 0, 123 test files passed, 1908 tests passed.
- `pnpm --filter @mayon/server test` (run for completeness) — exit 1, 285/286 passed;
  the single failure is the pre-existing recorded product defect
  (`src/auth-ratelimit.test.ts` "locks the forwarded address while other clients on the
  same socket stay unaffected"). No server code touched.

All 13 Documentation Page entities remain `verified`; the ledger is fully terminal.
