# Implementation Plan: Image Output Finalize & Follow-Up Paths

**Branch**: `033-image-output-finalize-paths` | **Date**: 2026-11-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/033-image-output-finalize-paths/spec.md` (issue #70 — seven failure modes of the 030 image finalize/persist path)

## Summary

Fix all seven failure modes of the image-output finalize path as one coordinated change across three seams: (1) **projection** — assistant image parts go onto the wire as AI SDK `file` parts (the only image-bearing shape `AssistantContent` accepts in `ai@7.0.4` / `@ai-sdk/provider-utils@5.0.2`), so follow-up turns stop dying as `AI_InvalidPromptError` → "Network error"; (2) **turn loop persist plumbing** — stream image recognition records arrival offsets and survives aborts (caller-owned accumulator), image-only iterations append an image-only row, and both abort-path persists hand the turn's images through; (3) **store finalize composition** — parts compose in arrival order (text split at image offsets), candidates are byte-validated and capped at 8 with plain-language drop notices, `applyOutputBudget` never throws per image, and the failure refinement keys on a stream-recognized count (`onImageRecognized`) instead of post-finalize state, plus a zero-image notice on image-expecting successful turns. No schema changes; 030 contracts are amended in place where this feature refines them (see research D5, contracts/).

## Technical Context

**Language/Version**: TypeScript on Node 22 (`.nvmrc`), pnpm 10; SvelteKit SPA (Svelte 5 runes), no SSR.

**Primary Dependencies**: `ai@7.0.4`, `@ai-sdk/provider-utils@5.0.2` (`AssistantContent` accepts `TextPart | CustomPart | FilePart | ReasoningPart | ReasoningFilePart | ToolCallPart | ToolResultPart | ToolApprovalRequest` — **no image part**; `ImagePart` is deprecated, valid only in `UserContent`; `FilePart = { type: 'file', data, mediaType: string, filename? }` — see `node_modules/.pnpm/@ai-sdk+provider-utils@5.0.2_zod@4.6.7/node_modules/@ai-sdk/provider-utils/dist/index.d.ts` lines 103–171 and 1284). drizzle + Postgres behind the `StorageDriver` seam; Vitest with the pglite test driver.

**Storage**: Postgres via `messages.parts` (JSON text) — **no migration**; all fixes respect the existing parts invariants (`src/lib/db/repositories/messages.ts:23-38`).

**Testing**: Vitest. SPA tests via `pnpm test:low-spec <files>` (memory-capped wrapper per fleet rules — see quickstart.md). Key existing suites: `src/lib/chat/projection.test.ts`, `src/lib/agent/loop.test.ts` (scriptedFullStream harness at :170; 030 image-recognition describe at :2206), `src/lib/stores/chat.svelte.test.ts` (runAgentTurn mock at :76-85 — the mocked abort test at :2167 is the one issue #70 calls out), `src/lib/chat/images.test.ts`.

**Target Platform**: Browser SPA + Node server (unchanged topology).

**Project Type**: web application (monorepo: SPA root + `server/` + `packages/shared`).

**Performance Goals**: No new main-thread work on the streaming path beyond O(images) bookkeeping; finalize composition stays within existing budget discipline (yield-between-images, spec 030 SC-007).

**Constraints**: Repo invariants (AGENTS.md): app code calls repositories only; `StorageDriver` is the only storage seam; full-text `search_vec` columns are generated (never written); tests must not use `+` filename prefix. Fleet rule: tests only under `systemd-run --user --scope -p MemoryMax=500M --setenv=NODE_OPTIONS=--max-old-space-size=384 …` one process at a time.

**Scale/Scope**: 4 source files materially touched (`src/lib/chat/projection.ts`, `src/lib/agent/loop.ts`, `src/lib/stores/chat.svelte.ts`, `src/lib/chat/images.ts`) + their tests + two 030 contract files amended in place + this feature's artifacts.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
| --- | --- | --- |
| I. Layering: app code calls repositories only | PASS | All persistence flows through `repos.messages.append` inside the store; loop talks only to injected `appendAssistantText` deps. |
| I. StorageDriver is the only storage seam | PASS | No driver changes; `validateParts` invariants enforced upstream of append. |
| I. `pnpm check` + `pnpm lint` before merge | PASS (planned) | tasks.md final phase runs both. |
| I. No secrets in settings | PASS | No settings touched. |
| I. No `+`-prefixed test files | PASS | All new tests extend existing `*.test.ts` files. |
| II. `pnpm test` passes; every bug fix ships a fail-first regression test | PASS (planned) | FR-008; every task group pairs fix + failing-without-fix test; capped low-spec runner per fleet rules. |
| II. New behavior in `src/lib/` accompanied by tests | PASS (planned) | Projection, loop, store, images each get tests. |
| II. No writes to `search_vec`, no reindex paths | PASS | Not touched; notices ride `content` so FTS stays self-maintaining. |
| III. UI from existing vocabulary; progressive degradation | PASS | No new components; notices reuse the established bracketed-text pattern from 030 R-4. |
| III. Expound offsets: raw-markdown via sourcemap, no substring heuristics | PASS | Interleaved parts keep text parts concatenating byte-for-byte to `content` (contract §1); AssistantMessage.svelte segments (:107-159) already renders interleaved parts and notes alignment derives "by construction". |
| IV (docs): contracts updated in the same change | PASS (planned) | 030 contract amendments + `docs/reference/tool-map.qmd` untouched (no agent/MCP tool changes). |

No violations → no Complexity Tracking entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/033-image-output-finalize-paths/
├── plan.md              # This file
├── research.md          # Phase 0 — verified facts + decisions D1–D8
├── data-model.md        # Phase 1 — entities, invariants, state
├── contracts/
│   ├── assistant-projection.md      # wire shape for assistant images (refines 030 message-parts §5)
│   └── finalize-composition.md      # finalize handoff, ordering, caps, containment (refines 030 stream-image-parts)
├── quickstart.md        # capped validation commands per user story
├── checklists/
│   └── requirements.md  # spec-quality checklist (specify phase)
└── tasks.md             # speckit.tasks output
```

### Source Code (repository root)

```text
src/lib/
├── chat/
│   ├── projection.ts        # D1: assistant image → FilePart wire shape
│   ├── images.ts            # D6: applyOutputBudget never-throw + dropped count; sniff-gate helper
│   └── propagation.ts       # (unchanged — already slices to 8; referenced as precedent)
├── agent/
│   └── loop.ts              # D2/D3/D5/D7: image-sink accumulator, offsets, abort persists, image-only rows, onImageRecognized, final flag
├── stores/
│   └── chat.svelte.ts       # D4/D5/D6/D7: composeAssistantParts ordering+cap+notices, recognized counter, refinement, zero-image notice
└── ai/
    └── image-output-capability.ts  # (unchanged; supportsImageOutput consumed by D7)

src/lib/chat/projection.test.ts    # US1 tests
src/lib/agent/loop.test.ts         # US2/US3/US7 tests
src/lib/stores/chat.svelte.test.ts # US2/US3/US4/US6/US7 store-level tests
src/lib/chat/images.test.ts        # US6 budget tests

specs/030-image-generation/contracts/
├── message-parts.md        # amended §5 (wire shape wording) — in place
└── stream-image-parts.md   # amended §2/§3/§4 (offsets, ordering, caps, abort) — in place
```

**Structure Decision**: Single-project monorepo layout (existing); no new directories. Contract files of 030 are edited in place because code comments across the repo cite them as living authority (research D5, R-12 precedent).

## Complexity Tracking

> Not filled — no Constitution Check violations to justify.
