# Decisions: 010-streaming-text-animation

- Created: 2026-09-08T18:50:59Z

## Verdict

- **Winner**: `user-defined` hybrid — cards/smoothed-streaming.md (003) as the cadence base + cards/streaming-edge-blur.md (002) as the visual layer, framed by cards/appearance-effect-presets.md's (005) preset-shaped setting.
- **Runner-up**: cards/flowtoken-blur-streaming.md (001, user card) — maximum fidelity to the original ask (per-word configurable blur), passed over for the completion-swap flash and the sourcemap/expound risk of a second DOM shape.
- **Why**: the playthroughs pointed at cadence (burstiness/flicker) as the real pain; the edge blur adds visual identity with zero DOM-shape change, keeping expound/sourcemap/search/copy untouched by construction.
- **Date**: 2026-09-08
- **Spec seed**: [spec.md](spec.md) (this folder) — paste-ready for /speckit.specify.
