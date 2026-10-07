# Implementation Plan: LLM Context-Remaining Indicator

**Branch**: `023-llm-context-remaining` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/023-llm-context-remaining/spec.md`

## Summary

Show the user, at a glance in the chat view, how much of the active model's context window remains for the current conversation. Provider-reported token usage (already emitted per turn by the agent loop but currently dropped) is persisted onto the turn's final assistant message using existing, currently-unpopulated schema fields (`messages.tokens` + `messages.metadata`) — no migration. A pure derivation turns (usage anchor, model id, provider config) into a gauge value with provenance and warning state, rendered by a compact indicator in the Composer's existing status row next to `provider · model`. Context-window size resolves through a chain: user-declared per-provider field → existing `estimateContextLimit` catalog (fixed to strip router prefixes) → unknown (consumption shown, no invented denominator). Estimation (chars/4 heuristic over the assembled provider context) covers fresh chats and silent providers, always visibly marked.

## Technical Context

**Language/Version**: TypeScript 5 on SvelteKit 2 / Svelte 5 runes (SPA, `@sveltejs/adapter-static`), Node 22, pnpm 10.

**Primary Dependencies**: existing only — AI SDK stream (`usage` on the `finish` part, already consumed in `src/lib/agent/loop.ts:181-186`), drizzle + shared schema, Tailwind v4 + shadcn-svelte (`badge`, `popover`), `@lucide/svelte`. **Zero new npm dependencies.**

**Storage**: Postgres via drizzle. Uses existing columns only: `messages.tokens` (integer, nullable, `schema.ts:101` — declared, never written) and `messages.metadata` (JSON, `schema.ts:104`). **No migration required.**

**Testing**: Vitest with the pglite test driver (`pnpm test`). Logic tests for the pure derivation; repo test for the new `recordUsage`; source-contract tests (readFileSync + string assertions, per `Composer.launchers.test.ts` pattern) for the indicator component; store integration test in `chat.svelte.test.ts` proving usage persistence via the mock LLM (`tests/fixtures/mock-llm/server.mjs` reports `{1,1,2}` on every reply).

**Target Platform**: browser SPA (web container), unchanged server.

**Project Type**: web app (SPA + Node server).

**Performance Goals**: gauge recompute is O(messages-scanned-backward) on discrete events only (turn completion, chat/model/branch switch) — never per keystroke or per stream chunk. No measurable impact on frame timing (perf probe if any render-path regression is suspected).

**Constraints**: no new dependencies (constitution IV bundle-growth gate); no drizzle migration; indicator must not block composing/sending; app-layer code touches storage only through repositories.

**Scale/Scope**: single-user local deployment; chats with hundreds of messages; one global active provider/model (no per-chat override exists — `ChatStreamOptions.model` is dead code).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Gate (from `.specify/memory/constitution.md`) | Pre-design | Post-design |
|---|---|---|---|
| 1 | Layering: components/stores call repositories only; no direct `db` imports outside `src/lib/db/` | PASS — new UI reads via `repos.messages` / derived store state; new repo method `recordUsage` lives in `src/lib/db/repositories/messages.ts` | PASS — confirmed in [data-model.md](./data-model.md) |
| 2 | `StorageDriver` remains the only storage seam; repositories own query logic | PASS — single-row UPDATE inside messages repo | PASS |
| 3 | Quality gates `pnpm check` / `pnpm lint` / `pnpm test` | PASS — plan includes all three in quickstart | PASS |
| 4 | No secrets in `settings`; provider config holds non-secret handle fields only | PASS — new `contextWindow` field is a non-secret handle, additive-optional via `normalizeProviderConfig` (established pattern) | PASS |
| 5 | SvelteKit `+` prefix reserved for routing | PASS — colocated `<ComponentName>.<facet>.test.ts` naming follows convention | PASS |
| 6 | Tests accompany new behavior in `src/lib/` | PASS — logic, repo, source-contract, and store-integration tests planned | PASS — enumerated in [quickstart.md](./quickstart.md) |
| 7 | UI composed from existing Tailwind v4 + shadcn-svelte vocabulary | PASS — mounts in existing Composer status row; reuses `text-muted-foreground` idiom, `popover`, `.tip` | PASS — see [contracts/context-gauge.md](./contracts/context-gauge.md) |
| 8 | Progressive degradation; UI must not assume server features beyond existing pg capability | PASS — degrades to estimate-only (no usage) and unknown-window (no limit) states | PASS |
| 9 | Performance claims measured; no unmeasured claims | PASS — recompute is event-driven, O(n) scan; no render-path changes beyond one small element | PASS |
| 10 | SPA bundle growth justified | PASS — zero new dependencies; heuristic estimation (chars/4) instead of a tokenizer library | PASS |
| 11 | Drizzle migrations only via `pnpm db:generate` from schema | PASS (N/A) — no schema change at all | PASS (N/A) |

No violations. No entries in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/023-llm-context-remaining/
├── plan.md              # This file ($speckit-plan command output)
├── research.md          # Phase 0 output ($speckit-plan command)
├── data-model.md        # Phase 1 output ($speckit-plan command)
├── quickstart.md        # Phase 1 output ($speckit-plan command)
├── contracts/           # Phase 1 output ($speckit-plan command)
│   └── context-gauge.md
└── tasks.md             # Phase 2 output ($speckit-tasks command - NOT created by $speckit-plan)
```

### Source Code (repository root)

```text
src/
├── ai/
│   ├── model-limits.ts                  # fix: strip router prefix (last '/' segment) before prefix match
│   ├── model-limits.test.ts             # router-prefix cases
│   ├── registry.ts                      # normalizeProviderConfig: optional contextWindow field
│   └── types.ts                         # ProviderConfig.contextWindow?: number
├── chat/
│   ├── context-usage.ts                 # pure derivation: anchor + window + state → gauge value
│   └── context-usage.test.ts
├── components/
│   ├── ai/ProviderConfig.svelte         # optional "Context window (tokens)" field on provider card
│   └── chat/
│       ├── Composer.svelte              # mount ContextGauge in the provider·model status row
│       ├── ContextGauge.svelte          # the indicator (states + detail popover)
│       └── ContextGauge.contract.test.ts # source-contract test
├── stores/
│   └── chat.svelte.ts                   # capture usage event in send(); recordUsage in finally
└── db/
    ├── chat/kinds.ts                    # SharedMetadata.usage typed field
    └── repositories/messages.ts         # recordUsage(messageId, usage)
```

**Structure Decision**: single-project SPA layout — all work lands in the existing `src/lib` application layer plus one repo method; no new packages, no server changes, no new routes.

## Complexity Tracking

No constitution violations to justify; section intentionally empty.
