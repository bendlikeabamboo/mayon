# Research — AI Elements Adoption (Phase 0)

**Date**: 2026-08-21 · Resolves all Technical Context unknowns for [plan.md](./plan.md)

Sources inspected: live registry JSON (`https://svelte-ai-elements.vercel.app/r/*.json`
— file lists, deps, and source of `model-selector`, `confirmation`, `tool`), the
shadcn-svelte registry (`command`, `alert`, `badge`, `collapsible`), our components
(`ModelSelect.svelte`, `ElicitationDialog.svelte`, `SamplingApprovalCard.svelte`,
`ToolActivity.svelte`, `ToolResultBody.svelte`), and `research/002-svelte-ui-components.md`.

---

## D1. Donor selection — which blocks, which files

**Decision**: adopt `model-selector`, `confirmation`, and `tool` from the Svelte AI
Elements registry, **file-trimmed**, as first-party code under
`src/lib/components/{ai/model-select,mcp/confirmation}` and inside the tool row.

**Rationale**: these are the three donor families the spec's stories map onto; each is
thin composition over bits-ui primitives (the donor files are mostly 300–900 byte
wrappers), which is exactly our stack. Trimming plan:

| Donor family          | Files kept                                                                              | Files dropped                                                           |
| --------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `model-selector` (15) | trigger, dialog, content, input, list, item, empty, group, separator, name, index (~11) | `logo`, `logo-group`, `shortcut` (provider logos + ⌘K hint — unused)    |
| `confirmation` (9)    | all 9 (context, root, request, title, action(s), accepted, rejected, index)             | — (small family; states are the point)                                  |
| `tool` (6)            | port header/content/input/output structure into our row; **not** a verbatim copy        | donor `context` auto-open behavior (see D3); `./code.json` dep (see D4) |

**Alternatives considered**: verbatim full-family copies (more dead code to own —
rejected per SC-001); keeping our UI and only restyling (no convergence, keeps bespoke
a11y bugs — rejected); adopting more blocks (`reasoning`, `suggestion`, `task` — out of
scope per spec Assumptions).

## D2. Zero-new-packages — the `runed` question

**Decision**: do **not** add `runed` to the dependency manifest. Both donor usages are
replaced with native Svelte 5 runes:

1. `confirmation.svelte` — `watch(() => approval, …)` re-sets context on prop change.
   Replace with a `$derived` context object passed to `setContext` (context values can
   be reactive references; the donor's commented-out code shows they intended exactly
   this) or a component-level `$effect`. ~5 lines.
2. `tool` — donor auto-open `watch` is dropped entirely: our rows are
   collapsed-by-default per spec FR-004 and driven by user intent, so auto-open-on-run
   is unwanted behavior, not lost behavior.

**Rationale**: spec FR-008/SC-002 mandate zero new third-party runtime packages;
constitution IV requires bundle-growth justification. Verified usages are trivial.
`runed` remains a _future_ option if a later feature wants it broadly — that would be a
separate, justified decision.

**Alternatives considered**: adding `runed@^0.37` (sub-KB, by the shadcn-svelte author —
still a new manifest entry; rejected); vendoring a `watch` helper (reimplements what
runes already do; rejected).

## D3. Elicitation form retention — confirmation is the chrome, not the form

**Decision**: `ElicitationDialog.svelte` keeps its JSON-schema-driven form body
(field rendering, boolean/number/text inputs, JSON fallback) and adopts the
`confirmation` pattern for chrome: title, request description, actions
(submit/cancel), and terminal states (accepted/rejected) with the shared context state
machine. `SamplingApprovalCard.svelte` becomes a thin instantiation of the same
pattern (request = prompt preview + budget, actions = approve/decline).

**Rationale**: the donor `confirmation` block models approve/reject, not schema forms;
our elicitation form is domain logic (MCP `requestElicitation` JSON-schema) the
community has no equivalent for. Consolidation achieves "one approval pattern" (FR-003)
at the chrome/state layer — the layer where bespoke bugs live — without pretending a
generic block covers MCP elicitation semantics.

**Alternatives considered**: forcing elicitation into pure confirmation (loses required
structured input — rejected); leaving elicitation untouched (fails FR-003 consolidation
— rejected).

