# LS3 — Pacing-gate suggested-reply chips

Implementation plan for phase **LS3** of `refinement/learning-structure-phased.md`.
Depends on **LS1** (complete: `strategies.ts` registry + helpers exist). Independent
of LS2.

## Goal

Gated teaching strategies surface their gate options as tappable chips in the
Composer. One tap sends the chip text through the **identical** `onSend` path the
user would hit by typing + ⌘/Ctrl+Enter. Tier 1 only — static per-strategy lists,
no parsing of model output.

## Locked decisions (resolved in planning)

1. **Resolve chips from the cached root brief** — branches inherit the root's
   strategy, so they get chips too (matches design §12 + the LS1 branching
   acceptance gate). The root chat object is **already loaded** in `loadNav` via
   `listSubtree`; no extra DB query. Cache it in `$state`.
2. **Hide chips on draft** — chips render only when the textarea is empty **and**
   not streaming. This is the "inert if the user types" rule: chips vanish the
   moment text is entered, reappear when cleared. Preserves chip→send parity
   (clicking "continue" is byte-identical to typing "continue" + Send).
3. **Unify the brief summary chip (the `Target` pill) onto the same cached root
   brief** — branches now also render the pill with its existing `(inherited)`
   label. One brief source; coherent.
4. **`replies` values** (verbatim from the phased plan): `guided-curriculum` →
   `['continue', 'go deeper']`; `workshop` → `['next', 'paste the error']`;
   `guided-inquiry` (non-gated) → none. **Only these two gated strategies exist
   in LS1**; `quick-orientation`/`deep-dive`/etc. land in LS4.
5. **Use `strategyForBrief(rootBrief)`** for chips — equivalent to
   `resolveStrategy(brief, profile)` because the stored root brief already
   snapshotted the resolved strategy (via `applyProfile` at intake/edit). No
   async profile fetch in the route.
