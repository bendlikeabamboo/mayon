# Tool Map Docs Plan

Add a developer/agent reference page mapping Mayon's agent tool system: what
tools exist, how they behave at runtime, and when they are available.

## Decisions (confirmed with user)

- **Audience/placement:** developer/agent reference at `docs/reference/tool-map.qmd`,
  listed in the Reference sidebar next to `seams.qmd` and `agent-map.qmd`.
- **Scope:** full system map — inventory tables for all tool groups **plus** the
  complete availability/gating machinery and risk runtime behavior.
- **Sync policy:** hand-written page that links source files as the authority
  (agent-map precedent: link, don't copy), with a "keep in sync" note; add one
  line to AGENTS.md's Where-to-look list.

## Verified facts (from code, 2026-10-31)

### Tool groups

| Group | Source | Tools |
| --- | --- | --- |
| Readonly inspection | `src/lib/agent/registry.ts` | `read_checklist`, `list_artifacts`, `read_artifact`, `summarize_progress` |
| Deterministic | `src/lib/agent/deterministic-tools.ts` | `branch_chat` (high), `save_brief` (high), `draft_lab_skeleton` (low), `draft_quiz_outline` (low), `toggle_checklist_item` (low), `present_choices` (readonly, `terminal: true`) |
| Generative | `src/lib/agent/generative-tools.ts` | `create_quiz` (high, generative), `create_lab` (high, generative) |
| Dynamic MCP | `src/lib/mcp/mount.ts` + `src/lib/mcp/resources.ts` | any enabled MCP server's tools, plus `mcp_read_resource` |

### Availability gates (in order)

1. **Provider capability** — `resolveToolCapability` (`src/lib/agent/capability.ts:69`):
   provider `toolCapability !== 'off'`; legacy defaults via `legacyToolDefault`
   (anthropic/gemini/github-copilot → on, ollama → off, openai-compatible →
   `KNOWN_GATEWAY_BASEURLS` allowlist).
2. **Session safety net** — if a tool-enabled turn throws `APICallError`
   (400 or /tool|function/i), `disableToolsForSession()` trips and the turn
   retries without tools (`src/lib/agent/loop.ts:681-698`).
3. **First-turn blackout** — tools never offered on the first turn of a root
   chat (`loop.ts:298`, `!deps.firstTurn`).
4. **Per-turn disabled ids** (`src/lib/stores/chat.svelte.ts:584-588`) —
   `save_brief` when the root chat already has a brief
   (`disabledToolsForBrief`, `src/lib/chat/brief.ts:235`); `branch_chat` while
   a manual branch is pending; `mcp_read_resource` when no MCP resource server
   is enabled.
5. **64-definition cap** — overflow dropped with a console warning
   (`loop.ts:74-82`).
6. **MCP-specific** — stdio transport requires the server's `stdio-mcp`
   capability (`src/lib/mcp/lifecycle.ts:69`, `server-stdio.ts:40`); server must
   be trusted (user confirmation, `src/lib/mcp/trust.ts` via `isTrusted`);
   per-server enable; risk derived from annotations, default `high`
   (`src/lib/mcp/risk.ts:4-9`).
7. When tools are live, `buildCapabilitiesPreamble()` (`brief.ts:245`) is
   injected into the system prompt.

### Risk classes & runtime behavior (`loop.ts:496-556`)

- `readonly` → runs silently.
- `low` → runs, `notifyLowRisk` toast.
- `high` → `requestApproval` modal; decline is final (preamble forbids re-asking).
- `generative: true` → `notifyGenerativeStatus` status; consumes the sub-call
  budget (`maxSubCalls: 1` per turn).
- `terminal: true` (only `present_choices`) → ends the agent turn after its
  tool calls; options render as reply chips (never as text; strategy
  `GATE_INSTRUCTION` in `src/lib/chat/strategies.ts:45`).
- Iteration/budget exhaustion → critic phase with
  "(…tool budget reached; continuing from here.)" (`loop.ts:665-671`).

### Persistence/kinds

Tool calls/results persist as message parts; row kind classification in
`src/lib/chat/kinds.ts` (`present_choices` call → `choices` kind; others →
`tool_call`/`tool_result`). Artifact-producing tools return
`detail.artifact` (`branch_chat` → chat, `create_quiz` → quiz, `create_lab` → lab).

## Tasks

1. **Create `docs/reference/tool-map.qmd`** with front matter
   (`title: "Tool Map"`, `aliases: [/dev/tool-map.html]` for parity with
   agent-map), structured as:
   - Intro: purpose, authority links (the source files above), and a sync note:
     "If you add, remove, or change a tool, update this page in the same change."
   - **Tool sources** — the four groups table above, each linking its source file.
   - **Inventory** — one table per group: id, parameters (one-line each), risk,
     flags (`generative`/`terminal`), effect + result/artifact. Include the
     behavioral notes: `save_brief` only in brief-less first turn; `present_choices`
     renders chips and ends the turn; `create_quiz`/`create_lab` own their
     content in artifacts (never reproduced in chat).
   - **Risk classes & runtime behavior** — the mapping above (approval / toast /
     silent / generative status / terminal), sub-call budget, budget-reached
     fallback.
   - **When tools are available** — the ordered gate list 1-7 above.
   - **Lifecycle** — short flow: model emits tool-call → risk gate → registry
     dispatcher (`toolsRun`) → `ToolResult {ok, summary, detail, artifact}` →
     persisted parts classified by `kinds.ts`.
   - Cross-link `seams.qmd`, `agent-map.qmd`, `explanation/architecture.qmd`.
   - Tone: neutral, straightforward (docs tone correction — no snark).
2. **Register in `docs/_quarto.yml`** — add `reference/tool-map.qmd` to the
   Reference sidebar contents, after `reference/agent-map.qmd`.
3. **AGENTS.md** — add one line to "Where to look":
   `docs/reference/tool-map.qmd` (tool inventory + availability rules; update
   it when touching agent/mcp tools).
4. **Re-verify while writing**: the implementer must confirm each claim against
   current code (cite file paths in the page) rather than copying this plan
   blindly; if code and plan disagree, code wins and the page follows code.

## Validation

- `pnpm lint` (Prettier checks the new `.qmd`); run `pnpm format` if it flags
  formatting. Note: Prettier may hard-wrap — that is fine for the qmd file
  (only GitHub bodies must never be hard-wrapped).
- Optionally `quarto render docs/` if Quarto is installed, to catch YAML/sidebar
  errors; otherwise `grep` the `_quarto.yml` edit for indentation parity.

## Out of scope

- No code changes, no codegen/script for the tables, no user-facing how-to page,
  no changes to the tools themselves.