## D4. `tool` output rendering — skip the donor `code` block

**Decision**: do not copy the donor `code` block (Shiki-themed). The tool row keeps
`ToolResultBody.svelte` (our shape-driven renderer: `records`, artifacts, etc.) inside
the new collapsible shell. Add shadcn `badge` for status chips instead of hand-rolled
status spans where it improves clarity.

**Rationale**: our `classifyResult`/`result-shape` rendering is richer and already
tested; the donor code block would add a second syntax-highlighting path alongside
highlight.js (constitution III: extend established patterns).

## D5. Vocabulary additions — `command`, `alert`, `badge`, `collapsible`

**Decision**: add the four shadcn-svelte primitives to `src/lib/components/ui/`.
Verified via the shadcn-svelte registry: **all four declare zero npm dependencies**
(`command` composes bits-ui `Command` + our existing `Dialog`). They are copied under
the same first-party model as the donor blocks.

**Rationale**: constitution III mandates the shadcn-svelte vocabulary; `command`
specifically unlocks the picker's free filtering/keyboard nav/a11y (the entire P1
point), and these primitives amortize across future features. Replaces our hand-rolled
listbox (outside-click handler, no arrow-key navigation, no Escape handling —
`ModelSelect.svelte:49-51`).

## D6. LOC / "maintain less" accounting (resolves SC-001 measurement)

**Decision** — two ledgers, defined so the criterion is honest and checkable:

1. **Feature-surface ledger** (the "net custom UI code" of SC-001): replaced baseline =
   `ModelSelect` 124 + `ElicitationDialog` 139 + `SamplingApprovalCard` 35 +
   `ToolActivity` 176 + `ToolResultBody` 59 = **533 lines**. New/rewritten feature
   components (trimmed `model-select/*`, `confirmation/*` + elicitation form,
   `ToolActivity` port) must land **≤ 533 lines** total. Trimming per D1 makes this
   achievable (~470–530 projected).
2. **Vocabulary ledger** (tracked separately): the four `ui/` primitives (~350 lines)
   are reusable library code, not feature code — the same category as the existing
   `button/dialog/dropdown-menu/sheet`. Adding vocabulary is constitutional (III), not
   scope creep.

The **interaction-logic** surface — hand-rolled outside-click, aria listbox wiring,
manual expand/collapse keydown handling, approval pending/state ad-hoc spans — strictly
**decreases** (moved into bits-ui-backed primitives). That, not raw LOC, is the
maintenance risk being retired.

**Alternatives considered**: counting everything in one ledger (would penalize adding
constitutionally-mandated vocabulary; rejected); LOC-only goal without the trim plan
(rejected — verbatim copies would exceed baseline by ~20%).

## D7. Accessibility & keyboard contract for the picker

**Decision**: the picker gets bits-ui `Command` semantics: type-to-filter,
↑/↓ navigation, Enter to select, Escape to dismiss, `combobox`/`listbox` roles, focus
trap in dialog variant. Empty states: "no models yet — configure a provider" (pointing
at settings) and "no matches" (both already partially exist at
`ModelSelect.svelte:117-119`, carried over).

**Rationale**: closes the concrete gaps of the current dropdown (no arrow keys, no
Escape, no focus management) and matches the consensus behavior the spec's P1 story
describes.

## D8. Capability gating & degradation (FR-007)

**Decision**: gating logic does not move. Elicitation/sampling surfaces render only
when the backing runtime capability (`stdio-mcp`) is advertised — the existing
store/capability wiring that feeds these components stays as-is; the donor chrome is
inert without entries. The picker is purely local (configured providers list) and
works without the server, exactly as today.

---

## Constitution re-check after design (Phase 1 gate)

- III vocabulary: strengthened (D5). III expound invariant: no file in the markdown /
  selection / sourcemap path is touched; expound test suite is the regression guard
  (plan requires it green — SC-004). III degradation: preserved (D8).
- IV bundle: zero new npm deps (D2, D5); compiled additions are small Svelte components.
- II tests: new logic (confirmation state machine, picker filtering, tool status
  mapping) gets Vitest coverage; presentation via `pnpm check` + dev-stack smoke.
- No violations; Complexity Tracking table stays empty.
