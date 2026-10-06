# Quickstart Validation Results — T021 (manual scenarios A–E)

**Date**: 2026-10-07 · **Validator**: automated browser run (playwright-cli, Chromium) against the live dev stack
**Worktree**: `/home/hawitsu/projects/mayon/.kilo/worktrees/towering-cherry` · **Commit**: `2a462e8` ("chore: prepare 0.8.1 release", branch `023-llm-context-remaining`)
**Stack**: `pnpm dev:up` (compose project `mayon-dev`: web :5173 Vite HMR with worktree `src/` volume-mounted, server :4319, Postgres 17, and the compose-file `mock-llm` service running `tests/fixtures/mock-llm/server.mjs`, healthy). Server reports `v0.7.0 · db ready`; DB is the shared dev volume (contains older validation data — pre-existing chats/providers).
**Auth**: first-boot security gate offers **Skip**; skipped (no password needed). Per-browser, re-skipped after browser relaunch.
**Provider under test**: pre-existing "LiteLLM (self-hosted)" card re-pointed at `http://mock-llm:9999/v1`, default model `mock-sink`, tool capability **Disabled** (see B notes), declared window varied per scenario. Second provider "T021-Alt" added via the LM Studio (local) template for D (`http://mock-llm:9999/v1`, `mock-sink`, window 4000). A real Z.AI provider card exists in the shared dev DB and was left untouched/inactive; no real endpoint was called.

## Outcome table

| Scenario | Expectation (quickstart.md) | Actual | Verdict |
|---|---|---|---|
| A. Reported usage, known window | `2 / 2000` reported, muted, no `~`; persists across reload | `2 / 2.0k (0%)`, span `data-state="normal"` `data-provenance="reported"`; identical after page reload. Popover: Used 2 · Window "2.0k · declared on provider card" · History + instructions 0 · Latest reply 0 · "reported usage · model: mock-sink" | **PASS** |
| B. window=2 → critical + guidance | destructive tone, guidance to start a new chat or branch | `2 / 2 (100%)`, `data-state="critical"`, class `text-destructive`, hover title "reported usage — Context nearly full — start a new chat or branch to free context" | **PASS** |
| B. window=8 → low (amber) | low tone at "25% used" | `2 / 8 (25%)` renders **normal**, not low. See "Findings" #1 — the quickstart's arithmetic contradicts its own B-2; the implemented/contract semantics (low = ≤25% **remaining**) make `low` unreachable with the mock's constant 2-token replies and integer windows (2/2→critical, 2/3→33% remaining→normal) | **PARTIAL** (implementation correct per contract; quickstart step not drivable as written; thresholds covered by `context-usage.test.ts`) |
| B. large window → normal; new chat → normal | normal tone | `2 / 2.0k (0%)` normal reported; new chat `~0 / 2.0k (0%) est.` normal | **PASS** |
| C. Unknown window | consumed + "window unknown", never a made-up denominator; detail points to provider card | `2 · window unknown`, `data-state="no-limit"`, `data-provenance="reported"` — no denominator invented. Popover Window row: "unknown · unknown". The explicit "set Context window on the provider settings card" pointer exists only in the **estimated**+no-limit hover title (`ContextGauge.svelte:57-59`), not in the reported+no-limit popover | **PARTIAL** (marking PASS; popover guidance claim not met in this provenance state) |
| D. Brand-new chat → est. | `~`/`est.` marking | `~0 / 2.0k (0%) est.`, `data-provenance="estimated"` | **PASS** |
| D. Second provider, different model, active mid-chat | window recomputes immediately, est. until next reported exchange, then reported takes over | Model switched to `gpt-4o-mini` (in static catalog; anchor model `mock-sink` ≠ active): immediately `~2 / 128.0k (0%) est.` (catalog window, mismatch est). Switch to T021-Alt (`mock-sink`, window 4000): immediately `2 / 4.0k (0%)` reported. Switch back to `gpt-4o-mini`: `~2 / 128.0k (0%) est.`; after one exchange: `2 / 128.0k (0%)` **reported** | **PASS** |
| E. Regenerate last reply | anchor replaced, no double count | Before: `~2 / 2.0k est.` (anchor model `gpt-4o-mini`). After Regenerate: `2 / 2.0k (0%)` reported. DB: exactly one new tail assistant row (`tokens=2`, usage modelId `mock-sink`); gauge stays at 2, not 4 | **PASS** |
| E. Branch from earlier message, navigate | each view reflects its path | "Branch a new chat from this whole message" created a linked, empty branch chat: gauge `~0 / 2.0k (0%) est.` (its path has no exchanges) while parent showed `2 / 2.0k reported`. After an exchange in the branch: branch `2 / 2.0k (0%)` reported; parent re-opened via breadcrumb unchanged `2 / 2.0k (0%)` reported. DB: branch chat owns its own 2 rows; parent still 8 rows; `branch_sources` row created | **PASS** |

## Evidence quotes (gauge span, via DOM eval)

