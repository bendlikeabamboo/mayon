# Implementation Plan: Mermaid Repair Integrity (028 defects)

**Branch**: `fix/issue-72-mermaid-repair` | **Date**: 2026-11-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/036-mermaid-repair-integrity/spec.md` (issue #72)

## Summary

Six defects in the shipped feature 028 (mermaid error repair) are fixed without changing
its architecture: (1) the pure repair pass is redesigned as a family-scoped, single-pass,
idempotent rule set that never rewrites valid syntax (init directives, C4 argument
lists, xychart data lists) outside the fault site; (2) the send path preflights provider
resolution before persisting the user row so the "Fix this diagram" affordance can no
longer orphan rows in a provider-less environment; (3) the failed-diagram block presents
the complete failure text wrapped and visible with the source collapsed; (4) the
sourcemap exclusion-coverage test derives its selector list from the real export. The
028 render-pipeline contract (exactly one deterministic repair attempt; unchanged
repaired source ⇒ underlying original error) is preserved verbatim; the 028 contracts
and `docs/reference/seams.qmd` are amended in place with cross-references to 036.

## Technical Context

**Language/Version**: TypeScript on Node 22; SvelteKit static SPA (Svelte 5 runes)

**Primary Dependencies**: mermaid (runtime render), vitest + jsdom (tests); no new dependencies

**Storage**: none (render-time only; no schema change, no server surface)

**Testing**: Vitest (`pnpm test:low-spec`), pglite test driver; real mermaid parser used
for parseability assertions (existing pattern in `mermaid-repair.test.ts`)

**Target Platform**: browser SPA (desktop-first chat UI)

**Project Type**: web app (SvelteKit SPA + Node server; this feature touches SPA only)

**Performance Goals**: repair is O(n) per rule over source length (no repeated
whole-source rescans); no other perf surface

**Constraints**: 028 render-pipeline contract invariants (see
`specs/028-mermaid-error-repair/contracts/render-pipeline.md`); expound/sourcemap
invariants in AGENTS.md; test-runner caps (fleet policy, see tasks.md)

**Scale/Scope**: ~5 source files + 4 test files touched; 1 new helper module + its test

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Layering** — pass: app code calls repositories only; the send-path change stays
  inside `chatStore` (`repos.messages.append` usage unchanged in kind, only reordered).
- **StorageDriver seam** — pass: no storage changes.
- **`pnpm check` / `pnpm lint` before merge; tests with every bug fix (fail-first)** —
  pass: every story ships regression tests; constitution II requires a regression test
  that fails without the fix (mapped per task).
- **UX consistency (Tailwind v4 + shadcn-svelte vocabulary; established `:global`
  runtime-created chrome patterns)** — pass: the error block restyle extends the
  existing `:global(.mermaid-error …)` CSS vocabulary in `Markdown.svelte`; no new
  component primitives.
- **Expound offsets / excluded chrome invariants** — pass: `.mermaid-error` (whole
  block) is already an excluded chrome selector; new inner elements stay inside it, so
  `closest('.mermaid-error')` still excludes them; the exclusion list itself is
  untouched.
- **No `+`-prefixed test filenames** — pass: new test file `mermaid-error-block.test.ts`.

No violations; no complexity tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/036-mermaid-repair-integrity/
├── plan.md              # This file
├── research.md          # Phase 0 output — verified defect mechanics + decisions
├── data-model.md        # Phase 1 output — no new entities (explicit)
├── quickstart.md        # Phase 1 output — capped validation scenarios
├── contracts/
│   ├── repair-semantics.md       # amends 028 render-pipeline.md §repairMermaidSource
│   └── fix-send-preflight.md     # amends 028 fix-affordance.md §Availability
└── tasks.md             # Phase 2 output ($speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── markdown/
│   │   ├── mermaid-repair.ts        # US1: redesigned rule set (single-pass, scoped)
│   │   ├── mermaid.ts               # US1: seam unchanged (contract re-anchored)
│   │   ├── mermaid-repair.test.ts   # US1: preservation + property corpus tests
│   │   └── sourcemap.test.ts        # US4: derive exclusions from the export
│   ├── chat/
│   │   └── selection.ts             # US4: export consumed (unchanged itself)
│   ├── stores/
│   │   ├── chat.svelte.ts           # US2: send() provider preflight
│   │   └── chat.svelte.test.ts      # US2: no-orphan-row regression
│   └── components/chat/
│       ├── Markdown.svelte           # US3: error-block presentation + CSS
│       ├── mermaid-error-block.ts    # US3: extracted pure DOM builder (new)
│       ├── mermaid-error-block.test.ts # US3: builder regression tests (new)
│       └── rows/AssistantMessage.svelte # US2 context (wiring unchanged)
├── docs/reference/seams.qmd          # seam paragraph update (036 semantics)
├── specs/028-mermaid-error-repair/contracts/{render-pipeline,fix-affordance}.md # amended in place
└── CHANGELOG.md                      # entries under ## [0.10.0] → ### Fixed
```

**Structure Decision**: single SPA project; the only new module is the extracted
error-block builder placed beside the existing `mermaid-center.ts` helper (same
directory, same non-`+` test naming), because `buildMermaidError` currently lives
untestable inside `Markdown.svelte`'s `<script>`.

## Complexity Tracking

> No constitution violations — table intentionally empty.

---

## Phase 0: Outline & Research

See [research.md](./research.md). Verified against the current tree on 2026-11-10:
every defect was reproduced concretely (see research "Evidence"), all file:line anchors
below were re-verified, and the issue's stale anchors are corrected there
(`EXCLUDED_CHROME_SELECTORS` lives in `src/lib/chat/selection.ts:27`, not
`sourcemap.ts`; Markdown.svelte `:536-549` is fix-button CSS, not an info dot).

## Phase 1: Design & Contracts

- [data-model.md](./data-model.md): no new entities; the fix changes ordering and
  presentation only.
- [contracts/repair-semantics.md](./contracts/repair-semantics.md): the redesigned
  `repairMermaidSource` rule set — amends 028 `render-pipeline.md` in place.
- [contracts/fix-send-preflight.md](./contracts/fix-send-preflight.md): the send-path
  provider preflight — amends 028 `fix-affordance.md` in place.
- [quickstart.md](./quickstart.md): capped, per-story validation scenarios.

Constitution re-check post-design: pass (same gates as above; the contracts amend
existing 028 documents in place per fleet instruction, with explicit 036
cross-references — no contract fork).