6. **`/chat/+page.svelte` (new-chat list) is unchanged** — it renders no
   Composer. (The phased plan's mention of it is an error.) Chips apply only to
   `/chat/[id]/+page.svelte`.

## Files to change

### 1. `src/lib/chat/strategies.ts` — add `replies?`

- Add `replies?: string[]` to `ScopeStrategy` (present iff `gated`). Order it
  after `gated`, before `block`.
- Populate the two gated strategies present in LS1:
  - `guided-curriculum`: `replies: ['continue', 'go deeper']`
  - `workshop`: `replies: ['next', 'paste the error']`
- `guided-inquiry` stays `gated: false` with no `replies`.
- No interface/helper signature changes; existing exports (`resolveStrategy`,
  `strategyForBrief`, `strategiesForMode`, `defaultStrategyFor`) unchanged.

### 2. `src/lib/components/chat/Composer.svelte` — chip row

- Add prop `suggestedReplies?: string[]`.
- Add a derived visibility rule:
  `const showChips = !!suggestedReplies?.length && !streaming && prompt.trim().length === 0;`
- Add a handler `sendChip(text)`:
  `void onSend(text, reasoning);` (the textarea is empty when chips are visible,
  so no draft to clear; still set `prompt = ''` to mirror `send()` exactly).
- Render a wrapping row of small `Button variant="outline" size="sm"` chips
  **above** the existing textarea/buttons row, gated by `{#if showChips}`. Each
  chip: `onclick={() => sendChip(chip)}`, `{#each suggestedReplies as chip}`.
- No change to the existing send/stop/thinking controls or their `disabled`
  rules. While `streaming`, `showChips` is already false.

### 3. `src/routes/chat/[id]/+page.svelte` — resolve + thread the prop

- Import `strategyForBrief` (re-exported from `$lib/chat/brief`).
- Add `let rootChat = $state<Chat | null>(null);`
- In `loadNav(chat)`, after building `byId` from the subtree, set:
  `rootChat = byId.get(chat.rootId) ?? chat;`
- Replace the existing `rootBrief` derived with a unified version that reads the
  root for branches and the live chat for roots (so root edits stay reactive):
  ```ts
  const rootBrief = $derived<LearningBrief | null>(
    chatStore.chat
      ? parseBrief(
          chatStore.chat.parentId === null ? chatStore.chat.brief : rootChat?.brief ?? null
        )
      : null
  );
  ```
- Derive the active strategy + chip list:
  ```ts
  const activeStrategy = $derived(rootBrief ? strategyForBrief(rootBrief) : null);
  const suggestedReplies = $derived(activeStrategy?.replies);
  ```
- Pass to the Composer: `suggestedReplies={suggestedReplies}` (already `<Composer …/>`
  at `+page.svelte:363`). `undefined`/empty → Composer renders no chips.
- Reset `rootChat = null` at the top of `loadAll` (alongside the other resets) so
  a stale root brief never leaks across chat switches.
- No changes to the intake/edit/inferred branch logic — `rootBrief` still feeds
  them, now correctly non-null on branches. Brief editing remains root-only
  (branch summary-chip click is already disabled via the `parentId` guard).

## Data flow

```
loadNav → rootChat (cached, from listSubtree) ─┐
chatStore.chat.brief (live, root only) ─────────┴→ rootBrief (derived)
                                                        │
                                              strategyForBrief → activeStrategy
                                                        │
                                                  .replies → suggestedReplies
                                                        │
                                          Composer.suggestedReplies prop
                                                        │
                                  showChips = replies && !streaming && empty
                                                        │
                                  chip click → onSend(chip, reasoning) ─→ chatStore.send
```

## Tests

Extend `src/lib/chat/strategies.test.ts` (pure-module contract; no Composer/DOM
test exists and chip rendering is trivial UI):

- New block: **gated strategies have non-empty `replies`; non-gated have none.**
  - `guided-curriculum` → `gated === true`, `replies` is a non-empty array.
  - `workshop` → `gated === true`, `replies` is a non-empty array.
  - `guided-inquiry` → `gated === false`, `replies` is `undefined`.
- Optionally generalize: loop `SCOPE_STRATEGIES` asserting
  `s.gated ? Array.isArray(s.replies) && s.replies.length > 0 : s.replies === undefined`.
- Existing assertions ("each entry has non-empty block/label/hint, one mode,
  gated set") stay green — `replies?` is additive.

The contract worth pinning is **"gated ⇒ chips, non-gated ⇒ none"** at the
registry level. Chip→send parity is enforced by routing the click through the
same `onSend` (verified manually).

## Acceptance

- `pnpm test`, `pnpm check`, `pnpm lint` all clean.
- **Manual (Explainer):** intake → Guided curriculum → orientation reply lands →
  "continue" / "go deeper" chips appear above the composer → tap "continue"
  sends the next unit. Reload → chips persist (derived from the persisted brief).
- **Manual (Build):** workshop increment lands → "next" chip sends the next step.
- **Manual (Socratic):** a `guided-inquiry` chat shows **no** chips.
- **Typing:** typing into the textarea hides the chips; clearing it brings them
  back. Typing the chip's text + ⌘/Ctrl+Enter is indistinguishable from tapping.
- **Branch inheritance:** branch off an Explainer chat mid-curriculum → chips
  still appear (resolved from the root brief), and the summary pill shows
  "(inherited)".
- **Null brief:** a "Just start chatting" chat shows no chips (rootBrief null).

## Risks / edge cases

- **chip→send parity (hard requirement):** a chip MUST go through the same
  `chatStore.send` path with the same persistence — no special-casing. Satisfied
  by calling `onSend(chip, reasoning)` from inside Composer (which already owns
  `reasoning`). Do not add a separate send path.
- **Stale root brief across chat switches:** reset `rootChat = null` in
  `loadAll`; it is repopulated in `loadNav`. Root edits stay reactive via the
  `parentId === null` branch of `rootBrief`.
- **Branching + caching:** the cached `rootChat` is only read on branches
  (`parentId !== null`), where the brief is immutable (root-only editing). Safe.
- **Summary-chip behavior change:** unifying `rootBrief` makes branches show the
  "(inherited)" pill (previously hidden). This is intended (decision #3) and the
  label already exists; verify it renders correctly on a branch.
- **No migration:** `replies` is a code-only field on the in-memory registry; it
  is never stored. The `chats.brief` JSON column is unchanged — no
  `db:generate`/`bundle:migrations`.

## Out of scope

- Tier-2 structured gates (`{nextUnit, options, progress}` fence + progress rail)
  — LS4.
- The remaining 7 strategies and profile-default/inferred-brief wiring — LS4.
- Any change to `/chat/+page.svelte`, `BriefCard.svelte`, `chatStore`, or the
  context/prompt assembly.