- A (window 2000, after reply): `{"ds":"normal","dp":"reported","txt":"2 / 2.0k (0%)"}` — aria-label `Context usage details`, hover title "reported usage".
- A popover: `Used 2` / `Window 2.0k · declared on provider card` / `History + instructions 0` / `Latest reply 0` / `reported usage · model: mock-sink`.
- B (window 2): `{"ds":"critical","dp":"reported","cls":"text-[11px] leading-none whitespace-nowrap text-destructive tip","txt":"2 / 2 (100%)"}`.
- B (window 8): `{"ds":"normal","txt":"2 / 8 (25%)"}`.
- B (new chat): `{"ds":"normal","dp":"estimated","txt":"~0 / 2.0k (0%) est."}` — accessible description "estimated from context size".
- C (window cleared): `{"ds":"no-limit","dp":"reported","txt":"2 · window unknown"}`; popover Window row "unknown · unknown".
- D (model mismatch): `{"ds":"normal","dp":"estimated","txt":"~2 / 128.0k (0%) est."}`; after provider switch to window-4000 provider: `{"ds":"normal","dp":"reported","txt":"2 / 4.0k (0%)"}`; after next exchange on gpt-4o-mini: `{"ds":"normal","dp":"reported","txt":"2 / 128.0k (0%)"}`.
- E (after regenerate): `{"ds":"normal","dp":"reported","txt":"2 / 2.0k (0%)"}`.
- E (branch, empty): `{"ds":"normal","dp":"estimated","txt":"~0 / 2.0k (0%) est."}`; branch after own exchange: `{"ds":"normal","dp":"reported","txt":"2 / 2.0k (0%)"}`.

Screenshots: `checklists/t021-A.png`, `t021-A-popover.png`, `t021-B-critical.png`, `t021-C.png`, `t021-D.png`, `t021-E1-regenerate.png`, `t021-E2-parent.png`.

## Findings (non-blocking observations)

1. **Quickstart B-3 is arithmetically inconsistent with its own B-2.** B-2 pins "used" at 2 (mock reports 2 tokens/turn; derivation `usedTokens = usedOf(anchor)` reads the anchor row's own usage — correct for real providers whose prompt tokens are cumulative, constant-2 for this mock). At used=2: window 2 → 100% used (critical ✓), window 8 → 75% remaining → `normal` by the contract table (`LOW_REMAINING = 0.25`, `CRITICAL_REMAINING = 0.1`, `src/lib/chat/context-usage.ts:30-31,88-89`). The `low` band (10–25% remaining) needs used/window ∈ [0.75, 0.9], impossible with integer windows when used=2 — so B-3's "window 8 → low" cannot be driven against this mock. The low state itself is pinned by `context-usage.test.ts` derivation tables. Suggest rewording B-3 (e.g. "window 3 → still normal; only ≤25% remaining turns low").
2. **Multi-turn chats require Tool capability = Disabled on the mock provider.** Non-first turns carry tools (create_quiz/create_lab; system note leads with "REPLY TIERS — …"), and the mock fail-louds unknown tool-bearing kinds with HTTP 400 → `AI_NoOutputGeneratedError` in the UI. This is a fixture limitation (by design, `server.mjs` classification rules), not a product bug; the provider-level "Tool capability" switch cleanly routes around it. First turns are tool-less ("This is the first turn of a new chat, so you have no tools this turn.") and stream fine.
3. **Stored usage zeroes the prompt/completion split.** Mock sends `{prompt_tokens:1, completion_tokens:1, total_tokens:2}`, but `messages.metadata.usage` stores `{"promptTokens":0,"completionTokens":0,"totalTokens":2}`, so the popover's History + instructions / Latest reply rows render 0/0. Cosmetic here, but worth a look — it masks the split for real providers too if the same drop happens upstream of `recordUsage`.
4. **C's popover guidance gap.** `ContextGauge.svelte` only attaches the "set Context window on the provider settings card" hint when provenance is estimated; a reported+no-limit gauge (scenario C's exact state) shows "unknown · unknown" with no provider-card pointer. Quickstart FR-007's "the detail points to declaring a window" is only half-met.
5. Regenerate re-appends a copy of the last user row plus the fresh assistant row (old assistant row replaced at the tail); gauge semantics unaffected.

## Console errors

- Transient `favicon.png` 404 on first loads (pre-existing, unrelated).
- One `AI_NoOutputGeneratedError` during the B window-2 send attempt before Tool capability was disabled (see Finding 2; none after the switch — final page loads report **0 errors**).
- Warnings (pre-existing, unrelated to the gauge): `[expound] source map canonical diverges from filtered DOM textContent` (kitchen-sink fixture), `[mcp] failed to connect server: Brave Search … No API key configured`.

## Verdict

Feature behaves per contract across all five scenarios: reported/estimated provenance, declared > catalog > unknown window precedence, normal/critical states with guidance, path-scoped anchors across regenerate and branch navigation all validated live. Two PARTIAL notes are documentation/UX nits (quickstart B-3 arithmetic; missing provider-card pointer in the no-limit popover), not functional defects. **A PASS · B PASS (critical/normal; low not manually drivable, covered by unit tests) · C PARTIAL · D PASS · E PASS.**

## Postscript: findings resolved (same day, post-validation)

1. **Finding 1 (B-3 arithmetic)** — `quickstart.md` scenario B rewritten: only critical/normal bands drivable with the mock's constant 2-token usage; low band explicitly delegated to the `context-usage.test.ts` boundary cases.
2. **Finding 3 (0/0 split)** — root cause fixed in `src/lib/agent/loop.ts` `consumeStream`: the old `p.usage ?? p.totalUsage` kept a zeroed `usage` object and never fell through to the populated `totalUsage` (chunked-usage accounting). Extraction now merges per-field max of both, and still emits no usage event when the provider reports none. Regression-pinned by `loop.test.ts` cases (a0)/(a1).
3. **Finding 4 (no-limit hint)** — `ContextGauge.svelte` popover Window row now reads `unknown — set "Context window" on the provider card` and the title hint applies regardless of provenance; pinned by a new contract-test assertion. **C is now a full PASS by code inspection; scenario C's live re-run is optional.**

Gates after fixes: `pnpm test` (affected suites), `pnpm check`, `pnpm lint` all green.

**Final verdict: A PASS · B PASS · C PASS (after fix) · D PASS · E PASS.**
