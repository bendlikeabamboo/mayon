# Implementation Plan: Conversational Back-Propagation Tool

**Branch**: `027-backprop-tool` | **Date**: 2026-11-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/027-backprop-tool/spec.md`

## Summary

A `propagate_to_parent` agent tool so the assistant can execute branch back-propagation at the model's hand when the user asks for it in conversation ("I'm done here — backpropagate this"), eliminating the throwaway-closing-turn workaround. One deterministic tool in the existing registry reuses the shipped 020 propagation mechanism end to end — `resolveAnchor` / `buildRawDelta` / `branchArtifactMetadata` / `generateBranchArtifactSummary` plus `messagesRepo.insertAnchored` — so tool-triggered artifacts are byte-identical to manual-control ones. Gating mirrors the manual control: the tool is disabled on root chats and empty branches via the existing per-turn `disabledToolIds` mechanism, execution is high-risk (approval modal) and generative-flagged (summary mode performs one LLM sub-call), and a shared in-flight latch refuses concurrent second starts across both trigger paths. Offer-once etiquette and confirmation style ride the capabilities preamble. No new persistence, no new kind, no new dependencies; `docs/reference/tool-map.qmd` and `agent-map.qmd` updated in the same change.

## Technical Context

**Language/Version**: TypeScript — SvelteKit/Svelte 5 runes SPA (`src/lib/`); no server or shared-package changes.

**Primary Dependencies**: Existing stack only — Vercel AI SDK (summary sub-call via `generateBranchArtifactSummary`, already self-sufficient: resolves its own provider via `getActiveSdkProvider()`), drizzle repositories (`repos`). No new runtime dependencies.

**Storage**: None new. The tool performs the same single `messagesRepo.insertAnchored` write the manual control performs (`role: 'user'`, `kind: 'branch_artifact'`); tool activity persists as existing `tool_call`/`tool_result` rows through the turn pipeline. No drizzle migration.

**Testing**: Vitest (pglite). Unit: `deterministic-tools.test.ts` (tool gates/outcomes), `propagation.test.ts` (latch), `brief.test.ts` (preamble lines), `chat.svelte.test.ts` (`disabledToolIds` gating). E2E: mock-llm fixture server gains a propagate-tool dispatch mode (marker-based, existing classification pattern).

**Target Platform**: Web SPA as shipped; dev via `pnpm dev`.

**Project Type**: Web application (SPA); internal agent-tool feature.

**Performance Goals**: Raw mode adds only repository reads/writes (no LLM call); summary mode performs exactly the one sub-call the manual path performs. No chat-latency impact beyond the propagation work itself.

**Constraints**: Tool-triggered artifacts MUST be indistinguishable from manual ones (FR-002) — same insert path, not a reimplementation; the tool MUST NOT import the chat store (module-level registry, no store access, circular-import hazard); failures leave both chats unchanged (FR-007); no content of the propagated artifact reproduced as chat text (preamble rule).

**Scale/Scope**: One tool + gating + preamble + docs + tests. No schema, no UI component changes (the manual button is untouched).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I. Code Quality — layering | Tool body reads/writes through repositories only (`repos.*` + existing `src/lib/chat/propagation.ts` helpers); no component imports `db`; tool does not touch the store | PASS |
| I. Code Quality — toolchain pins | No new deps; Node 22/pnpm 10 unchanged | PASS |
| II. Testing | New behavior in `src/lib/` accompanied by Vitest tests (tool unit tests, gating test, preamble test, latch test); regression test for concurrent refusal | PASS (planned in quickstart) |
| III. UX — component vocabulary / progressive capability | No new UI components; tool rides the existing approval-modal and generative-status patterns; degrades to "manual control only" when the provider lacks tool support (existing gates) | PASS |
| III. UX — no downtime ops | In-app action only; no restart/restore interaction | PASS |
| IV. Performance | No bundle growth (no deps); raw path LLM-free; summary path identical cost to manual summary | PASS |
| Seams authority | No new seam — the tool is a new entry in the existing agent-tool seam (`registry.ts`); `docs/reference/tool-map.qmd` (+ `agent-map.qmd` feature-placement note) updated in the same change per its header rule | PASS (task listed in structure) |

Post-Phase-1 re-check: data model adds no tables/kinds (tool contract only); contract defines availability gating, approval flow, and result shapes consistent with the loop's risk classes. No violations; no complexity tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/027-backprop-tool/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions D1–D10
├── data-model.md        # Phase 1 output — tool contract entity + state
├── quickstart.md        # Phase 1 output — validation scenarios V0–V6
├── contracts/
│   └── propagate-tool.md  # tool definition, availability, results, preamble rules
└── tasks.md             # Phase 2 output ($speckit-tasks — NOT created by this command)
```

### Source Code (repository root)

```text
src/lib/
├── chat/
│   ├── propagation.ts             # + shared in-flight latch (acquire/release) used by store + tool
│   └── propagation.test.ts        # latch semantics
├── agent/
│   ├── deterministic-tools.ts     # + propagate_to_parent (risk high, generative) reusing propagation helpers
│   └── deterministic-tools.test.ts # gates, raw/summary outcomes, failure shapes
├── chat/
│   └── brief.ts                   # capabilities preamble: + back-propagation etiquette lines
│   └── brief.test.ts              # preamble assertions
├── stores/
│   └── chat.svelte.ts             # disabledToolIds: + propagate_to_parent on roots/empty branches;
│                                   #   propagateToParent adopts the shared latch
│   └── chat.svelte.test.ts        # per-turn gating assertions
tests/
├── fixtures/mock-llm/server.mjs   # + propagate tool-call dispatch mode (marker-based)
└── e2e/backprop-tool.spec.ts      # V6 e2e: conversational request → tool call → parent artifact
docs/reference/
├── tool-map.qmd                   # inventory row + behavioral notes + availability gate entry
└── agent-map.qmd                  # feature-placement note (if tools placement listed there)
```

**Structure Decision**: Single-repo layout as-is; the tool joins the deterministic group in `src/lib/agent/deterministic-tools.ts` (it is a repo-orchestrating action like `branch_chat`, with its only LLM work delegated to the existing summary generator), gating joins the existing `disabledToolIds` list in the chat store, and no new files beyond tests and the e2e spec. No new packages, no schema changes.
