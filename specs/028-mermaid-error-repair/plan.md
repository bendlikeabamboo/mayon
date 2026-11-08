# Implementation Plan: Mermaid Diagram Error Repair & Containment

**Branch**: `028-mermaid-error-repair` | **Date**: 2026-11-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/028-mermaid-error-repair/spec.md`

## Summary

Repair and contain mermaid diagram render failures in chat markdown. Three layers: (1) **containment** — set mermaid's `suppressErrorRendering` so failed renders never inject mermaid's error SVG into the page (today's page-scroll + bottom-banner defect), and replace the raw red parse-dump `<p>` with a contained, styled error block inside the diagram's own area; (2) **deterministic render-time repair** — a pure, idempotent source-repair module applied at the shared render seam (`renderMermaidBlock`) so both the initial mount pass and the theme re-render pass produce identical results, covering common model-produced fault classes (quoted labels containing commas/quotes as in the spec's example) without mutating the stored message; (3) **model-assisted recovery without render-time LLM calls** — generation-time self-correction already exists (agent critic validates mermaid fences and re-streams corrected replies), and the residual case gets a user-triggered, in-conversation "fix this diagram" action that sends the broken source + failure reason as a follow-up message. A repaired render is badged with access to the original source; the error block joins the expound excluded-selectors list (also fixing a discovered alignment-degradation defect).

## Technical Context

**Language/Version**: TypeScript on Node 22 (`.nvmrc`), SvelteKit + Svelte 5 runes (runes-mode components), pnpm 10.

**Primary Dependencies**: `mermaid ^11.16.1` (existing, supports `suppressErrorRendering`), Tailwind v4 + shadcn-svelte (bits-ui) for UI vocabulary, Vitest + pglite for tests. No new dependencies.

**Storage**: N/A — no schema change, no new settings keys. Stored assistant markdown (`messages.content`, `src/lib/db/schema.ts:90`) is never modified; all repair state is render-time and derived.

**Testing**: Vitest (`pnpm test`). Constitution requires a regression test per bug fix: containment (no out-of-block DOM nodes on failed render) and the repair corpus (spec example renders) must fail pre-fix and pass post-fix. Pure modules (`mermaid-repair.ts`) get unit tests; excluded-selectors alignment gets a selection-level test.

**Target Platform**: Browser SPA (`@sveltejs/adapter-static`, no SSR). All mermaid work happens client-side; the server is uninvolved (progressive-degradation clean: the fix action simply needs a configured provider, as any chat send does).

**Project Type**: web-app (SPA + optional Node server).

**Performance Goals**: Valid diagrams take the same path as today (repair only runs after a failed render attempt — zero cost for valid diagrams, SC-003). Repair is bounded, pure string work; render stays lazy (dynamic `import('mermaid')`, idle-scheduled). No bundle growth (no new deps).

**Constraints**:
- Transcript immutability: repair never writes to `messages.content`; the wrapper's `data-mermaid-source` keeps the original source (theme re-render stability, FR-012; expound offset safety).
- Expound constraint: any injected DOM with text content (error block, repaired badge, original-source view) must join `EXCLUDED_CHROME_SELECTORS` (`src/lib/chat/selection.ts:27-38`).
- Live/streaming path must not attempt mermaid (already guaranteed by the `live` guards at `Markdown.svelte:71,76`; preserve them).
- No model-assisted LLM call at render time (token-cost predictability on historical message mounts, SC-004).

**Scale/Scope**: single-owner local deployment; unbounded history means mount-time work must stay cheap and side-effect-free (deterministic repair is; LLM calls would not be).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How |
|---|---|---|
| I. Layering (app code → repositories only; no `db` imports) | PASS | Feature touches `src/lib/markdown/`, `src/lib/components/chat/`, `src/lib/chat/selection.ts`; no DB access anywhere. |
| I. `pnpm check` + `pnpm lint` before merge | PASS | Standard gates; noted in quickstart. |
| I. No secrets in settings | N/A | No settings changes. |
| II. Tests: `pnpm test` green; bug fix ⇒ regression test | PASS | Containment and repair-corpus regression tests are first-class deliverables (fail without fix). New logic in `src/lib/` is unit-tested (`mermaid-repair.test.ts`, selection exclusion test). |
| III. UI from Tailwind v4 + shadcn-svelte vocabulary, match conventions | PASS | Error block and badge follow the existing `.mermaid-pending` / markdown-body styling precedent; no new primitives. |
| III. Progressive degradation (no server assumption) | PASS | Containment + deterministic repair are fully offline; fix action requires only a configured provider (same as any chat send) and is hidden when no handler/provider. |
| III. Expound raw-offset discipline | PASS | Error block/badge/original-source view added to `EXCLUDED_CHROME_SELECTORS`; no new offset logic; stored content untouched, so existing offsets stay valid. This also repairs a discovered defect (current failure `<p>` degrades alignment). |
| IV. Performance measured for perf-sensitive changes | PASS (N/A-level) | No new dependencies, no new render passes; repair is post-failure string work only. Valid-diagram path unchanged. Perf probe not indicated; will spot-check with `__MAYON_PERF__` if render timing questions arise. |
| IV. Bundle growth justified | PASS | Zero new dependencies. |
| Deviation from documented seams requires amendment | PASS | No seam deviations; `docs/reference/tool-map.qmd` not affected (no agent/MCP tool changes). |

No violations → Complexity Tracking table not needed.

## Project Structure

### Documentation (this feature)

```text
specs/028-mermaid-error-repair/
├── plan.md              # This file
├── research.md          # Phase 0 output — pipeline findings + design decisions
├── data-model.md        # Phase 1 output — ephemeral render-outcome model, DOM dataset contract
├── quickstart.md        # Phase 1 output — dev-stack validation scenarios
├── contracts/
│   ├── render-pipeline.md   # render/repair seam contract (both Markdown passes)
│   └── fix-affordance.md    # in-conversation fix-action contract
└── tasks.md             # Phase 2 output ($speckit-tasks — NOT created by this command)
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── markdown/
│   │   ├── mermaid.ts               # + suppressErrorRendering; repair seam at renderMermaidBlock
│   │   ├── mermaid-repair.ts        # NEW: pure deterministic source repair (idempotent)
│   │   └── mermaid-repair.test.ts   # NEW: fault-corpus unit tests (spec example included)
│   ├── chat/
│   │   └── selection.ts             # EXCLUDED_CHROME_SELECTORS += mermaid error/badge/source nodes
│   └── components/
│       └── chat/
│           ├── Markdown.svelte      # contained error block (both passes), repaired badge,
│           │                        #   original-source disclosure, optional fix-action callback prop
│           └── rows/
│               └── AssistantMessage.svelte  # wires fix-action callback → chatStore.send
└── (no server/, packages/, or schema changes)
```

**Structure Decision**: single-repo feature work confined to the markdown render seam and its consumers; the only new module is the pure `mermaid-repair.ts`, placed beside `mermaid.ts` in `src/lib/markdown/` so the repair logic is testable without DOM and shared by every `<Markdown>` consumer (chat, labs, quizzes) for free.

## Complexity Tracking

> None — no Constitution violations to justify.
