# Smooth streaming — steady cadence with a soft blur edge

**What**: Streaming chat replies emerge at a steady, calm cadence with a soft blur edge at the growth point — no bursty pop-in — with the look exposed as a single preset-shaped appearance setting.

**Why**: Streamed text currently appears chunk-by-chunk as markdown re-renders, which reads as flicker and makes generation feel cheap; steady cadence plus a soft edge makes streaming feel polished and intentional without touching the markdown DOM shape.

## The path

Insert a small buffer between the network stream and the markdown renderer: raw chunks land in the buffer and a render tick releases text at a steady cadence, releasing on word/safe boundaries, draining faster as the buffer grows, and easing the final drain at stream end so completion never reads as a burst. On top of that base, add a CSS blur/fade mask pinned to the growing edge of the in-flight block, which lifts with a short un-blur transition on completion; the message body's DOM keeps its exact current shape, so the source map, expound selection alignment, full-text search, and copy buttons are untouched by construction. Ship the combination behind one appearance setting with preset naming (e.g. Calm = plain cursor only, Standard = today, Expressive = cadence + edge) so future visual effects slot into the same setting instead of new toggles. This spec seed is a hybrid: the cadence layer is Card 003 (smoothed-streaming) and the visual layer is Card 002 (streaming-edge-blur), with Card 005's preset-shaped setting framing.

## Known snags

- Boundary awareness: releasing text at arbitrary ticks can split words or open markdown constructs mid-tick — bites on code-heavy replies; mostly self-corrects, mitigate with markdown-aware release points.
- Pacing is a product decision: cadence too slow makes fast models feel throttled (users read streaming speed as model speed); adaptive release and tuning is where the real time goes, and a few hundred ms of hidden-but-arrived text is accepted.
- Edge mask vs. non-paragraph content: the mask misbehaves when the growth edge is a code block, list, or table — suppress or soften the effect there; bites the first time a reply ends in one.
- Mask re-wrap tracking: the growth edge re-wraps as chunks land; expect fiddly cosmetic iteration on long flowing replies.
- Completion moment: final buffer drain and mask removal must be eased together, or the end of the stream itself looks like a burst.
- Selection under the mask: `pointer-events: none` on the overlay; selecting text mid-stream under a blur looks odd (accepted, rare).

## Accepted trade-offs

- Deliberate latency of a few hundred milliseconds between arrival and display.
- One more stateful component (the pacing buffer) in the chat pipeline to test and maintain.
- No per-word effects gallery: one effect with a dial/preset — typewriter, drop-in, and span-level effects are explicitly out of scope for this path.
- The payoff is the absence of roughness — nobody says "wow"; the win is "this feels nice."

## The bet

This wins if the original pain — flicker and burstiness making streaming feel cheap — matters more than per-word spectacle: the cadence layer kills the roughness, the soft edge supplies the visual identity the idea wanted, and because the markdown DOM never changes shape, expound, sourcemap alignment, search, and copy keep working untouched.
