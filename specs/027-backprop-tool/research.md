# Research: Conversational Back-Propagation Tool (027)

Phase 0 output. Every decision below was settled by direct code inspection of the
shipped 020 propagation path and the agent-tool system; no open clarifications remain.

## D1 — One new deterministic tool: `propagate_to_parent`

**Decision**: Add a single tool `propagate_to_parent` to `deterministicTools`
(`src/lib/agent/deterministic-tools.ts`), registered through the existing registry at
import time like its siblings.

**Rationale**: The tool is a repo-orchestrating action in the shape of `branch_chat`
(gates → repository writes → `ToolResult`), which is exactly the deterministic group's
pattern (`src/lib/agent/registry.ts:242-246`). Its only LLM work (summary mode) is
delegated wholesale to the existing `generateBranchArtifactSummary`, so the tool body
itself stays deterministic-orchestration code.

**Alternatives considered**: A new module (`propagate-tool.ts`) — rejected; it would
fragment the tool inventory for no size win. Putting it in `generative-tools.ts` —
rejected; that group is defined by tools whose bodies assemble and run generative
prompts themselves.

## D2 — Risk class: `high` (approval-gated)

**Decision**: `risk: 'high'` — the loop's `requestApproval` modal runs before execution
(`src/lib/agent/loop.ts:554-566`), a decline is final, and the existing preamble line
"Actions that create or change artifacts require the learner's approval" already covers
the etiquette.

**Rationale**: It writes a row into another chat — the same class of side effect as
`branch_chat` and `save_brief`, both `high`. Spec FR-004 requires following the app's
standing confirmation pattern; this is that pattern.

**Alternatives considered**: `low` (toast-after) — rejected: writing to the parent
without confirmation would contradict every existing state-changing tool. `readonly` is
nonsense here.

## D3 — `generative: true` despite raw mode making no LLM call

**Decision**: Flag the tool `generative: true`, like `create_quiz`/`create_lab`.

**Rationale**: Summary mode performs one real LLM sub-call inside `run`. The generative
machinery is what (a) shows a long-running status label while it runs
(`notifyGenerativeStatus`, `loop.ts:591-600` — add a `"Back-propagating to parent…"`
label to the ternary) and (b) enforces the one-generative-action-per-turn sub-call
budget (`loop.ts:583-590`). Without the flag, a real sub-call would run hidden,
unbudgeted, and un-signaled — precisely what the flag exists to prevent.

**Alternatives considered**: `generative: false` (raw is fast and pure) — rejected for
the hidden-sub-call reason above. Splitting into two tools (raw deterministic + summary
generative) — rejected: doubles the inventory and the preamble surface for a distinction
the user never makes; accepted tradeoff is that a raw-mode call also claims the
per-turn generative budget and briefly shows the status label (harmless — propagation is
a natural turn-capper, and the budget refusal message is already model-facing).

## D4 — Tool reuses repo-level helpers, not the store method

**Decision**: The tool's `run` reuses `resolveAnchor` / `buildRawDelta` /
`branchArtifactMetadata` (`src/lib/chat/propagation.ts`) and
`generateBranchArtifactSummary`
(`src/lib/ai/generate/generate-branch-artifact-summary.ts`) directly, ending in the same
`repos.messages.insertAnchored` call the store makes
(`chat.svelte.ts:1406-1428`). It does NOT call `chatStore.propagateToParent`.

**Rationale**: The registry is a module-level structure; tools receive only `ToolContext`
(`registry.ts:25-39`) — no store reference — and a tool importing the chat store would
create a store → loop → registry → store cycle and smuggle UI `$state` into the tool
layer. The 020 core was deliberately factored into `propagation.ts` as pure-ish,
repo-reading helpers with a single insert seam; that factorization is what makes an
identical-outcome tool path possible at all. `generateBranchArtifactSummary` resolves
its own provider (`getActiveSdkProvider()`, line 97) so it needs nothing from `ctx`.

**Alternatives considered**: Extending `ToolContext` with a store callback — rejected as
over-engineering (interface change rippling through loop + tests to avoid reusing three
already-exported functions). Reimplementing delta building in the tool — rejected:
FR-002 requires identical artifacts; the only safe way to identical is the same code.

## D5 — Shared in-flight latch for cross-path concurrency (FR-008)

**Decision**: Add a tiny acquire/release latch to `src/lib/chat/propagation.ts`
(module-level, synchronous acquire; release in `finally`). The tool acquires it around
its work; `chatStore.propagateToParent` adopts the same latch ahead of its existing
`propagationStatus === 'running'` early-return. A second acquisition — from either
path, in either order — fails fast with a clear refusal.

