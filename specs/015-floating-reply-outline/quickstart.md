# Quickstart: Floating Reply Outline — Validation Guide

**Feature**: specs/015-floating-reply-outline

End-to-end scenarios proving the spec's success criteria. No implementation code here —
for module/behavior details see [contracts/reply-outline.md](./contracts/reply-outline.md)
and [data-model.md](./data-model.md).

## Prerequisites

- Node 22 (` .nvmrc`), pnpm 10, Docker or Podman (`MAYON_DEV_ENGINE`).
- `pnpm install` at repo root. On a fresh checkout build `@mayon/shared` first / or just use
  the dev stack which handles it: `pnpm dev:build` after dependency or shared changes.
- Bring up the dev stack: `pnpm dev` (web HMR on http://localhost:5173, server :4319, db).
- Configure any working LLM provider in Settings → Providers so the assistant can reply.

## Static gates (run from repo root)

```bash
pnpm check          # svelte-check
pnpm lint           # ESLint + Prettier --check
pnpm test           # Vitest (includes new headings/entries units + source-contract tests;
                    #  src/lib/chat/selection.test.ts must pass UNCHANGED — expound safety net)
```

## Scenarios

Seed data: a conversation containing at least one **long assistant reply with several
markdown headings** (mix `##`/`###`, at least one duplicate heading text, and a fenced code
block containing `# not a heading`). Any model reply with structure works; craft the duplicate
manually if needed.

### S1 — Outline mirrors the reply (FR-001/005, FR-010) → SC-001 precondition

Open the conversation. The outline affordance is visible; opening it lists exactly the
reply's real headings in document order, nested by level. The `#` line inside the code fence
is absent; code/callout text never appears. Open a conversation whose replies have **no**
headings — the affordance is hidden entirely.

### S2 — One-click jump (FR-004) → SC-001, SC-002

From the top of a long reply, click a mid-document entry. The conversation scrolls so the
heading sits at the top of the viewport (with its scroll offset), the heading briefly
flashes (~1–2 s, self-fading), and the whole action is one interaction with zero manual
scrolling. Repeat with a 10+ heading reply — a known section is reached in under 3 seconds.

### S3 — Duplicate headings jump positionally (FR-007)

Click each of the two identically named entries in turn. The first lands on occurrence 1,
the second on occurrence 2.

### S4 — Scroll-spy without history (FR-008) → SC-003

With the outline open, scroll manually through the reply. The highlight follows the section
in view and rests on the correct section when scrolling stops (check near the bottom edge
too — at-bottom clamps to the last entry). Press Back afterwards: no history entries were
created by highlight changes; the browser leaves the page.

### S5 — Streaming jump (FR-006, stick suppression)

Ask for a long structured answer. While the reply is still streaming, open the outline
(entries appear as headings arrive) and jump to an early heading. The viewport stays at the
heading — it is **not** yanked back to the bottom by streaming flushes. Entries continue
growing; the active highlight remains sane. Sending the next user message restores normal
follow-the-stream behavior (stick-to-bottom works again).

### S6 — Retargeting across replies (FR-003)

In a conversation with ≥2 structured replies, scroll from one into the next. The outline's
entries swap to the reply now occupying the viewport; jumping from the new list lands in
that reply.

### S7 — Dismiss / reopen (FR-009)

Dismiss the outline mid-read: scroll position and content do not move. Reopen: it reflects
the current reading position immediately.

### S8 — Narrow viewport + reduced motion (FR-011, FR-012) → SC-006

At < 1280px width the desktop panel is replaced by the floating round button (clear of the
composer, honoring the safe-area inset). Two taps: open sheet → pick section → landed
exactly as on desktop; dismissing the sheet without picking changes nothing. With OS
reduced-motion enabled, jumps move instantly while landing position and flash-class behavior
stay identical.

### S9 — Expound / selection non-interference (FR-013) → SC-005

With the outline open and overlaying part of the view: select text inside the reply → the
expound menu appears and creating a highlight works; saved expound marks render as before;
the code-block copy button still works. Then run `pnpm test` and confirm
`src/lib/chat/selection.test.ts` passed unchanged.

### S10 — Layout neutrality (FR-002) → SC-004

Toggle the outline open/closed repeatedly during reading and while scrolled to the bottom:
conversation content never shifts or reflows (no jump of the scroll position when the panel
opens).

### S11 — Perf probe (Constitution IV)

With `pnpm dev` running:

```js
window.__MAYON_PERF__ = 1;
localStorage.mayon_perf_scenario = 'reply-outline';
```

Read a long structured reply, scroll through it, and jump via the outline while a reply
streams. Compare `[mayon-perf]` output against a baseline run with the feature paths not
exercised: frame timing / longtasks show no material regression; the summary contains
`outline:extract` marks (and `ReplyOutline` render counts) — extraction should be near-zero
except on content change (memoization).

## Expected outcomes

- All scenarios behave as stated; static gates green; no new dependencies in `package.json`;
  `git status` shows no schema/migration changes.
- Spec success criteria SC-001…SC-007 are each witnessed by the scenarios mapped above.
