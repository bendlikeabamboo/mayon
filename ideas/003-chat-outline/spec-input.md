# Spec input for /speckit.specify — Section peek strip (chat outline, Card 006)

Source decision: ideas/003-chat-outline/decisions.md (verdict 2026-09-02, winner Card 006 — hover-peek-bars; runner-up Card 001).

## What & why

As a user, when the LLM replies with long, header-structured messages, I can quickly find and jump to the part of the reply I care about without scrolling through all of it. Today, locating a section means scrolling and eyeballing — long replies are hard to search in the UI.

## Chosen path: hover-peek bars

For replies that exceed a length/header-count threshold, render a slim strip along the reply's edge: one horizontal bar per section (header-delimited), sized proportionally to the section's length. At rest the strip is a subtle hairline — near-invisible. Hovering fattens the bars; a deliberate dwell pops a preview card showing that section's heading and opening lines; clicking the preview or bar smooth-scrolls the transcript to that section. The strip is per-reply navigation chrome inside the chat transcript, derived non-destructively from rendered headers (never by mutating the markdown source).

## Required behaviors

- **Toggle-able** (explicit user requirement): a setting turns the strip on/off; preference persists.
- **Threshold**: only sufficiently long/multi-section replies get a strip — no TOC noise on short replies.
- **Streaming**: replies stream in; the strip must not thrash while sections arrive (e.g. appear once the reply completes or has a stable set of sections — decide in spec).
- **Jump**: click preview/bar scrolls to the section within the transcript's scroll container, correct even with multiple long messages.
- **Where-am-I (optional)**: a position marker on the strip indicating the current viewport. Nice-to-have; this is the upgrade path toward Card 001, keep it out of the first cut if it adds risk.

## Known snags to design around (from the playthrough)

- **Hover-intent tuning**: dwell too short → previews fire while merely crossing the edge (the distraction returns); too long → feels dead. Dismiss promptly on pointer leave.
- **Preview freshness/cost**: live-rendering section markdown per hover is too expensive and shifts during streaming — cache plain-text excerpts per section; excerpts must refresh on edit/regenerate.
- **Touch fallback**: no hover on touch — either tap = jump directly (skip preview) or hide the strip on touch; pick one.
- **Hit targets & pointer discipline**: small bars need generous hit areas; the strip must not steal scroll/wheel events or block transcript interactions.
- **Expound/selection alignment**: the strip and preview are injected DOM elements with text content — their selectors must be added to the expound excluded-selectors list (selection.ts) or text selection and source-map alignment break.
- **No markdown mutation**: outline is built from rendered headers via the existing markdown pipeline only.

## Out of scope

- Persistent floating outline panel (Card 001 — runner-up, possible future upgrade).
- Heading anchor deep links (Card 004 — cheap rider, candidate follow-up).
- Accordion-collapsed replies (Card 005 — rejected).
- Reply content search beyond section jumps.

## Success criteria

- A user can read a long reply's section shape at a glance and jump to a known section in ~2 interactions, with no permanent screen chrome.
- Toggling the setting removes the strip entirely.
- No regressions in text selection, highlight/expound alignment, or copy inside replies.
