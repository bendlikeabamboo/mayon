# Implementation Plan: Provider Request Settings

**Branch**: `009-provider-request-settings` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-provider-request-settings/spec.md`

## Summary

Replace the stale GLM-only reasoning mapping (`providerOptionsForReasoning`) with a
static dialect table + pure layered resolver (`src/lib/ai/dialects.ts`) that produces
`{ callSettings, providerOptions, droppedExtraKeys }` for all four model-call paths
(chat, critic, lab/quiz, title), and add two optional user fields to `ProviderConfig`:
`requestDefaults` (seven standard sampling params, omit-empty) and `extraBody` (raw
JSON passthrough, validated, merged last). Research resolved two latent defects the
implementation must fix en route: the openai-compatible providerOptions namespace key
must mirror the SDK (`name.split('.')[0].trim()`, case-preserved — current lowercasing
silently drops all reasoning params for template-created providers) and Gemini
`thinkingConfig` must sit at the namespace root (current `generationConfig` nesting is
zod-stripped). The generic openai-compatible baseline invents no parameters. Settings
gains a per-provider "Advanced" section (sampling inputs, extraBody editor with
validation + dropped-keys warnings, live resolved-request preview) and the request
trace gains `callSettings`/providerOptions rendering so everything is verifiable
end-to-end.

## Technical Context

**Language/Version**: TypeScript on Node 22 (`.nvmrc`), SvelteKit + Svelte 5 runes SPA.

**Primary Dependencies**: AI SDK v7 (`ai`, `@ai-sdk/openai-compatible`,
`@ai-sdk/anthropic`, `@ai-sdk/google`, `ollama-ai-provider-v2`) — call settings +
providerOptions mechanics verified in installed sources (research.md R1); Tailwind v4
CSS-first + shadcn-svelte (bits-ui) `Collapsible`; no new dependencies.

**Storage**: existing settings KV row `'providers'` (`{[id]: ProviderConfig}`) via
`repos.settings` / `saveProviders`. No drizzle migration; both new `ProviderConfig`
fields are optional/additive. Trace storage (`agent_traces.trace` JSON) gains additive
fields only.

**Testing**: Vitest, colocated `*.test.ts` — new `src/lib/ai/dialects.test.ts`
supersedes `sdk-factory.test.ts` reasoning describes; UI verified via `pnpm check` +
manual smoke on `pnpm dev` (constitution III).

**Target Platform**: browser SPA (static adapter) + Node server container (unchanged).

**Project Type**: web app (SvelteKit SPA + server).

**Performance Goals**: resolver is a tiny pure function (table lookups + shallow
merges) on the request path; no measurable latency impact. No bundle growth beyond one
small module + UI section.

**Constraints**: no secrets in settings (constitution I — extraBody validation
enforces); omit-empty wire semantics (OpenRouter cache keys); resolver MUST be pure
(preview reuses it); API keys stay in IndexedDB/keychain flow, untouched.

**Scale/Scope**: ~10 dialect/endpoint entries + ~12 model overlays (static data); 4
call sites rewired; 1 settings UI section; trace + diagnostics rendering.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                                                                     | Status              | How satisfied                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I. Layering — app code calls repositories only; `db` private to `src/lib/db/` | PASS                | Resolver/dialects are pure lib code (no storage imports); UI persists through the existing `saveProviders` → `repos.settings` path. No new storage access.                                                         |
| I. No secrets in `settings`                                                   | PASS                | `validateExtraBody` structurally rejects secret-like keys (`authorization`, `api[-_]key`, `headers`, …) before persist; API-key flow untouched. FR-013.                                                            |
| I. Toolchain pins (Node 22, pnpm 10)                                          | PASS                | No new toolchain, no new dependencies.                                                                                                                                                                             |
| I. SvelteKit `+` prefix rule                                                  | PASS                | New files: `dialects.ts`, `dialects.test.ts` — no leading `+`.                                                                                                                                                     |
| II. Tests for new `src/lib` behavior                                          | PASS                | `dialects.test.ts` covers layer precedence, router prefixes, nsKey regression, every catalog entry, omit-empty, validation, dropped-keys, metadata. Bug fixes carry regression tests (nsKey case, Gemini nesting). |
| II. `pnpm check` / `pnpm lint` / `pnpm test` gates                            | PASS (planned)      | Listed as merge blockers in quickstart.md §1.                                                                                                                                                                      |
| III. UI from existing Tailwind v4 + shadcn-svelte vocabulary                  | PASS                | `Collapsible` + existing raw-input/`inputClass` form pattern; no new primitives, no new deps.                                                                                                                      |
| III. Progressive degradation (no server assumption)                           | PASS                | Feature is client-side request construction; no new server capability.                                                                                                                                             |
| IV. Bundle growth justified                                                   | PASS                | One small static-data module + one settings section; no heavy dependencies adopted.                                                                                                                                |
| Deviating from documented seams requires amendment                            | PASS (no deviation) | Uses existing seams: settings KV, AI SDK call settings/providerOptions channels, trace builder. No seam changes.                                                                                                   |

Post-Phase-1 re-check: contracts (request-settings-resolution, dialect-catalog,
settings-advanced-ui) introduce no new boundaries and respect the
`StorageDriver`/repository seam — still PASS.

## Project Structure

### Documentation (this feature)

```text
specs/009-provider-request-settings/
├── plan.md                        # This file
├── spec.md                        # Feature specification
├── research.md                    # Phase 0: R1–R12 decisions + risk register
├── data-model.md                  # Phase 1: entities, validation, compatibility
├── quickstart.md                  # Phase 1: validation guide
├── contracts/
│   ├── request-settings-resolution.md   # resolver algorithm, namespaces, merge rules
│   ├── dialect-catalog.md               # static dialect/overlay tables + hazards
│   └── settings-advanced-ui.md          # Advanced UI + chat UI + trace surface
└── tasks.md                       # Phase 2 output (/speckit.tasks — NOT created yet)
```

### Source Code (repository root)

```text
src/lib/ai/
├── types.ts                       # + requestDefaults?, + extraBody? on ProviderConfig
│                                  #   + SamplingRequestDefaults / ResolvedRequestSettings types
├── dialects.ts                    # NEW: static dialect catalog + resolveRequestSettings
│                                  #      + describeDialect + validateExtraBody + namespaceKeyFor
├── dialects.test.ts               # NEW: resolver/catalog/validation unit tests
├── sdk-factory.ts                 # − providerOptionsForReasoning, − supportsReasoningEffort
├── sdk-factory.test.ts            # reasoning describes removed (superseded)
├── client.ts                      # unchanged (saveProviders already persists whole config)
├── registry.ts                    # unchanged (templates never set new fields)
└── generate/
    ├── object-tool.ts             # + optional requestSettings → generateText params + trace
    ├── generate-title.ts          # + optional requestSettings (caller pins effort 'off')
    ├── generate.ts                # thread requestSettings (lab)
    └── generate-quiz.ts           # thread requestSettings (quiz)

