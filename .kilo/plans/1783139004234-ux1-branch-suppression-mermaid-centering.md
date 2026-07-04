# UX1 — Branch-tool first-turn suppression + Mermaid centering

**Epic:** `refinement/ui-ux-phased.md` → UX1 (UX1a #2 + UX1b #5).
**Status:** Execution-ready. UX1a and UX1b are independent, no-schema, no-prompt
changes — bundled as one phase but independently mergeable.
**Source decisions:** all resolved in the phased plan (no open items).

## Goal

1. **UX1a:** After a *manual* branch (Expound / Branch message), suppress the
   `branch_chat` tool for exactly the **first** assistant turn on the new branch —
   the seeded summary streams without the model immediately re-branching. Turn 2+
   behave normally; LLM-suggested branches are unchanged.
2. **UX1b:** Mermaid diagram previews open **centered** in the viewport, recenter on
   Reset, and recenter on window resize (today they pin to top-left via
   `moveTo(0,0)`).

No DB migration, no settings change, no prompt change. Pure store/UI logic.

---

## UX1a — Hide `branch_chat` on the first turn after a manual branch

### Mechanism (verified against the code)

- Transient store flag, building on the existing `disabledToolIds` contract that
  already threads through `runAgentTurn` (`src/lib/agent/loop.ts:49`, consumed by
  `buildSdkTools` at `:59`).
- `send` already computes `disabledToolIds: disabledToolsForBrief(rootBriefRaw)`
  at `src/lib/stores/chat.svelte.ts:230` — we spread the conditional `branch_chat`
  into that array.
- The two manual-branch store entry points are `branchFromMessage`
  (`chat.svelte.ts:601`) and the private `createBranchChild` (`:611`). Setting the
  flag in `createBranchChild` also covers `branchFromSelection` (`:546`) and
  `createExpoundBranch` (`:566`), since both delegate to it — so the single
  `createBranchChild` set-site is sufficient **and** `branchFromMessage` is covered
  by setting it there too (it does *not* go through `createBranchChild`). Set it in
  **both** `branchFromMessage` and `createBranchChild` for clarity/explicitness.
- **Exclusion verified:** the LLM-suggested `branch_chat` tool path is
  `src/lib/agent/deterministic-tools.ts:25-45` → `repos.chats.createChild`
  directly. It never touches `chatStore`, so it is correctly **not** suppressed.
- Clear the flag in the `finally` of `send` (`chat.svelte.ts:314-339`) so an aborted
  / failed first turn can never leave suppression stuck on.

### Changes

#### 1. `src/lib/stores/chat.svelte.ts` (edit)

- **Add state field** on `ChatState` (next to the other transient flags, ~`:84`,
  after `pendingApprovals`/near the abort controllers — keep it with the
  non-`$state` private flags is fine, but it must be reactive-readable by tests, so
  make it `$state`):
  ```ts
  /** First-turn-only: suppress `branch_chat` after a manual branch (UX1a). */
  manualBranchPending = $state<boolean>(false);
  ```
- **Set it `true`** at the start of:
  - `branchFromMessage` (`:601`) — before `repos.chats.createChild`.
  - `createBranchChild` (`:611`) — before `repos.chats.createChild` (covers
    `branchFromSelection` + `createExpoundBranch`).
- **Build `disabledToolIds`** at the existing call site (`:230`):
  ```ts
  disabledToolIds: [
  	...disabledToolsForBrief(rootBriefRaw),
  	...(this.manualBranchPending ? ['branch_chat'] : [])
  ],
  ```
- **Clear it in `send`'s `finally`** block (`:314-339`):
  ```ts
  this.manualBranchPending = false;
  ```
  Place it alongside the existing `this.streaming = false` / `this.controller = null`
  resets so the lifecycle is obvious.

> No change to `load()` is required: `load` calls `send`-independent resets and the
> flag is per-`send`. But for robustness against a branch created then never sent
> (user navigates away), clearing `manualBranchPending = false` in `load()`'s reset
> block (where it already resets `streaming`/`inferredBrief`, `:106-118`) is cheap
> and recommended.

#### 2. `src/lib/stores/chat.svelte.test.ts` (edit)

Add a focused `describe('branch_chat first-turn suppression (UX1a)')` block. The
existing suite runs the **real** `runAgentTurn` against mocked `streamText`, so to
observe `disabledToolIds` without perturbing the other suites, wrap the loop module
at the top of the file with `importOriginal` (preserves all current behavior) and
expose the last-seen `disabledToolIds`:

```ts
let lastDisabledToolIds: string[] | undefined;
vi.mock('$lib/agent/loop', async (importOriginal) => {
	const real = await importOriginal<typeof import('$lib/agent/loop')>();
	return {
		...real,
		runAgentTurn: vi.fn(async (deps) => {
			lastDisabledToolIds = deps.disabledToolIds;
			return real.runAgentTurn(deps);
		})
	};
});
```

Tests:
- After `createExpoundBranch(...)` → `load(childId)` → drain `pendingPrompt` →
  `send(...)`: `lastDisabledToolIds` **contains** `'branch_chat'`; after that send
  resolves, a **second** `send(...)` yields `lastDisabledToolIds` that **does not**
  contain `'branch_chat'`.
- After `branchFromMessage(...)` → `load(childId)` → `send(...)`: same assertion
  (first turn suppressed, second turn not).
- **Abort safety:** start `send` then `chatStore.stop()` before it completes → after
  the rejected/aborted send settles, a subsequent `send(...)` does **not** suppress
  (flag cleared in `finally`). Use `mockStreamReply` with a slow/never-finishing
  stream and `chatStore.stop()`, then `vi.waitFor`.
- (Guard) A normal root `send` (no manual branch) never includes `'branch_chat'`
  in `disabledToolIds` (regression: suppression is branch-triggered only).

> Reuse the existing helpers `mockDefaultProvider()` / `mockStreamReply()`. The
> existing branching fixtures (`chatStore branching round-trip`, `:85`) show how to
> build a parent + assistant message to branch from.

---

## UX1b — Center Mermaid diagrams in the preview

### Mechanism (verified against the code)

- The SVG renders into `svgContainer` (`MermaidPreview.svelte:113-120`); the viewport
  pane is the `.flex-1.overflow-hidden` div (`:112`).
- Panzoom is initialized in `onMount` (`:55`); `resetPanZoom` (`:49`) currently pins
  to `moveTo(0,0)` / `zoomAbs(0,0,1)`.
- Centering math: `x = (viewport.w - svg.w) / 2`, `y = (viewport.h - svg.h) / 2`
  (panzoom `moveTo` operates in the transformed coordinate space). Extracted as a
  **pure** helper so it is unit-testable without a DOM/component harness.

### Changes

#### 1. `src/lib/components/chat/mermaid-center.ts` (new — pure helper)

Keep `computeCenter` out of the `.svelte` file so it is trivially unit-testable:

```ts
export interface Box {
	w: number;
	h: number;
}

/**
 * Transform-space offset that centers an SVG of size `svg` inside a viewport of
 * size `viewport` for panzoom's `moveTo`. Pure — no DOM.
 */
export function computeCenter(viewport: Box, svg: Box): { x: number; y: number } {
	return {
		x: (viewport.w - svg.w) / 2,
		y: (viewport.h - svg.h) / 2
	};
}
```

#### 2. `src/lib/components/chat/MermaidPreview.svelte` (edit)

- **Import** `computeCenter` from `./mermaid-center`.
- **New `centerView()`** (replaces the body of `resetPanZoom`'s transform calls):
  - Measure the SVG: `svgContainer?.firstElementChild?.getBoundingClientRect()`.
  - Measure the viewport pane: the parent `.flex-1.overflow-hidden` element. Bind a
    reference to it (e.g. `let viewportPane = $state<HTMLDivElement | null>(null);`
    on the `<div class="flex-1 overflow-hidden">`).
  - Guard: if either width/height is 0 (SVG not laid out yet) → return without
    moving (caller retries via rAF).
  - `const { x, y } = computeCenter(viewportBox, svgBox);`
  - `pzInstance.moveTo(x, y); pzInstance.zoomAbs(x, y, 1);`
- **`onMount`** (`:55`): after panzoom is built, call `centerView()` with a
  `requestAnimationFrame` retry loop until the measured `svgWidth > 0` (cap retries,
  e.g. ~30 frames / 500 ms, then give up silently).
- **`resetPanZoom`** (`:49`): replace the hardcoded
  `moveTo(0,0)` / `zoomAbs(0,0,1)` with `centerView()`.
- **`ResizeObserver`**: add one on `viewportPane` in `onMount` (and disconnect in a
  returned teardown / `beforeUnmount`-equivalent) that re-runs `centerView()` (with
  the same rAF retry) so reset stays correct after window resize. Guard `if
  (typeof ResizeObserver === 'undefined') return;` for safety.

> Note: panzoom applies transforms to the `svgContainer` element itself, so measuring
  `svgContainer.firstElementChild` (the actual `<svg>`) and the `viewportPane` (the
  element whose overflow clips) gives the right boxes. The manual gate confirms the
  visual result.

#### 3. `src/lib/components/chat/mermaid-center.test.ts` (new)

Pure unit tests for `computeCenter`:
- SVG smaller than viewport → positive offsets that center it (e.g. viewport
  `1000×800`, svg `400×300` → `{ x: 300, y: 250 }`).
- SVG larger than viewport → negative offsets (centers the overflow; pan/zoom still
  lets the user explore).
- Square-in-square and equal-size (offset `0,0`) cases.
- Does not mutate inputs.

> Panzoom/DOM centering itself is a **manual** gate (no headless DOM in CI).

---

## Out of scope

- Persistent suppression across reload (decided acceptable in the refinement spec —
  it is a transient, in-session nudge).
- Any change to the `branch_chat` tool definition, risk tier, or approval flow.
- Any prompt/system-note change (suppression is purely via `disabledToolIds`).
- Mermaid rendering, sanitization, or theming — only viewport centering.
- UX2–UX5 (separate phases).

## Risks / edge cases

- **Suppression stuck on after a failed/aborted first turn.** Mitigated by clearing
  `manualBranchPending` in `send`'s `finally` and in `load()`'s reset — covered by
  the abort-safety test.
- **`createBranchChild` set-site double-counts with `branchFromMessage`.** Not an
  issue: `branchFromMessage` does not call `createBranchChild`, so each path sets the
  flag once. If both are set for clarity, the flag is idempotent (`true` twice is
  still `true`).
- **LLM-suggested branch (`branch_chat` tool) wrongly suppressed.** Excluded by
  construction: that path goes through `deterministic-tools.ts` → `repos` and never
  sets the flag. Add a guard test asserting a plain root `send` never suppresses.
- **SVG not laid out at `onMount` time → center to (0,0).** Mitigated by the rAF
  retry loop until `svgWidth > 0`.
- **`ResizeObserver` unavailable (very old browser).** Guarded; falls back to
  open/reset-only centering (no crash).
- **Panzoom `moveTo` coordinate space.** If manual testing shows drift, the pure
  `computeCenter` math is the single place to adjust; tests pin the expected output.

## Verification

- **Automated:** `pnpm test` — new `branch_chat first-turn suppression (UX1a)`
  block in `chat.svelte.test.ts`; new `mermaid-center.test.ts`. Plus `pnpm check`
  and `pnpm lint` clean.
- **Manual (UX1a):** `pnpm dev` → Expound an excerpt → the seeded summary streams
  with **no** branch offer/tool call on turn 1; type a second message → turn 2+
  behaves normally (model may branch). Click **Branch** on a message → first typed
  message on the new branch has no branch offer. Watch an LLM-suggested branch
  (turn 2+) — unchanged.
- **Manual (UX1b):** `pnpm dev` → open a Mermaid diagram → **centered** on open.
  Pan/zoom → **Reset** → recenters. Resize the window → reopen/reset → still
  centered. A large diagram still centers (minZoom `0.5` allows shrink-to-fit).

## Suggested commit split

1. UX1b (mermaid-center.ts + MermaidPreview.svelte + test) — fully independent.
2. UX1a (chat.svelte.ts + test) — fully independent.
