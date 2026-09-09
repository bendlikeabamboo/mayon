---
card: 005
name: appearance-effect-presets
origin: dealt
bet: Wins if users actually want to tune the look and more effect surfaces are coming; loses if it is framework-first scope for a single effect
played: yes
---

# Card 005 — Appearance effect presets

## Story

You build the "configurable" half of the idea as the product itself: an appearance setting with named effect presets — say Calm, Standard, Expressive — where each preset maps to a bundle of visual effects across surfaces. Blur-in streaming is the headline effect of Expressive, while Calm might be plain text plus a soft fade, and the same preset governs other reveal moments like expound highlights or thinking blocks. Every future visual effect slots into a preset instead of becoming a one-off toggle.

## Playthrough (2026-09-08)

- **How it goes**: You spend the first weeks on the framework: a small effect registry, named presets (Calm / Standard / Expressive), surfaces (streaming reveal, completion fade, expound highlight, thinking block) declaring effect slots. Calm is today's app, Standard is a soft completion fade, Expressive debounces blur-in streaming as its headline. It feels like infrastructure — because it is — and the demo moment arrives late: users see one new effect wrapped in a system built for many. The trap springs when the third surface lands: effects don't transfer cleanly across surfaces (a paragraph fade isn't a highlight reveal), so presets leak into per-surface parameter matrices, the settings UI grows a grid, and QA multiplies by presets × surfaces × the mandatory "off" that must work everywhere.
- **Snags**: (1) Framework-before-effect inversion — visible user value is the last thing to ship; bites morale and roadmap from day one. (2) Effect × surface matrix — bites when the second and third effects/surfaces arrive; the abstraction that felt clean at one effect becomes a maintenance grid. (3) Design coherence — bundles of independent toggles easily read as theme-shop clutter; keeping Calm/Standard/Expressive genuinely _designed_ is real design work in an app whose visual language is deliberately restrained.
- **Trade-offs**: Worst time-to-first-value in the deck; speculative generality risk (a framework built for one effect is the classic YAGNI shape); settings surface complexity grows permanently. In exchange: "configurable" becomes real, and every future effect gets cheaper to add.
- **Delivers the what?**: Partially now, fully later — configurability is delivered as the product, but the actual streaming emergence is late, and the what is about streaming feeling better _now_.
- **Difficulty vs payoff**: difficulty L · payoff M (H only if the effects program actually grows) · time-to-first-value 2–3 weeks
- **Your take**: (none — moved on with `next`)