src/lib/agent/
├── loop.ts                        # chat + critic resolve via dialects; callSettings spread;
│                                  #   effort ambient for both; trace callSettings
└── trace.ts                       # 'request' event +callSettings; object trace
                                   #   +providerOptions/callSettings (additive)

src/lib/stores/
├── chat.svelte.ts                 # title call resolves with effort 'off'; passes requestSettings
├── labs.svelte.ts                 # ambient effort ('reasoningEffort' KV, default 'on') → resolver
└── quizzes.svelte.ts              # same as labs

src/lib/components/
├── ai/ProviderConfig.svelte       # per-provider Advanced section (Collapsible): sampling
│                                  #   inputs, extraBody editor + validation + dropped-keys
│                                  #   warning, resolved-request preview (real resolver)
└── diagnostics/DiagnosticsPanel.svelte  # render providerOptions + callSettings in request block

src/routes/chat/[id]/+page.svelte  # supportsDeep ← describeDialect(...).effortLevels
```

**Structure Decision**: single-project SvelteKit layout (existing); all changes are
additive inside `src/lib/ai`, `src/lib/agent`, `src/lib/stores`, and two component
files. No new top-level directories, no schema/migration directories touched.

## Complexity Tracking

No constitution violations — table intentionally empty (template guidance: fill only
when violations must be justified).
