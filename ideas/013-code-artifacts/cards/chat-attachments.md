---
card: 002
name: chat-attachments
origin: dealt
bet: Wins if "tracked with the message it contextualizes" captures most of the value and a separate workspace would be over-building
played: yes
---

# Card 002 — Chat attachments

## Story

You are mid-conversation, paste a 200-line file, and Mayon folds it into an attachment on your message — collapsed to a name and a chip in the UI, full text stored on the transcript. When the model assembles its context, the attachment rides along with that message, and later turns can reference it by name. Reopen the chat tomorrow and your code is exactly where the conversation left it. No new section, no new store — the transcript already knows how to keep things.

## Playthrough (2026-11-09)

- **How it goes**: Ships fastest of the deck by reusing the transcript — paste becomes an attachment on the message (chip UI, full text on the record) and rides into context automatically; day one already feels like the whole feature. The bill arrives in long-lived chats: attachments never stop riding, so an aging thread pays context rent on every file ever attached, with no cap — mitigation means trimming/summarizing old attachments, which is context-management work returning in a cheaper jacket. Attachments die with their chat (re-attach in the next conversation — ferry-work at chat boundaries), and re-attaching an updated file leaves version ghosts the model may cite over the fresh copy.
- **Snags**: Unbounded context growth in long chats — bites as chats age — medium/bad without trimming. No cross-chat reuse — bites at the next conversation — medium; per-chat scope chosen by fiat. Version ghosts after re-attach — mild/medium; provenance confusion.
- **Trade-offs**: Gives up the working-set mental model (no section to scan, nothing that says "what Mayon knows"); no growth headroom (no cap, no on-demand consult); provenance over liveness — anchored to the moment of the paste.
- **Delivers the what?**: Partially. Durable: yes, inside the transcript. Tracked: yes, per message. "Consults on demand": no — always-include, the model never looks; and nothing outlives the chat it was pasted into.
- **Difficulty vs payoff**: difficulty S–M · payoff M–H (peaks with short-lived chats) · time-to-first-value days–1 week.
- **Your take**: Burns one chat per task, and within a task the code morphs into something else. Scope: per conversation, with a latest-version-wins context policy — only the most recent attachment of a given file rides in context. That policy retires the version-ghost snag and caps growth; combined with short-lived task chats, the warehouse-bloat snag mostly evaporates and re-attaching fresh code per task becomes the norm rather than ferry-work.
