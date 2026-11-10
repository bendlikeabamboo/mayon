# Migration Ledger: Source-Text Tests

**Feature**: `032-test-suite-tiering` | **Created**: 2026-11-10

This ledger classifies every existing source-text test file (`readFileSync` +
regex/substring assertions) discovered with:

```bash
rg -l "readFileSync" src --glob '*.test.ts'
```

Dispositions follow `contracts/tier-placement.md` and `data-model.md`
(`MigrationLedgerEntry`). Rows start `verified = false` and move to `true` only
when the replacement test fails as its claimed behavior is deliberately broken
(T024/T035). Final state after T034/T035: all **28 `convert` rows are
`verified = true`**. The four non-behavioral rows (1 `retain`, 3
`promote-static`) intentionally remain `verified = false` because they are
static invariants, not runtime behavior tests; see
[Non-runtime rows](#non-runtime-rows).

## Baseline

| Field | Value |
|---|---|
| `baselineTier1Files` | 147 |
| `baselineTier1Tests` | 2357 |
| `baselineTier3Cases` | 37 |
| `playwrightListedTests` | 32 |
| `targetTier3Max` | 18 |
| `finalTier1Files` | 121 (unit project: 120 app files + `scripts/test-capacity.test.ts`) |
| `finalTier1Tests` | 2184 (executed unit-project selection) |
| `finalTier2Files` | 34 |
| `finalTier2Tests` | 131 |
| `finalAllFiles` | 155 (121 unit + 34 browser) |
| `finalAllTests` | 2315 (2184 unit + 131 browser) |
| `playwrightListedAfterT042` | 30 (1 setup + 29 cases) |
| `retainedTier3Cases` | 8 |
| `removedTier3Cases` | 21 |
| `finalPlaywrightListed` | 9 (1 setup + 8 cases) |

`playwrightListedTests` was measured with `pnpm exec playwright test --list`
(list-only, no browsers): **32 tests in 10 files**. This is lower than the
historical `baselineTier3Cases = 37` recorded in `spec.md`; both are kept so the
final pruning count can be reconciled against either figure. T042 retired the
two-case telemetry spec, leaving 30 listed (setup + 29 cases) before the T043–T045
pruning. After pruning: 9 listed (setup + 8 cases), a 72% reduction of the 29
post-T042 cases.

## Tier 3 pruning ledger (T043–T045)

Every Playwright case removed by T043–T045 is recorded here with its lower-tier
replacement or retirement rationale. Retained cases are listed first; the
removed-case table follows.

### Retained cases (8 + setup)

| Spec | Case | Why it must stay end-to-end |
|---|---|---|
| `global-setup.ts` | `capture shared session state` | First-run/auth handshake, provider seeding, and storage-state capture run once per invocation. |
| `onboard.spec.ts` | `onboards the mock provider and completes a deterministic round trip` | Real browser → server proxy → mock provider streaming, live-to-durable handoff, and persisted reply. |
| `render.spec.ts` | `renders markdown structure from the deterministic reply` | Real streamed markdown from the real server, not a component fixture. |
| `render.spec.ts` | `renders the mermaid fence as a diagram` | Real streamed mermaid fence rendered to SVG in the real message pipeline. |
| `render.spec.ts` | `maps a selection to known raw offsets through the expound path` | Real browser selection + DOM alignment + persisted `branch_sources` row. |
| `quiz.spec.ts` | `generates a quiz from the deterministic reply and answers every question type` | Real proxy `quiz_generation`, grading, attempt persistence, and results screen. |
| `lab.spec.ts` | `generates a lab from the deterministic reply and steps it to completion` | Real proxy `lab_generation` plus checklist persistence across reload. |
| `backprop-tool.spec.ts` | `branch trigger streams a propagate_to_parent tool call; approval lands the artifact in the parent` | Real streaming, tool approval, continuation, branch, and parent artifact. |
| `image-round-trip.spec.ts` | `streamed image reply shows live marker then placeholder, finalizes to a durable image…` | Live image part, finalize/persist handoff, one classified proxy request, reload redisplay. |

### Removed cases (21)

| # | Spec | Case | Disposition | Replacement / rationale |
|---|---|---|---|---|
| 1 | `provider-picker.spec.ts` | `shows the four groups in order` | migrate | `src/lib/components/ai/provider-template-picker.browser.test.ts` |
| 2 | `provider-picker.spec.ts` | `search matches across groups and hides empty groups` | migrate | `src/lib/components/ai/provider-template-picker.browser.test.ts` |
| 3 | `provider-picker.spec.ts` | `shows an empty state with a clear action when nothing matches` | migrate | `src/lib/components/ai/provider-template-picker.browser.test.ts` |
| 4 | `provider-picker.spec.ts` | `clearing the search restores every group` | migrate | `src/lib/components/ai/provider-template-picker.browser.test.ts` |
| 5 | `provider-picker.spec.ts` | `Enabled default renders the option pair with its hint, flips to Disabled, and the state persists` | migrate | `src/lib/components/ai/ProviderConfig.browser.test.ts` (options/hint/flip/persist) + `src/lib/agent/capability.test.ts` (legacy `auto` normalization) |
| 6 | `provider-picker.spec.ts` | `dead port classifies as Server not running with a start-the-server remedy` | migrate | `src/lib/components/ai/ProviderConfig.browser.test.ts` (status copy render) + `src/lib/ai/connection-test.test.ts` (classification) |
| 7 | `provider-picker.spec.ts` | `live endpoint reports Connection OK with the discovered model count` | migrate | `src/lib/components/ai/ProviderConfig.browser.test.ts` (status + catalog merge) + `src/lib/ai/model-discovery.test.ts` |
| 8 | `render.spec.ts` | `renders inline and display math as KaTeX` | migrate | `src/lib/components/chat/Markdown.render.browser.test.ts` |
| 9 | `render.spec.ts` | `re-renders the mermaid diagram when the theme flips to dark` | migrate | `src/lib/components/chat/Markdown.render.browser.test.ts` |
| 10 | `render.spec.ts` | `gives every code block a working copy affordance` | migrate | `src/lib/components/chat/Markdown.render.browser.test.ts` (button + clipboard payload) |
| 11 | `quiz.spec.ts` | `the grading lever grades a wrong answer as incorrect on a fresh attempt` | migrate | `src/lib/ai/generate/generate-quiz.test.ts` (grading contract) + `src/lib/stores/quizzes.svelte.test.ts` (attempt state) |
| 12 | `onboard.spec.ts` | `discovers the mock catalog through the proxy` | migrate | `src/lib/components/ai/ProviderConfig.browser.test.ts` (refresh + merge) + `src/lib/ai/model-discovery.test.ts` (parsing) |
| 13 | `onboard.spec.ts` | `connects LM Studio as a keyless local provider` | migrate | `src/lib/components/ai/ProviderConfig.browser.test.ts` (keyless local, Test connection, catalog merge) |
| 14 | `prompt-contract.spec.ts` | `quiz prompt: contract is viewable and read-only; instructions persist` | migrate | `src/lib/components/generation/GenerationPromptConfig.browser.test.ts` (contract region, one editor, save/preview/persist) |
| 15 | `prompt-contract.spec.ts` | `lab prompt: contract is viewable and read-only; instructions persist` | migrate | `src/lib/components/generation/GenerationPromptConfig.browser.test.ts` + `src/lib/ai/generate/generate.test.ts` (system-prompt assembly) |
| 16 | `backprop-tool.spec.ts` | `completion signal gets one plain offer and never propagates` | migrate | `src/lib/chat/backprop-endstate.test.ts` (offer-turn end state) |
| 17 | `backprop-tool.spec.ts` | `declined propagation never runs and is never re-requested` | migrate | `src/lib/chat/backprop-endstate.test.ts` (declined-turn end state) |
| 18 | `backprop-tool.spec.ts` | `root trigger never offers propagation and points at the manual control` | migrate | `src/lib/chat/backprop-endstate.test.ts` (root-trigger end state) |
| 19 | `mock-classification.spec.ts` | `chat round trip still streams the kitchen-sink reply` | retire | Duplicate of the retained `onboard.spec.ts` round trip; streaming compatibility needs no second full journey. |
| 20 | `mock-classification.spec.ts` | `quiz generation serves the quiz fixture and the grading lever flips both ways` | retire | Duplicate of the retained `quiz.spec.ts` journey; wrong-branch grading is Tier 1 (`generate-quiz.test.ts`, `quizzes.svelte.test.ts`). |
| 21 | `mock-classification.spec.ts` | `lab generation serves the lab fixture` | retire | Duplicate of the retained `lab.spec.ts` journey (which adds checklist persistence). |

Isolation: each retained spec is independently executable. Chats are created
per test (`tests/e2e/fixtures/session.ts` → `createChat`), provider ids are
worker-scoped when created, and the seeded shared provider is read-only (no
retained spec mutates provider settings). No retained spec owns a host port or
cross-spec row.

## Summary

| Disposition | Count |
|---|---|
| `convert` | 28 |
| `promote-static` | 3 |
| `retain` | 1 |
| `delete` | 0 |
| **Total** | **32** |

`promote-static` rows name a destination under the named static-invariant check
introduced by T020 (`scripts/check-static-invariants.mjs`), matching the
`guardrails.md` "Static invariants promoted from source-text tests" table.

## Entries

| # | sourceFile | subject | claimedBehavior | disposition | replacementPath | rationale | verified |
|---|---|---|---|---|---|---|---|
| 1 | `src/lib/ai/generate/classification-markers.test.ts` | Mock-LLM classification markers and fixture strings vs. product constants | Markers stay pinned to the quiz/lab contracts, grading tool description, and brief prompt; fixture strings are single-sourced in `server.mjs` and re-exported by `kitchen-sink.ts` | `retain` | — | Genuine static drift invariant, not a component-behavior claim, and already named for that invariant. It stays in Tier 1; T020 may fold it into the named invariant check later. | false |
| 2 | `src/lib/chat/streaming/pacer.contract.test.ts` | `chat.svelte.ts` pacer perf instrumentation | Paced flush is wrapped in `mark('pacing:flush')` and the pacer reports `incRender('Pacer')` | `promote-static` | `scripts/check-static-invariants.mjs#perf-marks` | Source-only instrumentation assertion with no user-observable behavior; `pacer.test.ts` covers pacing behavior but not these marks. | false |
| 3 | `src/lib/components/ai/model-select/model-select.select.test.ts` | `ModelSelect` / `ModelSelectItem` prop wiring and `formatContextWindow` | `onselect` maps to bits-ui `onSelect`; the context-window hint renders only for known windows; component stays presentational; `formatContextWindow` formats 128K/1M/1.5M/raw | `convert` | `src/lib/components/ai/model-select/model-select.browser.test.ts` | Prop wiring and hint rendering are observable in a browser; the pure `formatContextWindow` cases are already Tier 1 and should be split into a colocated unit file. | true |
| 4 | `src/lib/components/AppShell.drawer-nav.test.ts` | `AppShell` mobile drawer navigation | Shared `Sidebar` renders inside the left sheet, closes on nav click, keeps active-pill styling, and preserves 40/36px hit targets | `convert` | `src/lib/components/AppShell.browser.test.ts` | Rendering, click-to-close, and hit-target behavior require a real DOM; T026 conversion target. | true |
| 5 | `src/lib/components/chat/Breadcrumb.render.test.ts` | `Breadcrumb` truncation and narrow collapse | Single-line nav with truncation; middle ancestors collapse to `…` below `sm`; root stays a link and current entry renders in both variants | `convert` | `src/lib/components/chat/Breadcrumb.browser.test.ts` | Observable responsive rendering; T027 conversion target. | true |
| 6 | `src/lib/components/chat/Composer.launchers.test.ts` | `Composer` launcher cards and footer compaction | Branch/quiz/lab launchers render, use `aria-disabled` no-op guards, sit inside the surface card, and compact below `sm` | `convert` | `src/lib/components/chat/Composer.browser.test.ts` | Launcher presence, disabled clicks, and responsive compaction are rendered behavior; T027 conversion target. | true |
| 7 | `src/lib/components/chat/ContextGauge.contract.test.ts` | `ContextGauge` wiring, escalation, and detail popover | Gauge mounts in the Composer status row, renders nothing when null, escalates low/critical tone, announces critical state, and shows contract rows in a popover | `convert` | `src/lib/components/chat/ContextGauge.browser.test.ts` | State-driven tone, ARIA status, and popover content are observable; T027 conversion target. | true |
| 8 | `src/lib/components/chat/GrowthEdge.contract.test.ts` | `GrowthEdge` overlay and live-branch mounting | Overlay never intercepts pointers, uses the z-10 rung, reports renders, honors reduced motion, and mounts only in the live branch with `variant`/`buffer`/`lifting` props | `convert` | `src/lib/components/chat/GrowthEdge.browser.test.ts` | Mounting branch and pointer behavior are rendered/DOM concerns; T027 conversion target. | true |
| 9 | `src/lib/components/chat/interactivity.test.ts` | Composer/ChoicesOffer/MessageList interactivity regression | Composer has no suggestion chips or gate progress; `ChoicesOffer` wires option clicks to `onSelect`; `MessageList` derives the active gate and passes `onSelect` | `convert` | `src/lib/components/chat/interactivity.browser.test.ts` | Clicking a choice and observing the gate is behavior; the "must not contain" checks fold into the rendered assertions; T028 conversion target. | true |
| 10 | `src/lib/components/chat/Markdown.touch.test.ts` | `Markdown` coarse-pointer affordances | Copy button stays visible on coarse pointers, table-focus trigger grows to 2rem, and wide tables scroll horizontally | `convert` | `src/lib/components/chat/Markdown.touch.browser.test.ts` | Requires rendering under a coarse-pointer media emulation to observe the affordance; T028 conversion target. | true |
| 11 | `src/lib/components/chat/MessageRow.mount.test.ts` | `TimelineRow` render instrumentation and `LazyMount` rootMargin | A row renderer calls `incRender('TimelineRow')` in `onMount`; `MessageList` passes `rootMargin="1200px"` to `LazyMount` | `promote-static` | `scripts/check-static-invariants.mjs#render-instrumentation` | Static perf-instrumentation contract with no directly observable user behavior; `guardrails.md` explicitly routes render instrumentation to a named check or deletion. | false |
| 12 | `src/lib/components/chat/PropagatedArtifact.test.ts` | `PropagatedArtifact` and `MessageList` wiring | `branch_artifact` maps to `PropagatedArtifact` with store-backed handlers; the strip labels source/mode, gates the derived anchor, expands payload, and confirms regenerate/delete | `convert` | `src/lib/components/chat/PropagatedArtifact.browser.test.ts` | Handler wiring, expansion, and confirmation are interactive behavior; T027 conversion target. | true |
| 13 | `src/lib/components/chat/rows/AssistantMessage.actions.test.ts` | `AssistantMessage` hover-revealed action row | Copy/branch/regenerate expose accessible labels, reveal on hover/focus-within, stay inert while hidden, honor reduced motion, and gate regenerate to the newest turn | `convert` | `src/lib/components/chat/rows/AssistantMessage.actions.browser.test.ts` | Accessible labels and reveal/inert behavior are rendered interaction; T029 conversion target. | true |
| 14 | `src/lib/components/chat/rows/AssistantMessage.spinner.test.ts` | `AssistantMessage` live-only spinner | Orbit spinner and `Thinking…` pulse render only for live items, never durable rows | `convert` | `src/lib/components/chat/rows/AssistantMessage.spinner.browser.test.ts` | Live-vs-durable rendering is observable; T029 conversion target. | true |
| 15 | `src/lib/components/chat/rows/AssistantMessage.strip.test.ts` | `AssistantMessage` section strip eligibility | Strip renders only on the durable branch, derives sections from displayed markdown, gates on section count plus height, disconnects `ResizeObserver`, and threads `onJumpToSection`/`stripEnabled` | `convert` | `src/lib/components/chat/rows/AssistantMessage.strip.browser.test.ts` | Eligibility and teardown are rendered behavior; T029 conversion target. | true |
| 16 | `src/lib/components/chat/rows/ToolActivity.collapse.test.ts` | `ToolActivity` collapse behavior | `TOOL_SUMMARY_THRESHOLD` is 160; every entry with content uses `Collapsible`, the header is a trigger, no Show/Hide control exists, and the body delegates to `ToolResultBody` | `convert` | `src/lib/components/chat/rows/ToolActivity.collapse.browser.test.ts` | Expand/collapse and bounded body are interactive; the constant assertion remains a Tier 1 unit check; T029 conversion target. | true |
| 17 | `src/lib/components/chat/rows/ToolActivity.status.test.ts` | `ToolActivity` status presentation | Awaiting/failed/declined/aborted/running/gap states render distinct icons/labels, `No result recorded` only for gaps, and status derives from `tool-status.ts` | `convert` | `src/lib/components/chat/rows/ToolActivity.status.browser.test.ts` | Status-to-UI mapping is rendered output; T029 conversion target. | true |
| 18 | `src/lib/components/chat/rows/ToolActivity.terminal.test.ts` | `ToolActivity` terminal presentation | Terminal classification comes from the tool registry, terminal status uses the neutral `Circle` glyph, and unpaired non-terminal calls keep `XCircle` | `convert` | `src/lib/components/chat/rows/ToolActivity.terminal.browser.test.ts` | Registry-driven glyph mapping is observable in the rendered row; T029 conversion target. | true |
| 19 | `src/lib/components/chat/rows/ToolResultBody.test.ts` | `ToolResultBody` shape rendering | Records/markdown/json/text shapes render bounded containers, cards link externally and cap at `MAX_CARDS`, and no raw HTML is injected | `convert` | `src/lib/components/chat/rows/ToolResultBody.browser.test.ts` | Shape-to-markup output and link targets are rendered behavior; T029 conversion target. | true |
| 20 | `src/lib/components/chat/strip/SectionStrip.contract.test.ts` | `SectionStrip` pointer, motion, and touch contract | Navigation landmark, no self-scroll, no wheel/touch handlers, inert overlay with active bars, reduced motion, coarse-pointer matchMedia, dwell preview, and tooltip semantics | `convert` | `src/lib/components/chat/strip/SectionStrip.browser.test.ts` | Pointer/dwell interaction and accessibility semantics are rendered behavior; T028/T031 conversion target. | true |
| 21 | `src/lib/components/diagnostics/DiagnosticsPanel.keys.test.ts` | `DiagnosticsPanel` keyed loops | `mcpEvents`, `liveParts`, and `partSequence` keys are position-qualified so repeated events do not collide | `convert` | `src/lib/components/diagnostics/DiagnosticsPanel.keys.browser.test.ts` | The claim is that repeated events render without key collisions, which a browser test can observe directly; T030 conversion target. | true |
| 22 | `src/lib/components/diagnostics/DiagnosticsPanel.render.test.ts` | `DiagnosticsPanel` mobile sheet layout | Sheet fills narrow screens, caps at 540px on `sm+`, overrides base width classes, and wraps the header row | `convert` | `src/lib/components/diagnostics/DiagnosticsPanel.render.browser.test.ts` | Responsive sheet sizing is rendered behavior; T030 conversion target. | true |
| 23 | `src/lib/components/RowCard.anatomy.test.ts` | `RowCard` anatomy and adoption sites | Surface-card recipe, hover tint, link-vs-static rendering, fixed slot order, truncation, hover-revealed action, coarse-pointer action, compact variant, and list adoption | `convert` | `src/lib/components/RowCard.browser.test.ts` | Link/static branching and hover/coarse behavior are rendered; T026 conversion target. | true |
| 24 | `src/lib/components/settings/ChatDisplayConfig.render.test.ts` | `ChatDisplayConfig` streaming-look select | Labeled native select bound over preset options, optimistic save with revert, mount load, and helper text per preset | `convert` | `src/lib/components/settings/ChatDisplayConfig.browser.test.ts` | Select binding and optimistic revert are interactive behavior; T030 conversion target. | true |
| 25 | `src/lib/components/settings/MobileSectionJump.render.test.ts` | `MobileSectionJump` bottom sheet | Self-gates below `xl`, opens a bottom sheet, labels trigger/nav, delegates `onJump` once after closing, and has no scroll/history side effects | `convert` | `src/lib/components/settings/MobileSectionJump.browser.test.ts` | Sheet opening and jump delegation are interactive; T030 conversion target. | true |
| 26 | `src/lib/components/settings/SettingsRail.render.test.ts` | `SettingsRail` and settings page orchestration | Nav landmark, `aria-current` active entry, prop-order buttons, delegated jumps, `xl` visibility, scroll-spy history behavior, reduced-motion scrolling, and column layout | `convert` | `src/lib/components/settings/SettingsRail.browser.test.ts` | Active-state and jump/history behavior need a rendered page; T030 conversion target. | true |
| 27 | `src/lib/components/settings/SettingsSearch.test.ts` | `SettingsSearch` and settings keyboard contract | `matchSections` replaces cmdk filtering, empty text renders, `focus()` is exposed, cmd-K is captured with preventDefault/stopPropagation, and the header snippet mounts the search | `convert` | `src/lib/components/settings/SettingsSearch.browser.test.ts` | Typing, empty state, and cmd-K focus are interactive; T030 conversion target. | true |
| 28 | `src/routes/chat/[id]/image-output-gate.test.ts` | Chat route image-output indication | Route derives `supportsImageOutput(activeConfig, activeModelId)` and passes the result to `Composer` alongside the vision gate | `convert` | `src/routes/chat/[id]/image-output-gate.browser.test.ts` | The pure capability is already covered by `image-output-capability.test.ts`; the remaining prop-passing claim is a rendered route concern; T032 conversion target. T022 removed the duplicate derive/import source assertions, leaving only the Composer prop assertion. | true |
| 29 | `src/routes/chat/[id]/section-jump.contract.test.ts` | Chat route section-jump orchestration | Anchors filter headings inside blockquotes/callouts, a jump releases stick suppression on the next turn, and the landing-flash timer clears on teardown | `convert` | `src/routes/chat/[id]/section-jump.browser.test.ts` | Jump and suppression behavior is observable on the rendered route; T032 conversion target. T022 kept all three assertions: `sections.test.ts` covers markdown extraction exclusions, but the DOM anchor filter and the jump/suppression timing are route-side behavior with no pure equivalent. | true |
| 30 | `src/routes/chat/[id]/visibility-sentinel.test.ts` | Chat route scroll visibility sentinels | The page uses `IntersectionObserver` instead of `updateVisibility` and has no scroll-tied layout reads (`onScroll`) | `promote-static` | `scripts/check-static-invariants.mjs#visibility-sentinel` | Static performance invariant about layout-read strategy, not a rendered behavior; belongs in a named check. T022 extended the check to also reject `updateVisibility`; the source-text file is retired in T034/T021, not now. | false |
| 31 | `src/routes/chat/[id]/vision-gate.test.ts` | Chat route composer vision gate | Route derives `supportsVision(activeConfig, activeModelId)` and passes it to `Composer` alongside `supportsDeep` | `convert` | `src/routes/chat/[id]/vision-gate.browser.test.ts` | The pure capability is already covered by `vision-capability.test.ts`; the remaining prop-passing claim is a rendered route concern; T032 conversion target. T022 removed the duplicate derive/import source assertions, leaving only the Composer prop assertion. | true |
| 32 | `src/routes/tree/tree-page.render.test.ts` | Tree route mobile layout | Reserves top space below `lg`, gives caret buttons a 40px hit area, and keeps the delete button coarse-visible but inert on fine pointers | `convert` | `src/routes/tree/tree-page.browser.test.ts` | Responsive spacing and pointer-reveal behavior are rendered; T032 conversion target. T022 confirmed `convert` with no source change: every assertion is spacing/pointer rendering with no pure equivalent. | true |

## Verification notes

- T016: `server/src/testing/build-app.ts` builds the Fastify app with a migrated
  pglite pool (optional), a shared mutable clock, an optional persisted security
  mode, and a temp auth key; it never starts a listener. It closes the app (and
  with it the pool) and removes its own temp key directory; a migration/build
  failure ends the pool and cleans up. Transport-subject tests `app.listen(...)`
  themselves.
- T017: `auth-cli.test.ts` and `auth-gate.test.ts` now use `app.inject(...)` for
  every non-transport case. The only remaining listeners in `auth-gate.test.ts`
  are the real `app.listen` for websocket-upgrade cases and the real upstream
  `http.createServer` for the LLM proxy streaming test; both carry one-line
  in-test justifications. `auth-cli.test.ts` has no listener.
- T018: audit of `server/src/*.test.ts` found no remaining `fetch(`, direct
  socket, or stray listener usage. Remaining real transports are annotated in
  place: `auth-gate.test.ts` (websocket upgrade twice, proxy upstream server)
  and `mcp.test.ts` (websocket bridge, websocket child cap). Dead imports left by
  the bulk conversion were removed (`node:path`/`__dirname` in
  `auth-gate.test.ts`).
- T019: audit of `src/**/*.test.ts` (excluding `*.browser.test.ts`) for
  browser-mode packages (`vitest-browser-svelte`, `@vitest/browser/*`,
  Playwright, `tests/browser/*`, `@testing-library/*`) found **zero offenders**;
  no unit test imports a real-browser helper. jsdom is still imported/selected by
  pure DOM-algorithm tests (`chat/selection`, `chat/streaming/edge-target`,
  `markdown/{sourcemap,wrap-range,mermaid,mermaid-repair,focusable}`,
  `settings/hash-sync`, `utils/media`, `auth/state`, `motion/stagger`,
  `components/ai/model-select/model-select`), which is Node DOM emulation, not
  the browser project, and remains allowed under `TT-001`; T059 decides whether
  jsdom can be dropped later.
- T020: `scripts/check-static-invariants.mjs` implements the three promoted
  checks (`#perf-marks`, `#render-instrumentation`, `#visibility-sentinel`) and
  `pnpm check:invariants` is wired in `package.json`. It reads the real files and
  exits 1 with `<invariant> <file>: <reason>` on violation. Failure path verified
  against a throwaway fixture tree under `/tmp` (no production file edited).
- T021: the ledger has zero rows with disposition `delete` (Summary: `convert`
  28, `promote-static` 3, `retain` 1, `delete` 0), so no source-text test file is
  deleted by this task.
- T014: `src/lib/ai/real-provider.integration.test.ts` already carries the
  `*.integration.test.ts` suffix. The default unit project does not select it;
  the integration config selects it when its `describe.skipIf` suite is
  collectable (env vars set). No rename was performed.
- T028: converted the chat interaction rows. Row 9 now lives in
  `src/lib/components/chat/interactivity.browser.test.ts` (Composer renders no
  suggestion chips/progress, `ChoicesOffer` click wiring and taken-option inertness,
  and `MessageList` derives the trailing gate and clears it after a user turn).
  Row 10 is `src/lib/components/chat/Markdown.touch.browser.test.ts` (fine vs.
  coarse copy/table-focus affordances and wide-table overflow). Row 20 is
  `src/lib/components/chat/strip/SectionStrip.browser.test.ts` (navigation
  landmark, click jump with no self-scroll/navigation, dwell preview with
  `aria-describedby`, and coarse-pointer tap/dwell guard). The headless Chromium
  here reports no fine pointer, so the coarse cases use a Chromium CDP
  touch-emulation browser command (`setPointerMedia` in `vitest.browser.config.ts`)
  and the SectionStrip dwell case stubs only the component's coarse-pointer
  `matchMedia` query; its timers, preview, and clicks stay real. SectionStrip's
  Tailwind-only pointer-events/hit-target classes are not asserted because the
  browser project loads no app stylesheet. Row 11 (`MessageRow.mount.test.ts`)
  remains `promote-static`: `node scripts/check-static-invariants.mjs`
  (`#render-instrumentation`) already asserts both the `rows/*.svelte`
  `incRender('TimelineRow')` mount call and `MessageList`'s
  `rootMargin="1200px"`, so no browser test was added.
  `mermaid-center.test.ts` has no ledger row (pure `computeCenter` unit test with
  no `readFileSync`), so it is not a conversion target. All converted rows keep
  `verified = false` for T035, and the old source-text files are untouched until
  T034.

- No row may move to `verified = true` until its replacement test fails when the
  claimed behavior is deliberately broken.
- T022: five route source-text files reclassified against their pure coverage.
  `image-output-gate.test.ts` and `vision-gate.test.ts` dropped the derive/import
  assertions (`supportsImageOutput(activeConfig, activeModelId)` /
  `supportsVision(activeConfig, activeModelId)` and the helper imports) because
  `src/lib/ai/image-output-capability.test.ts` and
  `src/lib/ai/vision-capability.test.ts` already cover the capability semantics;
  both files keep only the Composer prop-passing assertion and remain `convert`
  rows for T032. `section-jump.contract.test.ts` and
  `tree-page.render.test.ts` are unchanged `convert` rows: their claims are
  route/DOM orchestration, responsive spacing, and pointer behavior with no pure
  equivalent. `visibility-sentinel.test.ts` stays a `promote-static` row and its
  source-text file is untouched; `#visibility-sentinel` in
  `scripts/check-static-invariants.mjs` now also fails on a reintroduced
  `updateVisibility` (previously only `IntersectionObserver` presence and
  `onScroll` absence were checked). No files were deleted.
- T023: no regression test was needed. Every assertion removed in T022 had an
  existing pure Tier 1 replacement (`image-output-capability.test.ts`,
  `vision-capability.test.ts`), and the remaining route claims stay in their
  ledger rows until T032 browser conversion, so no behavior lost its only
  assertion. The `#visibility-sentinel` replacement is a static invariant check,
  not a unit test. Adding tests here would duplicate covered behavior.
- T024: defect check performed on both tiers with the low-spec caps.
  Pure helper: changed the blockquote guard in `src/lib/markdown/sections.ts`
  from `blockquote` to an unmatched string, then
  `NODE_OPTIONS=--max-old-space-size=500 MAYON_TEST_PARALLEL=off pnpm exec vitest
  run --project unit src/lib/markdown/sections.test.ts` failed 2/29
  (`ignores headings inside blockquotes`, `ignores headings inside admonitions`)
  with the quoted heading appearing in the section list. Restored the guard;
  `git diff --exit-code src/lib/markdown/sections.ts` is clean.
  Fastify handler: inverted the host validation in
  `server/src/telemetry.ts` (`!HOST_PATTERN.test` -> `HOST_PATTERN.test`), then
  `NODE_OPTIONS=--max-old-space-size=500 MAYON_TEST_PARALLEL=off pnpm --filter
  @mayon/server exec vitest run src/telemetry.test.ts -t "rejects a host with a
  path"` failed with `expected 200 to be 400`. Restored the condition;
  `git diff --exit-code server/src/telemetry.ts` is clean and the same targeted
  test passed. No production edit remains.
- T025: full `unit` project run with the low-spec caps
  (`NODE_OPTIONS=--max-old-space-size=500 MAYON_TEST_PARALLEL=off pnpm exec
  vitest run --project unit`) passed: **147 files, 2355 tests**, vitest duration
  **208.62 s**, `/usr/bin/time -v` wall clock **3:30.51**, max RSS
  **886,724 KiB (~866 MiB)**, exit 0. The run started no browser: the unit
  project excludes `*.browser.test.ts` and no Playwright process appears. The
  `[test-capacity]` line reported `mode=low-spec cpus=12 mem=7.1GiB override=off
  workers=1 reason=override-off`. The test count is 2357 - 2 because T022 removed
  the two duplicated route derive/import assertions. SC-001's <60 s budget is
  defined for the reference 8-CPU/8-GiB machine; this host is low-spec (12
  logical CPUs but 7.1 GiB usable, serialized to one worker), so 3:30.51 is the
  honest measured low-spec duration, not a reference-budget miss.
- T026: three render/interaction replacements created and verified individually
  with `NODE_OPTIONS=--max-old-space-size=500 MAYON_TEST_PARALLEL=off pnpm exec
  vitest run --project browser <file>` (one file per run, never the full browser
  suite):
  - `src/lib/components/AppShell.browser.test.ts` (3 tests) renders the real
    `AppShell` at a 480px viewport, opens the left sheet, asserts the shared
    `Sidebar` links, and closes the drawer through a nav-link click.
  - `src/lib/components/RowCard.browser.test.ts` (4 tests) asserts link-vs-static
    rendering, the title → meta → badges slot order, badge text, and the trailing
    action slot.
  - `src/lib/components/ai/model-select/model-select.browser.test.ts` (5 tests)
    opens the real dialog, asserts options/context hint, calls `onselect` on
    click, filters through the search input, and invokes `onrefresh`.
  All eight T026/T027 files pass; rows stay `verified = false` until T035's
  break check. `formatContextWindow`'s pure cases were split into
  `src/lib/components/ai/model-select/format-context-window.test.ts` (Tier 1,
  4 tests) before T034 removes the source-text file.
- T027: five replacements created and verified with the same one-file command:
  - `src/lib/components/chat/Breadcrumb.browser.test.ts` (4 tests): labelled nav,
    root links + static current at desktop width, middle-ancestor collapse below
    `sm`, single-entry and empty chains.
  - `src/lib/components/chat/Composer.browser.test.ts` (4 tests): provider label
    and three launchers, enabled launcher callbacks, `aria-disabled` no-ops while
    streaming, and send with the trimmed prompt. The repository boundary is
    mocked with `vi.mock('#lib/db/index.js')` (settings reads plus `uuid`) so the
    component needs no app server or database; MCP effects stay inert because no
    `chatId` is passed.
  - `src/lib/components/chat/ContextGauge.browser.test.ts` (6 tests): null gauge,
    usage summary, critical `role=status`/`data-tip` escalation, popover contract
    rows, humanized `model-listing`, and unknown-window guidance.
  - `src/lib/components/chat/GrowthEdge.browser.test.ts` (4 tests): empty overlay,
    caret effect over trailing text, blur+soften+lift for list content, and
    suppression for a code fence.
  - `src/lib/components/chat/PropagatedArtifact.browser.test.ts` (5 tests):
    collapsed label/expansion, regenerate and confirmed delete callbacks,
    dismissed confirmation, raw-mode action gating, and corrupt-metadata fallback.
  `vitest.browser.config.ts` now pre-bundles the shared component deps
  (`@lucide/svelte` icons, `bits-ui`, `katex`, `mermaid`, `clsx`,
  `tailwind-merge`, `tailwind-variants`); without that, the first file to touch a
  new dep triggered a mid-run optimizer reload that split module instances and
  produced spurious Svelte `effect_orphan`/`reading 'call'` failures.
- T026/T027 type check: `pnpm check` reports 0 errors and 0 warnings. Targeted
  ESLint and Prettier checks on all new files pass. The eight source-text files are
  intentionally left in place for T034.

- T029: seven replacements created and verified individually with
  `NODE_OPTIONS=--max-old-space-size=500 MAYON_TEST_PARALLEL=off pnpm exec vitest
  run --project browser <file>` (one file per run, never the full browser suite):
  - `AssistantMessage.actions.browser.test.ts` (4 tests): accessible copy/branch/
    regenerate labels, copy and branch callbacks, regenerate newest-turn gating,
    and the retained interrupted notice with a single regenerate action.
  - `AssistantMessage.spinner.browser.test.ts` (3 tests): pending live row shows
    `Thinking…` with the pulse spinner, a non-pending live row shows the orbit
    spinner, and durable rows show neither (`A finished answer.` remains).
  - `AssistantMessage.strip.browser.test.ts` (4 tests): strip appears from the
    displayed headings only when the durable body overflows a real
    `.overflow-y-auto` scroller, section clicks thread `(msgId, index)`, and it
    stays absent on live tails, with `stripEnabled=false`, and below three
    sections. A `tests/browser/scroll-frame.svelte` render wrapper supplies the
    bounded scroller; no component markup was added for tests.
  - `ToolActivity.collapse.browser.test.ts` (4 tests): the header is a
    `aria-expanded` collapsible trigger with no Show/Hide control, expanding
    reveals the delegated records body, that body keeps its bounded container,
    and contentless entries stay a plain header.
  - `ToolActivity.status.browser.test.ts` (5 tests): awaiting shows
    `Waiting for your approval` without a gap claim, failed uses the destructive
    XCircle vocabulary, declined/aborted are labelled distinctly, running uses
    the pulse Circle while only gaps show `No result recorded`, and a completed
    result shows `Succeeded`.
  - `ToolActivity.terminal.browser.test.ts` (3 tests): a fake registry tool with
    `terminal: true` renders the neutral Circle and no gap notice, an unpaired
    non-terminal tool keeps XCircle plus `No result recorded`, and terminality
    wins over a stale running flag. The fake tools are deregistered after each
    test.
  - `ToolResultBody.browser.test.ts` (5 tests): records link externally and cap
    at 10 cards with a `+2 more` line, the records container is bounded, markdown
    renders as semantic HTML in a bounded container, and json/text render
    verbatim/pretty-printed in bounded pres. Card descriptions containing markup
    arrive as plain text (no `script` element).
  AssistantMessage files mock `#lib/db/index.js` (`branchSources`, `chats`,
  `settings`, `uuid`) and the `chatStore` seam; ToolActivity files mock only the
  repository boundary. No fetch/network or app server is used. `pnpm check`
  reports 0 errors and 0 warnings, and targeted ESLint/Prettier pass. Rows 13–19
  keep `verified = false` for T035; the source-text files are untouched until
  T034.
- T030: six replacements created and verified individually with
  `NODE_OPTIONS=--max-old-space-size=500 MAYON_TEST_PARALLEL=off pnpm exec vitest
  run --project browser <file>` (one file per run, never the full browser suite):
  - `src/lib/components/diagnostics/DiagnosticsPanel.keys.browser.test.ts`
    (3 tests): repeated MCP events sharing the same `kind`+`serverId` render
    without a key collision (three rows, all actions visible), non-adjacent
    repeated live part types stay deduplicated by the run-length merge (one
    `tool-call`, two `text-delta` chips), and a repeated `partSequence` across a
    trace renders both `text-delta` chips. The repository boundary is mocked
    with `vi.mock('#lib/db/index.js')` (`agentTraces` list/delete methods) so the
    store loads controlled traces without a server or database.
  - `DiagnosticsPanel.render.browser.test.ts` (3 tests): opens a right-side
    sheet (`role=dialog`, `data-side=right`) with the console title, keeps the
    kind filters and Clear action in one header row, and hides Clear plus shows
    `0 traces` when no entity is selected. The browser project loads no app
    stylesheet, so the Tailwind width/`sm:` cap and header-wrap classes are not
    observable as pixels; the test asserts the sheet semantics and header-row
    containment instead of brittle class strings.
  - `ChatDisplayConfig.browser.test.ts` (5 tests): labelled native select with
    Calm/Standard/Expressive options and helper text, persisted preset loaded on
    mount, optimistic save, revert when `setStreamPreset` rejects, and the strip
    preference toggled through its `aria-pressed` button. `#lib/db/index.js`
    (`repos.settings`) is the only mock.
  - `MobileSectionJump.browser.test.ts` (4 tests): self-gates below `xl`, opens
    a bottom sheet (`data-side=bottom`) with sections in prop order, closes and
    delegates `onJump` exactly once per pick, leaves location/scroll untouched,
    and renders nothing at `xl`. Only the component's
    `(min-width: 1280px)` `matchMedia` query is stubbed; sheets, clicks, and
    timers stay real.
  - `SettingsRail.browser.test.ts` (3 tests): labelled nav landmark, buttons in
    prop order, exactly one `aria-current="true"` entry, and `onJump` delegation.
  - `SettingsSearch.browser.test.ts` (6 tests): `matchSections` filtering and
    empty state through the real command input, `focus()` moves focus, match
    selection delegates `onJump`, the settings page mounts the search in the
    header and focuses it on cmd-K with `preventDefault`, and a plain K is not
    hijacked. The page test stubs the heavy sibling sections (including
    `ProviderConfig`) with `tests/browser/settings-section-stub.svelte`, which
    still renders the header and children snippets, so the real page keyboard
    capture and the real `SettingsSearch` are exercised; no db/network mock is
    needed on that path. The input's accessible name is `Search settings`
    (asserted via `getByRole('combobox')`); the locator helper `getByLabel` does
    not match the bits-ui `aria-label`, so the input is located by its
    placeholder (the `aria-label` attribute is still asserted by role name).
  All six files pass individually; `pnpm check` reports 0 errors and 0 warnings,
  and targeted ESLint/Prettier pass. Rows 21–27 keep `verified = false` until
  T035's break check, and the source-text files are untouched until T034.
- T031 accounting: no new browser file was needed.
  - `src/lib/components/mcp/confirmation/confirmation-context.test.ts` is a pure
    `createApprovalStateMachine` rune state-machine test with no `readFileSync`
    or DOM access (12 terminal-transition cases); it stays in Tier 1 unchanged.
  - `src/lib/components/chat/strip/SectionStrip.contract.test.ts` was already
    replaced by `src/lib/components/chat/strip/SectionStrip.browser.test.ts`
    in T028 (ledger row 20), so no duplicate was created and the old file stays
    in place for T034.
- T032: four route-level replacements created and verified individually with
  `NODE_OPTIONS=--max-old-space-size=500 MAYON_TEST_PARALLEL=off pnpm exec vitest
  run --project browser <file>` (one file per run, never the full browser suite).
  Each renders the real `src/routes/chat/[id]/+page.svelte` / tree route through
  the real `$app/state` + `$app/navigation` doubles. The chat route needs the
  chat store, repository boundary, and active-provider accessor, so those are
  supplied by `vi.mock` (mocked `#lib/db/index.js` repositories, mocked
  `#lib/ai/client.js#getActiveSdkProvider`); the route's real derivations and
  real `Composer`/`MessageList`/`SectionStrip` are exercised. No fs/source-text
  assertions remain in any replacement.
  - `src/routes/chat/[id]/image-output-gate.browser.test.ts` (2 tests): with
    `imageOutput: 'on'` the Composer renders the `image output` chip and no
    paperclip; with `imageOutput: 'off'` the chip is absent. Pure capability
    semantics stay in `image-output-capability.test.ts` and are not duplicated.
  - `src/routes/chat/[id]/vision-gate.browser.test.ts` (2 tests): with
    `vision: 'on'` the paperclip renders and no image-output chip appears; with
    `vision: 'off'` the paperclip is absent. Pure capability semantics stay in
    `vision-capability.test.ts`.
  - `src/routes/chat/[id]/section-jump.browser.test.ts` (3 tests): renders the
    route inside a bounded `ScrollFrame` and imports `src/app.css`, so the real
    section strip appears. A blockquote heading precedes the three body
    headings; clicking `Alpha` scrolls a real `h2` outside the blockquote and
    sets `section-flash` (proving the route's DOM anchor filter). Jumping
    suppresses auto-scroll on the next appended message, and sending a turn
    re-enables follow-to-bottom. Teardown clears the 1600 ms landing-flash timer
    (captured from the timer id returned by the spied `setTimeout`).
  - `src/routes/tree/tree-page.browser.test.ts` (4 tests): renders the real tree
    route with repository/chat-store doubles at 480px then 1280px, asserting the
    top padding moves 56px → 32px; the caret is a 40×40 button that collapses the
    child row (`aria-expanded` flips); the delete control computes
    `opacity: 0; pointer-events: none` on a fine pointer and
    `opacity: 1; pointer-events: auto` after `setPointerMedia(true)`.
  - To observe the Tailwind-only responsive/pointer claims (and the route's real
    scroll viewport), `vitest.browser.config.ts` now loads the
    `@tailwindcss/vite` plugin. Only tests that import `src/app.css` receive the
    generated stylesheet; the earlier browser tests that deliberately avoid
    app-wide styling are unchanged, and `AppShell.browser.test.ts` was re-run
    alone after the config change (3 passed) as the regression spot-check.
  - `visibility-sentinel` remains `promote-static` and no browser test was
    added. `node scripts/check-static-invariants.mjs` (invariant
    `#visibility-sentinel`) passes and covers all three original claims:
    `IntersectionObserver` present, `updateVisibility` absent, `onScroll` absent.
- T033: `src/lib/services/session-msw.browser.test.ts` (2 tests) is the
  MSW-backed fetch test. It imports `worker` from `tests/mocks/browser.ts`
  (`setupWorker(...sharedHandlers)`), starts it with
  `onUnhandledRequest: 'error'`, and renders
  `tests/browser/fetch-subject.svelte`, which calls the real
  `fetch('/api/auth/session', { method: 'POST' })` path on mount. The rendered
  output (`Signed in as test-owner`, `Session mode: locked`) comes only from the
  shared auth handler, and a direct fetch in the same file repeats the check.
  No app server, Postgres, or dev stack is started; unhandled network traffic
  fails the test by construction.
- T032/T033 rows 28–32 keep `verified = false` until T035's deliberate-break
  check; the five old source-text files are untouched for T034.
- T034: deleted all **28** source-text files whose ledger disposition is
  `convert`. Before deletion, every `replacementPath` existed, and a full
  browser-project run (see T036) exercised and passed all 28 replacement files.
  The four non-`convert` rows were left untouched: `classification-markers.test.ts`
  (`retain`), `pacer.contract.test.ts`, `MessageRow.mount.test.ts`, and
  `visibility-sentinel.test.ts` (all `promote-static`). Pure Tier 1 files split
  out during conversion were not deleted (`format-context-window.test.ts`,
  `confirmation-context.test.ts`, `mermaid-center.test.ts` and other existing
  unit tests). All 28 `convert` rows now carry their `replacementPath` and
  `verified = true`. Deleted files:
  `ai/model-select/model-select.select.test.ts`, `AppShell.drawer-nav.test.ts`,
  `chat/Breadcrumb.render.test.ts`, `chat/Composer.launchers.test.ts`,
  `chat/ContextGauge.contract.test.ts`, `chat/GrowthEdge.contract.test.ts`,
  `chat/interactivity.test.ts`, `chat/Markdown.touch.test.ts`,
  `chat/PropagatedArtifact.test.ts`, `chat/rows/AssistantMessage.actions.test.ts`,
  `chat/rows/AssistantMessage.spinner.test.ts`,
  `chat/rows/AssistantMessage.strip.test.ts`,
  `chat/rows/ToolActivity.collapse.test.ts`,
  `chat/rows/ToolActivity.status.test.ts`,
  `chat/rows/ToolActivity.terminal.test.ts`, `chat/rows/ToolResultBody.test.ts`,
  `chat/strip/SectionStrip.contract.test.ts`,
  `diagnostics/DiagnosticsPanel.keys.test.ts`,
  `diagnostics/DiagnosticsPanel.render.test.ts`, `RowCard.anatomy.test.ts`,
  `settings/ChatDisplayConfig.render.test.ts`,
  `settings/MobileSectionJump.render.test.ts`,
  `settings/SettingsRail.render.test.ts`, `settings/SettingsSearch.test.ts`,
  `routes/chat/[id]/image-output-gate.test.ts`,
  `routes/chat/[id]/section-jump.contract.test.ts`,
  `routes/chat/[id]/vision-gate.test.ts`, `routes/tree/tree-page.render.test.ts`.
  Final Tier 1 counts: **120 files, 2163 tests**. Files = 147 baseline − 28
  deleted + 1 split (`format-context-window.test.ts`). Tests = 2355 (T025
  post-T022) − 196 (tests collected from the 28 deleted files via
  `vitest list`) + 4 (split file). The unit suite was not re-run; the 196 count
  was measured by collection, not execution. `pnpm check` reports 0 errors and
  0 warnings after the deletions. **Superseded by T062's executed measurement:**
  121 unit-project files / 2184 tests (120 app files + `scripts/test-capacity.test.ts`);
  the 120/2163 figure was a collection estimate, not an executed count. See
  [Final verification](#final-verification-t061t066).
- T035: three deliberate production breaks, each run against its converted
  browser test with the low-spec caps, then restored:
  1. **AppShell drawer close** — replaced
     `onNavigate={() => (drawerOpen = false)}` with a no-op. `AppShell.browser.test.ts`
     failed 1/3 (`closes the drawer when a nav link is clicked`: dialog still
     present). Restored; `git diff --exit-code` clean.
  2. **ToolActivity collapse** — replaced the `CollapsibleContent` wrapper with
     a plain `<div>` so the body no longer gates on expansion.
     `ToolActivity.collapse.browser.test.ts` failed 1/4 (`expands to the
     delegated ToolResultBody…`: `Alpha result` link already rendered before the
     click). Restored; `git diff --exit-code` clean.
  3. **SettingsSearch cmd-K** — removed `searchRef?.focus()` from the settings
     page keydown handler. `SettingsSearch.browser.test.ts` failed 1/6
     (`focuses it on cmd-K with preventDefault`: `document.activeElement` never
     became the search input). Restored; `git diff --exit-code` clean.
  All three rows are now `verified = true`; no production edit remains.
- T036: one full browser-project run on this low-spec host with the exact
  capped command (`/usr/bin/time -v env NODE_OPTIONS=--max-old-space-size=500
  MAYON_TEST_PARALLEL=off pnpm exec vitest run --project browser`) and no dev
  stack running (no mayon containers). Result: **29 files, 113 tests, all
  passed**, Vitest duration **44.73 s**, `/usr/bin/time -v` wall clock
  **0:47.25**, max RSS **624,224 KiB (~610 MiB)**, exit 0. The capacity line
  reported `mode=low-spec cpus=12 mem=7.1GiB override=off workers=1
  reason=override-off`, and exactly one Chromium instance was used. SC-002's
  <120 s budget is defined for the reference 8-CPU/8-GiB machine; this host has
  12 logical CPUs but only 7.1 GiB usable, so it is low-spec and serialized to
  one worker. The 44.73 s measured duration clears 120 s even here, but it is
  reported as the honest low-spec measurement rather than a reference-budget
  claim. Query audit: every interaction target is located by accessible
  role/text/placeholder/test id (`getByRole`, `getByText`, `getByPlaceholder`);
  no replacement reads component source text. A few supplementary assertions
  inspect rendered DOM structure or utility classes where the claim is a bounded
  scroll container, a decorative overlay element, or a pointer-only affordance
  (for example `ToolResultBody`'s `max-h-60`/`overflow-y-auto` container and
  `GrowthEdge`'s `.growth-caret` overlay); these assert rendered output, not
  component source.

- T037/T038/T039/T040/T041: the e2e session infrastructure replaces per-test
  onboarding. `tests/e2e/global-setup.ts` runs in the `setup` project, seeds
  `providers`/`activeProvider` through `/api/db/query`, performs the login
  handshake when the server is locked (`MAYON_E2E_PASSWORD`/`MAYON_E2E_CODE`,
  optional `MAYON_E2E_LABEL`), dismisses the first-run gate once, and writes
  `test-results/.auth/state.json` (gitignored). `MAYON_TEST_UPDATE_STATE=1`
  forces recapture; otherwise a valid cached state is reused while providers are
  still reseeded. `tests/e2e/fixtures/session.ts` creates a root chat through a
  direct `/api/db/query` insert and exposes `page`, `workerIndex`, and the
  worker-scoped `providerId` (`e2e-provider-${workerIndex}`);
  `tests/e2e/fixtures/network.ts` auto-aborts classified third-party assets and
  fails on unclassified external origins. `tests/e2e/fixtures/onboard.ts` keeps
  `onboarded`, `modelListFooter`, and `settledModelFooter` but no longer performs
  the onboarding journey or declares a 90 s fixture timeout. Runtime e2e
  execution is pending a running dev stack; only listing/static checks were run.
- T042: `tests/e2e/telemetry.spec.ts` is retired. Its external langfuse-stub
  receiver (host port 9998) and fixed polling sleep are gone; ingest/protocol
  coverage remains in `server/src/telemetry-ingest.test.ts`, and
  `src/lib/telemetry/emission.browser.test.ts` asserts the client-emission POST
  payload at the MSW network boundary. The e2e inventory in
  `tests/e2e/README.md` records the disposition.
- T043–T045 pruning (static/list validation; runtime execution pending a running
  stack): the suite went from **29 e2e cases in 9 spec files** (30 listed with
  the setup project) to **8 cases in 6 spec files** (9 listed with setup). 21
  cases were removed; every removal is mapped in the Tier 3 pruning ledger
  above. New lower-tier replacements (17 tests total) were created and run
  individually with the capped low-spec command (single files, never the full
  browser suite), all passing:
  - `src/lib/components/ai/provider-template-picker.browser.test.ts` (4):
    group order, cross-group search/hidden empty groups, empty state + clear
    action, clear restores and delegates selection.
  - `src/lib/components/ai/ProviderConfig.browser.test.ts` (6): tool-capability
    option pair/hint/default, flip persistence, normalized legacy display,
    connection success status + catalog merge + keyless local, classified
    failure remedy, refresh catalog merge. Repository/client/connection seams
    are mocked; no app server or database.
  - `src/lib/components/chat/Markdown.render.browser.test.ts` (4): markdown
    structure, KaTeX, mermaid SVG + light→dark→light theme re-render, code-block
    copy affordance (clipboard API stubbed, rendered label asserted).
  - `src/lib/components/generation/GenerationPromptConfig.browser.test.ts` (3):
    read-only contract region with exactly one editor, save-on-blur + preview
    without altering the contract, persisted instructions on mount.
- T043–T045 retained set: `global-setup.ts` (setup), `onboard.spec.ts` (1),
  `render.spec.ts` (3), `quiz.spec.ts` (1), `lab.spec.ts` (1),
  `backprop-tool.spec.ts` (1), `image-round-trip.spec.ts` (1).
  `pnpm exec playwright test --list` reports **Total: 9 tests in 7 files**
  (1 setup + 8 cases), below the `targetTier3Max = 18`.
- T046: `scripts/dev-shard.mjs` no longer imports or assigns the langfuse-stub
  port, has no 9998 constant, no telemetry-owner detection, and no
  `portHeld`/`playwright --list` shard probe. It resolves the capability gate
  once per invocation with `reportCapacity()` (stable `[test-capacity]` line),
  prints the shard total on `up`, and passes `MAYON_TEST_MAX_WORKERS` explicitly
  to the Playwright shard process on `test` (an operator-supplied value still
  wins). `up`/`test`/`down` keep the `<shard>/<total>` contract for any
  configured total (CI uses 4). Readiness waits remain condition polls, not
  fixed waits.
- T047: `.github/workflows/ci.yml` e2e matrix is `[1, 2, 3, 4]`, runs
  `pnpm dev:shard:up <n>/4` and `pnpm dev:shard:test <n>/4` per shard, adds a
  capability-gate step that prints the stable capacity line and writes
  `MAYON_TEST_MAX_WORKERS` to `$GITHUB_ENV` for the shard runner, and tears the
  stack down with `pnpm dev:shard:down <n>` under `if: always()`.
- T048 static isolation: no `waitForTimeout`/`sleep`/`test.setTimeout` exists in
  `tests/e2e`; `grep` for shared provider/chat ids finds none in any spec (the
  only ids live in `tests/e2e/fixtures/seed.ts`/`session.ts`; chats are created
  per test with a fresh UUID and provider ids are worker-scoped). The only
  `/api/db/query` call in a retained spec is a read-only `branch_sources`
  SELECT in `render.spec.ts` (scoped to its own offsets). Runtime isolation
  (each spec alone, `fullyParallel`, and four shards) is **pending a running
  dev/e2e stack**; no Docker/Playwright chain was started for this change.
- T049: `tests/e2e` fixed-wait audit found **zero** `waitForTimeout`, `test.setTimeout`,
  sleep-style `setTimeout`/`sleep`, or first-run setup journeys outside
  `tests/e2e/global-setup.ts`. `rg -n
  "waitForTimeout|setTimeout|setInterval|\bsleep\s*\(" tests/e2e -g '*.ts'`
  returns no matches (the only textual hit is the retired-spec note in
  `tests/e2e/README.md`, which is prose). The setup project still uses web-first
  assertions (`expect(skipSetup.or(appShell)).toBeVisible(...)`) and the specs
  consume the shared session fixture, so no replacement was needed. `TT-002`
  and `TT-004` in `scripts/check-test-tiers.mjs` now enforce both properties
  automatically.
- T050: `scripts/check-test-tiers.mjs` implements `TT-001`–`TT-008` with stable
  IDs, file+line output sorted by file then rule, scan counts, and exit 2.
  Scope: `src/**/*.test.ts` + `server/src/**/*.test.ts` (TT-001),
  `tests/e2e/**/*.ts` (TT-002/TT-004), `src/**/*.browser.test.ts` (TT-003/TT-007),
  `tests/e2e/**/*.spec.ts` (TT-005), the five runner configs (TT-006), and the
  unit project config (TT-008). It is dependency-free, walks the tree once, and
  runs in ~0.27 s on this repo. Current tree: 149 tier1 files, 34 tier2 files,
  14 tier3 files, 5 runner configs, zero violations. Every rule was verified by
  injecting a scratch violation (TT-001 browser import, TT-002 `waitForTimeout`,
  TT-003 fs/source-text in a browser test and in a `convert`-disposition file,
  TT-004 setup `Skip` replay, TT-005 missing fixture + hard-coded credential,
  TT-006 ungated `maxWorkers`, TT-007 Postgres URL, TT-008 integration test not
  excluded); each reported the expected ID and the scratch files were removed.
  The four retained source-text files (`classification-markers.test.ts`,
  `pacer.contract.test.ts`, `MessageRow.mount.test.ts`,
  `visibility-sentinel.test.ts`) pass only because their ledger dispositions are
  `retain`/`promote-static`.
- T051: exemption validation in the same script rejects a missing/empty
  `file`/`rule`/`justification`, a non-existent exempted file, an unknown rule ID,
  and duplicate file+rule pairs as `TT-000`; valid exemptions suppress exactly
  their file+rule violation and are printed. `scripts/test-tier-exemptions.json`
  remains `[]` because the current tree needs none; a temporary scratch entry
  proved suppression while the other rules in the same file still fired, then it
  was removed.
- T052: `scripts/test-capacity.test.ts` (19 tests) covers capable, low-spec
  (CPU-only, memory-only, both), cgroup CPU and memory mismatch, memory.high
  tightening, fully unknown and half-unknown readings, `off`, `on` without
  `MAYON_TEST_MAX_WORKERS` (`TestCapacityError`, `exitCode = 2`), forced `on`
  with an explicit cap, env-map overrides, invalid values, and the stable report
  lines. All readings are injected into `resolveCapacity`; the test never reads
  `/sys`. Targeted run passed in 260 ms.
- T053: `scripts/check-test-budget.mjs` owns `--tiers=<csv>` (tier1, tier2,
  server, tier3; default tier1+tier2+server), reports non-owned tiers as
  deferred to their owning command, reads reports lazily so a deferred tier's
  artifact cannot fail the job, and fails with exit 3 for a missing owned report,
  a missing measurement, or any over-budget owned tier. Verified: `--tiers=tier1`
  exits 3 with `tier1: missing report test-results/tier-durations.json (owned by
  test:ci — run pnpm test:ci)`; an injected over-budget report exits 3; tier3
  shard reports are checked per shard against the 120 s budget; unknown/empty
  tier values exit 2.
- T054: CI now owns the tiers end to end. `scripts/test-ci.mjs` runs
  `check:tests`, then tier1 (`test:unit`), tier2 (`test:browser`), and server,
  measures each, writes `test-results/tier-durations.json` with the capability
  block and tier3 deferred, and runs `check-test-budget.mjs --tiers=tier1,tier2,server`.
  `scripts/test-e2e-ci.mjs` runs one Playwright shard, writes
  `test-results/tier3-shard-<n>.json`, and runs the tier3 budget check. Exit
  codes: 1 test failure, 3 budget breach, 2 guardrail/usage/config. `package.json`
  points `test:ci`/`test:e2e:ci` at the wrappers. `.github/actions/ci` runs
  `pnpm check:tests`, installs Chromium, runs `pnpm test:ci`, and uploads the
  tier-durations report even on failure. The e2e job runs
  `pnpm test:e2e:ci --shard=<n>/4` against the shard's `E2E_BASE_URL` and uploads
  `test-results/tier3-shard-*.json` (plus the existing Playwright artifacts).
  Full tier execution was not run in this change (targeted capacity test only,
  per the change constraints).
- T055: `AGENTS.md` commands table now lists the tier commands (`test:unit`,
  `test:browser`, `test:e2e`, `test:ci`, `test:e2e:ci`, `test:integration`,
  `check:tests`, `check:budget`) and the corrected `test:low-spec` behavior
  (`MAYON_TEST_PARALLEL=off` + 500 MB V8 heap, full selection). The testing
  section documents the three tiers and budgets, the `*.browser.test.ts` vs
  `*.svelte.test.ts` distinction, Tier 1/2/3 boundaries, the MSW fetch boundary,
  the migration-ledger policy, and the capability gate (8 CPUs + 8 GiB, serial on
  low-spec/unknown, `MAYON_TEST_PARALLEL`/`MAYON_TEST_MAX_WORKERS`/
  `MAYON_TEST_MAX_OLD_SPACE_MB`). The existing low-spec profile rule now uses the
  gate's host-and-cgroup minimum.
- T056: `CONTRIBUTING.md`, `docs/how-to/building.qmd`, and
  `docs/reference/agent-map.qmd` now carry the same tier decision tree, tier
  commands, MSW boundary, end-to-end pruning rule, and migration-ledger policy as
  `AGENTS.md`. The stale building-guide e2e inventory (removed specs, two-shard
  instructions, telemetry port 9998) was replaced with the retained flow list and
  four-shard, capability-gated instructions.
- T057: re-verified `TT-001`–`TT-008` by injecting scratch violations into the real
  tree: `src/lib/__guardrail_scratch.test.ts` (TT-001/`vitest-browser-svelte`,
  TT-003/`readFileSync`), `src/lib/__guardrail_scratch.browser.test.ts`
  (TT-003/`readFileSync`, TT-007/Postgres URL),
  `tests/e2e/__guardrail_scratch.spec.ts` (TT-002/`waitForTimeout`,
  TT-004/setup dismissal + Skip button, TT-005/missing fixture + hard-coded
  credential), a temporary ungated `workers: 4` in `playwright.config.ts`
  (TT-006), and a temporarily removed integration exclusion in
  `vitest.unit.config.ts` (TT-008). `pnpm check:tests` exited 2 and reported every
  expected ID (TT-001 through TT-008, 12 violations including both TT-004/TT-005
  sites). The configs were restored and the scratch files removed;
  `pnpm check:tests` then exited 0 with `[test-tiers] all tier guardrails pass`.
  No scratch file or config change remains.
- T058: added `docs/history/032-test-suite-tiering.qmd` in the established
  Goal/Why/Outcome & reversals/Learnings narrative style and linked it from a new
  `Arc F — The suite turns on itself` table in `docs/history/index.qmd`, with the
  arc count and closing summary updated.
- T059: **not removed.** `rg -l "vitest-environment jsdom" src server tests`
  still finds four Tier 1 files that select jsdom for pure DOM algorithms:
  `src/lib/auth/state.svelte.test.ts`, `src/lib/markdown/focusable.test.ts`,
  `src/lib/settings/hash-sync.test.ts`, and `src/lib/utils/media.test.ts`. These
  are rune-module/Node DOM-emulation tests, not Tier 2 browser tests, so `jsdom`
  and `@types/jsdom` stay in `package.json` and the lockfile is unchanged.
- T060: scan of `src/**/*.test.ts`, `src/**/*.browser.test.ts`, and `tests/**`
  found **zero** `+`-prefixed test or helper files. The only `+`-prefixed paths
  are the existing SvelteKit route files (`src/routes/**/+page.svelte`,
  `+page.ts`, `+layout.svelte`, `+layout.ts`), which the reserved-prefix rule
  permits.

## Non-runtime rows

These four rows remain `verified = false` by design. They are not runtime
behavior tests, so there is no rendered behavior to break; each is enforced (or
retained) as a static invariant. They are documented here instead of being
silently converted.

| # | sourceFile | Disposition | Why it is not runtime-verified |
|---|---|---|---|
| 1 | `src/lib/ai/generate/classification-markers.test.ts` | `retain` | Pure constant/fixture drift check in Tier 1; it asserts product constants against single-sourced fixture values, not rendered behavior. It stays as-is and imports no browser or DOM. |
| 2 | `src/lib/chat/streaming/pacer.contract.test.ts` | `promote-static` | Perf-instrumentation marks (`mark('pacing:flush')`, `incRender('Pacer')`) are source-level contracts with no user-observable behavior; `scripts/check-static-invariants.mjs#perf-marks` enforces them. |
| 11 | `src/lib/components/chat/MessageRow.mount.test.ts` | `promote-static` | Render instrumentation and `LazyMount` `rootMargin` are static perf contracts; `scripts/check-static-invariants.mjs#render-instrumentation` enforces both. |
| 30 | `src/routes/chat/[id]/visibility-sentinel.test.ts` | `promote-static` | Layout-read strategy (`IntersectionObserver` present, `updateVisibility`/`onScroll` absent) is a static performance invariant, not a rendered behavior; `scripts/check-static-invariants.mjs#visibility-sentinel` enforces it. |

## Final verification (T061–T066)

Measured on this host: **12 logical CPUs but 7.1 GiB usable RAM**, i.e. low-spec
under the documented 8-CPU/8-GiB gate. Every recorded run therefore reports
`mode=low-spec` and `workers=1`. Durations on this host are honest low-spec
measurements, not reference-hardware budget claims.

### T061 — static checks

| Command | Result | Evidence |
|---|---|---|
| `pnpm check` | **PASS** | `svelte-check found 0 errors and 0 warnings` |
| `pnpm lint` | **PASS** | ESLint clean; `prettier --check .` → `All matched files use Prettier code style!` |

No formatting or doc/config fix was required.

### T062 — executed tier results

| Tier | Command | Files | Tests | Duration | Result |
|---|---|---|---|---|---|
| Tier 1 (unit) | `pnpm test:low-spec` (unit project; selection confirmed with `vitest list --project unit`) | 121 | 2184 | included in the combined run below | **PASS** |
| Tier 2 (browser) | `pnpm test:low-spec` (browser project) | 34 | 131 | included in the combined run below | **PASS** |
| Tier 1 + Tier 2 | `pnpm test:low-spec` | 155 | 2315 | 233.48 s | **PASS** |
| Server | `pnpm --filter @mayon/server exec vitest run` | 26 | 349 | 212.70 s | **PASS** |
| Tier 3 | `pnpm exec playwright test --list` | 7 | 9 (1 setup + 8 cases) | n/a | **LISTED ONLY** — runtime blocked (see S4) |

The 121/2184 unit selection was measured with `vitest list --project unit`
(collection only, no test execution) and matches the recorded all-project run
exactly: `find src -name '*.browser.test.ts' -not -path '*__screenshots__*'`
reports 34 browser files, and `121 + 34 = 155`, `2184 + 131 = 2315`. The earlier
standalone full browser run (T036) was 29 files / 113 tests in 44.73 s, before
T042 added `emission.browser.test.ts` and T043–T045 added the four replacement
files; the current browser selection is the 34/131 derived above.

### T063 — low-spec completeness

| Check | Evidence | Result |
|---|---|---|
| 100% test selection | 155 files = 121 unit (`vitest list`) + 34 browser files on disk; 2315 tests | **PASS** |
| One worker | `[test-capacity] mode=low-spec … workers=1` | **PASS** |
| Zero skips | Summary reports `2315 tests passed` with no skipped/failed count | **PASS** |
| No file parallelism | `test:low-spec` sets `MAYON_TEST_PARALLEL=off` and `VITEST_FILE_PARALLELISM=false` | **PASS** |

### T064 — quickstart scenarios (S1–S9)

| Scenario | Status | Evidence / remaining work |
|---|---|---|
| **S1** Tier 1 instant and browser-free | **PASS-WITH-CAVEAT** | Unit project selection is 121 files / 2184 tests and excludes `*.browser.test.ts`; T025's full unit run passed with no browser. The `<60 s` figure is defined for the reference 8-CPU/8-GiB machine; this 7.1 GiB host is low-spec and T025 measured 208.62 s, so the reference budget is not measurable here. |
| **S2** Tier 2 renders real components | **PASS** | 34 browser files / 131 tests passed in the recorded low-spec run; the standalone T036 run was 29 files / 113 tests in 44.73 s (<120 s even on low-spec). `Breadcrumb.browser.test.ts` exists and queries by role; T035 broke three rendered interactions and each replacement failed. |
| **S3** Source-text migration complete | **PASS** | `node scripts/check-test-tiers.mjs` → `scanned 149 tier1, 34 tier2, 14 tier3, 5 runner configs (8 rules)` / `all tier guardrails pass`. Ledger covers all 32 classified files (28 `convert` with `verified = true`, 3 `promote-static`, 1 `retain`); the 28 source-text files were deleted in T034. |
| **S4** End-to-end lean and state-reusing | **BLOCKED** | Docker socket is `srw-rw---- root:docker` and the current user is not in the `docker` group. Exact error from `docker info`: `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`. Remaining: `pnpm dev:up`, `time pnpm test:e2e`, setup-once runtime proof, each-spec-alone isolation, and the shard runtime below. No e2e test was executed. |
| **S5** Capability gate | **PASS** | Recorded line `[test-capacity] mode=low-spec … workers=1 reason=override-off`; `scripts/test-capacity.test.ts` (19 tests) covers capable, low-spec (CPU-only/memory-only/both), cgroup mismatch, unknown/half-unknown readings, forced `off`/`on`, explicit worker caps, and invalid values. |
| **S6** Guardrails reject regressions | **PASS** | `node scripts/check-test-tiers.mjs` exits 0 with zero violations on the real tree; T057 injected TT-001–TT-008 and the script exited 2 with every expected ID, then exited 0 after restoring. |
| **S7** CI budgets | **PARTIAL — non-e2e PASS, shard BLOCKED** | Non-e2e behavior verified: `node scripts/check-test-budget.mjs --tiers=tier1` exits **3** with `FAIL: tier1: missing report test-results/tier-durations.json (owned by test:ci — run pnpm test:ci)`; injected over-budget reports also exit 3 (T053). The shard half (`pnpm test:e2e:ci -- --shard=1/4`, `tier3-shard-1.json`) is **BLOCKED** by the same Docker socket permission error; no shard was run. |
| **S8** Server boundary in-process | **PASS** | `pnpm --filter @mayon/server exec vitest run` → 26 files / 349 tests passed. T017/T018 audits left only transport-subject listeners annotated in place; `*.integration.test.ts` is excluded from the default run (T014/T050). |
| **S9** Low-spec completeness | **PASS** | Same recorded run as T063: 155 files / 2315 tests, `mode=low-spec`, `workers=1`, no skips, full selection. |

### T065 — success criteria

| Criterion | Status | Evidence / exact reason |
|---|---|---|
| **SC-001** Tier 1 <60 s on 8-CPU/8-GiB reference | **PASS-WITH-CAVEAT** | Budget is wired (`test-budgets.json`, `check:budget`). This host is low-spec; T025 measured 208.62 s for the unit project. The 60 s reference figure is not measurable here. |
| **SC-002** Tier 2 <2 min on reference | **PASS** | Standalone browser run 29 files / 113 tests in 44.73 s on this low-spec host, below 120 s. Current selection is 34/131 and passed in the combined run. |
| **SC-003** E2E <8 min across ≥4 shards | **BLOCKED** | No running stack. `docker info` → `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`. No shard was executed; the 4-shard matrix is configured but unverified at runtime. |
| **SC-004** Zero browser processes in the fast tier | **PASS** | `vitest.unit.config.ts` excludes `**/*.browser.test.ts`; T025's unit run started no browser. The unit project contains only Node tests. |
| **SC-005** Zero fixed waits in e2e | **PASS** | T049 audit: zero `waitForTimeout`/`test.setTimeout`/sleep-style calls in `tests/e2e`; `TT-002` enforces it. |
| **SC-006** Setup/onboarding ≤ once per worker/run, per-test setup zero | **BLOCKED** | Static infrastructure exists (`tests/e2e/global-setup.ts` writes `test-results/.auth/state.json`; fixtures consume it; no per-test onboarding journey), but runtime proof requires a running stack, which Docker permissions block. |
| **SC-007** ≥50% of e2e cases removed/migrated, 100% traceable | **PASS** | Retained set is 8 cases (9 listed with setup) vs the 29 post-T042 cases (32 listed, 37 historical). 21 removals are each mapped in the pruning ledger; 8/29 remains ≈72% removal (≈78% vs 37). Every removal has a replacement path or retirement rationale. |
| **SC-008** 100% of component-behavior tests render; zero source-text component assertions | **PASS** | All 28 `convert` rows now point at `*.browser.test.ts` files that render and were verified by deliberate breaks (T035); the old source-text files were deleted (T034). `TT-003` passes and the four remaining non-runtime rows are explicitly `retain`/`promote-static`. |
| **SC-009** Every e2e spec passes alone and sharded, no ordering dependency | **BLOCKED** | Static isolation audit (T048) found no shared ids or fixed waits, but per-spec and shard execution require the dev stack; Docker socket permission denied. No e2e test was executed. |
| **SC-010** Fast-tier file count = baseline + convert/regression additions, no unexplained increase | **PASS-WITH-CAVEAT** | Baseline 147 → 121 unit-project files: −28 `convert` deletions, +1 split (`format-context-window.test.ts`), +1 new guardrail test (`scripts/test-capacity.test.ts`). Tests: executed selection 2184; T034's collection estimate was 2163 and is superseded by the measured count. All changes are explained. |
| **SC-011** Guardrail detects an injected violation within 10 s | **PASS** | T057 injected TT-001–TT-008; `pnpm check:tests` exited 2 with every expected ID and runs in ~0.27 s on this repo. Restored to exit 0. |
| **SC-012** CI reports per-tier durations and fails over budget | **PASS-WITH-CAVEAT** | `scripts/test-ci.mjs` writes `test-results/tier-durations.json`, `scripts/test-e2e-ci.mjs` writes per-shard reports, and `check-test-budget.mjs` exits 3 for missing/over-budget owned tiers (verified). The full CI jobs were not executed in this environment (no Docker/stack). |
| **SC-013** Low-spec runs 100% with one worker, bounded concurrency, never full parallelism | **PASS** | Recorded run: 155 files / 2315 tests, `mode=low-spec`, `workers=1`, `MAYON_TEST_PARALLEL=off`, `VITEST_FILE_PARALLELISM=false`, zero skips. |
| **SC-014** At/above threshold parallel by default; unknown → serial | **PASS** | `scripts/test-capacity.test.ts` (19 tests) covers capable → parallel, low-spec → serial, unknown/half-unknown → serial, and cgroup-minimum behavior. |
| **SC-015** Explicit override changes mode and is reported; default unchanged | **PASS** | Capacity tests cover `MAYON_TEST_PARALLEL=off`, forced `on` with an explicit worker cap, and `MAYON_TEST_MAX_WORKERS`; the recorded run reports `override=off` and effective `workers=1` in the stable `[test-capacity]` line. |

**SC summary:** 9 PASS, 3 PASS-WITH-CAVEAT (SC-001, SC-010, SC-012), 3 BLOCKED
(SC-003, SC-006, SC-009). The three blocked criteria are exactly the ones that
require a running browser + server + Postgres stack; each is blocked by Docker
socket permissions in this environment, not by a code or configuration failure.

### T066 — production build asset check

| Check | Result |
|---|---|
| `NODE_OPTIONS=--max-old-space-size=1500 pnpm build` | **PASS** (exit 0, `✓ built in 12.41s`, `Wrote site to "build"`) |
| `build/mockServiceWorker.js` (or any `*mockServiceWorker*`/`*msw*`) | **ABSENT** |
| `build/**/tests/`, `__tests__`, `fixtures`, `mocks` directories | **ABSENT** |
| `*.test.*` / `*.spec.*` / `tests/**` / `mocks/**` files under `build/` | **ABSENT** |
| `setupWorker` / `setupServer` / `tests/mocks` references in built JS | **ABSENT** |
| Expected output present | `build/index.html`, `build/fonts/`, `build/_app/` (258 files total) |

The production build therefore contains no MSW worker asset and no test-only
mock fixtures.