**Rationale**: The store's `$state` guard only sees the manual path; a tool running
inside the turn loop knows nothing about it. FR-008 demands refusal across both paths;
the propagation module is the one place both already import. The store keeps its
reactive `propagationStatus` for UI (spinner/error banner) — the latch is the
correctness primitive, not a UI replacement.

**Alternatives considered**: A store-only guard consulted via a getter the tool polls —
rejected: tools cannot import the store (D4). A DB-level lock — rejected grossly
over-engineered for a single-user app.

## D6 — Availability gating via `disabledToolIds`, mirroring `canPropagate`

**Decision**: In the chat store's turn assembly (`chat.svelte.ts:596-600`), append
`propagate_to_parent` to `disabledToolIds` whenever the active chat is not a branch
(`chat.parentId === null`) or has no messages yet — the exact condition behind the
manual button's `canPropagate` (`src/routes/chat/[id]/+page.svelte:307-309`).

**Rationale**: This is the mechanism purpose-built for per-turn tool availability
(`save_brief` after brief exists, `branch_chat` while a manual branch is pending — same
list, same pattern). FR-001 is thus enforced at definition assembly time, so the model
on a root chat is never even shown the tool (it cannot offer what it does not have —
which also satisfies US2 scenario 4).

**Alternatives considered**: Gating only inside `run` (fail at call time) — kept as
defense-in-depth (the tool re-validates via repos and returns a clean failure), but
insufficient alone because the model would still see and offer the tool where it cannot
work.

## D7 — Etiquette lives in the capabilities preamble

**Decision**: Extend `buildCapabilitiesPreamble()` (`src/lib/chat/brief.ts:245-256`)
with back-propagation lines: the tool exists on branch chats; call it only when the
learner explicitly asks or agrees to a single offer; when they signal completion
without asking, offer at most once in plain terms and never propagate unasked; after
success confirm in 1–2 sentences (parent chat, mode) and reproduce none of the
propagated content as chat text; declined means dropped (already generic, line 253).

**Rationale**: US2/FR-005 is conversational behavior — the preamble is the system-prompt
contract where every other tool-usage rule already lives (judicious use, approval
etiquette, artifact-content rules). The preamble is static while tool availability is
per-turn, so the lines are phrased conditionally ("on a branched chat…") — same
approach the MCP lines take.

**Alternatives considered**: A dedicated branch-context system note injected only on
branch turns — rejected: a second preamble path to maintain for lines that read fine
conditionally; can be revisited if drift shows up.

## D8 — Repeat semantics: repeat = another artifact; regeneration stays manual

**Decision**: A tool-triggered repeat propagation behaves exactly like clicking the
manual control again: a further artifact lands (the 020 test at
`chat.svelte.test.ts:2037` settles that two propagations land two artifacts by design).
In-place regeneration of an existing summary artifact — which rewrites `content` in
place (`regenerateArtifact`, `chat.svelte.ts:1452+`) — remains a distinct manual
affordance the tool does not perform; if the user asks for a "refresh" of an existing
summary, the assistant says to use the regenerate control.

**Rationale**: FR-009 demands parity with the manual control; parity means the same
act, not silently mapping "propagate again" onto a different act (in-place rewrite)
the manual surface keeps separate. (Spec FR-009/US3-5 wording tightened this way during
planning.)

**Alternatives considered**: Tool auto-regenerating when a prior summary artifact
exists — rejected: surprising write-in-place semantics keyed off history the model
cannot see.

## D9 — No toast on the tool path

**Decision**: The tool path fires no `toastState.push`; the assistant's in-chat 1–2
sentence confirmation (FR/SC-001) is the user feedback. The tool result's `summary`
carries exactly what the model needs to relay: mode, parent chat title, artifact
landed.

**Rationale**: A toast plus an in-chat confirmation plus the approval modal is three
confirmations for one act. The manual path keeps its toast because there is no chat
turn to speak.

**Alternatives considered**: Reusing `lastPropagation` to trigger the store toast —
rejected (double confirmation noise).

## D10 — Docs and observability ride existing surfaces

**Decision**: Update `docs/reference/tool-map.qmd` (inventory row under Deterministic,
behavioral note, availability-gate list entry at gate 4) and `agent-map.qmd` if it
lists tool placement — same change, per the tool-map header rule ("If you add, remove,
or change a tool, update this page in the same change"). Tool traces flow through the
existing `onTrace` tool-call events and `agent_traces`; summary generation already
persists its `branch_artifact_summary` trace. Telemetry capture of the tool sub-call
comes free via `captureGenerator` inside the summary generator.

**Rationale**: AGENTS.md invariant for agent-tool changes; no new surfaces invented.

**Alternatives considered**: None — this is the documented contract.
