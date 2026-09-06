# Research: Sync Docs With Current Implementation

**Feature**: specs/021-sync-docs-implementation | **Date**: 2026-09-06

Research method: a read-only survey agent extracted every checkable claim from each
living docs page and verified it against the codebase (component labels, registry data,
package scripts, compose files, server code). Findings below are the ground truth this
feature's tasks will act on. Code citations are `file:line` in this worktree.

## Decisions

### D1. Audit order follows the owner's audience priority

- **Decision**: Fix P1 beginner docs (getting-started, chat-and-branching) first, then
  P2 everyday guides (providers, labs, quizzes, data-and-privacy, index, README), then
  P3 contributor docs (building, contributing, architecture, seams, CONTRIBUTING.md).
- **Rationale**: The owner states most users are non-developers who want the fastest path
  to using the product; path of least resistance wins.
- **Alternatives considered**: Fixing by alphabetical/page order (rejected: ignores
  impact); fixing developer docs first because they are "canonical" (rejected: contradicts
  stated priority).

### D2. The implementation is the source of truth, except where it is broken

- **Decision**: Docs change to match the product. If a doc describes intended behavior
  the product lacks, record a product defect in the decision history instead of rewriting
  the doc to bless the broken behavior.
- **Rationale**: Spec FR-002 and Edge Cases; the survey found no confirmed instances of
  the second kind in living docs — recorded anyway as process.
- **Alternatives considered**: Case-by-case negotiation per discrepancy (rejected: slow,
  inconsistent).

### D3. All doc content is written in normal prose

- **Decision**: Every rewritten passage uses complete, plain professional prose aimed at
  non-developers. No compressed/telegraphic style, no jargon-dense shorthand — matching
  the existing docs voice.
- **Rationale**: Owner instruction ("I don't want the docs to sound like a caveman") and
  the non-developer audience.
- **Alternatives considered**: None.

### D4. Fix drift in place; add coverage for user-visible features without new pages

- **Decision**: Corrections happen inside existing pages. User-visible features that are
  undocumented (see F-UNDOC) get short coverage in the most relevant existing page; a new
  page is created only if no existing page can host the content.
- **Rationale**: Keeps scope bounded and the path of least resistance (fewer places to
  look) per the spec's FR-008.
- **Alternatives considered**: A full docs expansion for every recent feature (rejected:
  feature-creation, not doc sync; separate features if wanted).

### D5. Historical pages stay historical

- **Decision**: `docs/dev-notes/` and `docs/history/` are not corrected. `_quarto.yml`
  was verified current and is touched only if a page set changes.
- **Rationale**: Spec Assumptions; history pages are records, not manuals.

### D6. Verification is perform-it-yourself

- **Decision**: A correction is "done" only when the documented step was performed
  against the running product (`pnpm dev` stack for guides, command execution for
  contributor docs) with the documented result. The Quarto site must also render
  (`quarto render docs`, available locally) so nav and links resolve.
- **Rationale**: Spec FR-004/FR-005/FR-009 and SC-001–SC-005.

## Ground-truth survey results (Phase 0 findings)

Per-page verdicts from the survey (evidence in the survey log; spot-checks re-verified
during implementation):

| Page | Verdict | Key drift |
|---|---|---|
| docs/_quarto.yml | current | none (all nav entries exist; no orphans) |
| docs/index.qmd | current | minor: omits install.sh one-liner README leads with |
| docs/tutorials/getting-started.qmd | drifted (minor) | "DB ready (pg)" badge label wrong; first-run lands on the `/` dashboard, not a chat — undocumented |
| docs/tutorials/chat-and-branching.qmd | drifted | "Branch from here" → "Branch from this"/"Branch from this text"; no provider/model switcher in chat view (resolve globally in Settings); sidebar shows flat Parents/Branches/Siblings — the tree view is the dedicated /tree page |
| docs/how-to/providers.qmd | **drifted (largest)** | 7 templates listed vs 18 shipped (`src/lib/ai/registry.ts:54-269`); GitHub Copilot kind missing; no "default template" concept (DeepSeek leads); Ollama base URL is `http://localhost:11434/api` |
| docs/how-to/labs.qmd | drifted | stale "local SQLite… no server" storage claim — labs live in Postgres via the server (`src/lib/db/schema.ts:142-156`), contradicting data-and-privacy.qmd; "Generate Lab" → "Generate lab"; undocumented custom "Lab generation prompt" setting |
| docs/how-to/quizzes.qmd | current (cosmetic) | payloads/tables match; "Generate Quiz" → "Generate quiz"; undocumented quiz prompt setting + Learning-Brief gate |
| docs/how-to/data-and-privacy.qmd | current | verified against compose, drizzle boot migration, keystore |
| docs/how-to/building.qmd | current | all commands match package.json; e2e section fully verified |
| docs/how-to/contributing.qmd | drifted | branch prefix `feature/…` vs CONTRIBUTING.md's `feat/…`; commit style disagrees with CONTRIBUTING.md's Conventional Commits mandate |
| docs/reference/seams.qmd | current | verified against driver/auth/gate/projection/backup code |
| docs/explanation/architecture.qmd | drifted (minor/gaps) | route list missing `/login` and the `/` dashboard; schema tables missing `chats.mcp_config`, `messages.parts`, `agent_traces`; provider list stale vs 18-template registry; product summary missing image parts, personas/Learner Profile, section peek strip, custom prompts |
| README.md | current (minor) | provider enumeration omits GitHub Copilot |
| CONTRIBUTING.md | current (minor) | must be made to agree with the qmd on branch/commit conventions |

### Cross-cutting themes

1. Provider catalog grew 7 → 18 templates plus the `github-copilot` auth kind.
2. A pre-Postgres storage narrative survives in labs.qmd.
3. UI label renames never propagated ("Branch from this", "Generate lab/quiz",
   "DB ready", tree moved to /tree).
4. Auth/boot experience under-documented in tutorials (`/login`, boot gate).
5. Architecture schema/route lists lag the schema and routes.
6. The two contributor docs contradict each other.

### User-visible but undocumented features (candidates for D4 coverage)

- Personas / Learning Brief / "Learner profile" settings section.
- Image chat parts (attach/paste images; vision-capable providers).
- Section peek strip (Settings → Chat).
- Custom Expound / Lab / Quiz prompt settings (Settings).
- Reasoning-effort toggle in the composer.
- New-chat starter prompts.

### Ambiguities to resolve during implementation (not blockers)

- Whether cross-links render anywhere besides the chat view (verify before rewriting
  that sentence in chat-and-branching.qmd).
- Quiz runner default mode (one-at-a-time vs scrollable) — verify in the UI before
  describing it.
- Regenerate-lab checklist reset path — confirm behavior before documenting.

## NEEDS CLARIFICATION items

None carried from the plan's Technical Context — all unknowns were resolved by the
survey above.
