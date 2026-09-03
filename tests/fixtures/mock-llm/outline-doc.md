# The Long Outline Field Guide

This document exists so a human or an agent can exercise the section peek strip without inventing content on the fly. It is deliberately longer than one transcript viewport and deliberately uneven: some sections are long, some are one-liners, and two share a title. Every sentence is plain deterministic prose, so automated assertions can quote it verbatim.

## How to read this guide

The guide is organized as a sequence of numbered field notes. Each field note is a heading-delimited section, and the strip beside the transcript renders exactly one tick per note, left-aligned at the chat border, with a width proportional to the note's length. Reading the strip from top to bottom is therefore the same as reading the reply from top to bottom, which is the entire point of the affordance.

If you are validating the strip by hand, hover the gutter to brighten the ticks, pause on one to extend it rightward, dwell a moment longer to open the floating preview, and click to jump. If you are validating by automation, assert the geometry instead: the gutter sits to the right of the scrollbar, the ticks sit beside their sections, and no reply content ever moves.

## Field note one: why long replies need a map

A long reply without a map is a corridor without doors. The reader scrolls, and scrolls, and the sense of where things are decays with every wheel tick, because prose all looks the same when you are inside it. A map fixes this by making the shape of the reply visible from anywhere: you can see that the reply has seven parts, that the fourth is the longest, and that you are currently in the second.

The section peek strip is that map in miniature. It does not ask for a sidebar, it does not push the conversation aside, and it does not demand attention while you read. It waits at the edge of the chat as a hairline, and only speaks up when the pointer comes looking for it.

This note is long on purpose: its tick should be one of the widest in the strip, noticeably wider than the ticks of the one-line field notes later in the guide. Proportionality is not decoration; it is the data.

## Field note two: the rest state

At rest the strip should be almost invisible. The ticks are two pixels tall, rendered in the border color, and read as a faint ruler rather than as interface chrome. If the rest state catches your eye before you go looking for it, it is too loud, and the fix is more opacity, not less.

Rest state is also the honest state: the ticks are there even when you are not hovering, so the reply's shape is always one glance away. A map that only exists while you hold the pointer somewhere is a menu, not a map.

## Recap

This recap is deliberately short, and its title is deliberately duplicated later in the guide. A one-paragraph section gets the minimum tick width, and a duplicated title must never make a jump land on the first occurrence when the second was clicked. Keep both facts in mind during validation.

## Field note three: hover and intent

Hovering the gutter brightens every tick at once, because the first thing a user wants when they reach for the edge is a readable map of the whole reply. Only after the gutter has the pointer's attention does the per-tick affordance appear: pausing on a single tick extends it a few pixels to the right, marking it as the one under the cursor.

The extension is small by design. A tick that grows into a dash the width of the gutter stops being a tick and starts being a button, and buttons invite clicks the pointer did not mean to make. A few pixels is a whisper of here I am.

## Field note four: the dwell and the preview

A click inside a long reply is a commitment: the viewport moves, the reading position changes, and getting back costs another scroll. The dwell preview exists so the commitment is informed. Pause on a tick for a moment and a floating window opens outside the chat area, anchored to the tick, showing the section's heading and its opening lines as plain text.

The preview is a window, not a panel. It overlays whatever sits beneath it, it never reflows the reply, and it disappears the moment the pointer leaves the gutter. If a preview lingers after the pointer has moved on, it has broken its single most important rule.

## Field note five: scrolling stays native

The gutter is a guest in the transcript's margins, and guests do not intercept the host's gestures. Wheel events over the ticks must scroll the conversation exactly as they would over bare background, touch drags must drag the transcript, and the scrollbar between the chat and the ticks must remain the scrollbar, not become part of the strip.

This rule is what keeps the strip feeling like furniture rather than like a modal. The moment a navigation affordance steals a scroll gesture it becomes a hazard, and hazards get disabled by users who have better things to do than fight their tools.

## Field note six: proportional, not exact

Tick width encodes section length, but encoding is not drafting. Very short sections keep a minimum visible width so they stay reachable, and the whole strip respects the geometry of the gutter it lives in. What proportionality buys is honest comparison at a glance: the longest note in this guide should have one of the widest ticks, and a one-line note should never look like a chapter.

## How to read this guide, again

Reading it twice is the duplicate-title test. This section shares its heading with the first field note of the guide, far above, and a strip click on this section's tick must land here, at this second occurrence, never up at the first. Duplicated titles are ordinary in real replies; navigation that cannot tell them apart is broken in exactly the cases that matter.

## Field note seven: edits and staleness

A strip that outlives its reply is a liar. When a reply is regenerated, the ticks must vanish while the new text streams, then return describing the new structure, with previews quoting the new sections. Nothing in this guide survives a regeneration, and nothing in the strip should either.

## Recap

The second recap closes the guide, and it too is short. Two recaps, two one-tick-wide sections, one duplicated heading pair, and one long stretch of prose in between: this document is a shape before it is a text, which makes it a fixture for a shape-reading affordance. Validation ends here; scroll back with the strip and notice that you never once reached for the scrollbar thumb.
