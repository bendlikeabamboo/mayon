---
card: 004
name: heading-anchors
origin: dealt
bet: Wins if browser find already covers most of the need and the real gap is stable deep links to sections
played: yes
---

# Card 004 — Heading anchors + browser find

## Story

Headers inside replies become hoverable anchors, GitHub-style, and browser Ctrl-F does the searching you already know. Copying a heading's anchor link gives you a deep link that drops the chat at that section. The app itself ships almost no new UI — it leans on behavior you already use everywhere else.

## Playthrough (2026-09-02)

- **What/why checked against**: jump to the part of a long reply without scrolling all of it; long header-heavy replies are hard to search in the UI today.
- **How it goes**: You ship it in days — hover a header, an anchor appears, click-to-copy gives a stable deep link into that exact section. The sleeper payoff arrives first: those links work from anywhere, so notes and bookmarks can point at "the part about migration". Then the limits show: browser Ctrl-F is message-blind, matching the question text, earlier replies, and this one indiscriminately, so "search" means sifting hits rather than scanning an outline. Deterministic IDs for streamed, re-rendered markdown take care; three "Summary" headers in one reply become summary / summary-1 / summary-2 and shifts rename targets. And the hover anchor is itself small injected chrome with the usual selection-alignment obligations.
- **Snags**: browser find's blindness — every search, immediately — the core miss; ID stability under streaming/rename — whenever content shifts — medium, silent breakage of saved links; near-invisible feature — always — users may never discover anchors exist.
- **Trade-offs**: gives up all orientation and ambient navigation; gains deep-linking, which no other card in the deck offers; near-zero ongoing maintenance.
- **Delivers the what?**: thin — jumping improves only via links you've already made; searching is whatever the browser's find already gives, scoped worse; no shape-of-the-reply at all.
- **Difficulty vs payoff**: difficulty S · payoff L–M · time-to-first-value days
- **Your take**: (none — moved straight on with `next`; Kit suggested keeping it as a rider on whichever card wins)
