---
card: 002
name: images-only
origin: dealt
bet: Wins if vision is 90% of real demand and a small shippable slice beats building a modality framework
played: yes
---

# Card 002 — Images only (smaller)

## Story

You ship one thing: attach or paste an image into the composer, gated on the model advertising vision. The first thing that happens is a user pastes a stack-trace screenshot or a UI mock and the model reads it directly. Voice, video, and documents wait — each gets its own idea if the demand ever shows up.

## Playthrough (2026-09-02)

- **What & why** (recorded at play time, confirmed by user at deal time): Let users feed non-text input — images, video, audio/voice, files — into a chat when the connected model supports that modality. Why: composer and server LLM path are text-only today, so multimodal models deliver none of that value inside Mayon.
- **How it goes**: Messages become content parts with just two kinds (text, image); the composer learns paste/attach with thumbnail preview; the proxy passes parts through; a vision flag from provider config gates the paperclip. Week one delivers the demo moment — paste a stack-trace screenshot, the model reads it. Week two reveals vision as a gateway drug: whiteboards, sketches, charts, photos of errors — every paste teaches what the other modalities would be worth.
- **Snags**: Retina screenshots arrive at ~3 MB — client-side downsize before upload is day-one work (mild, early). Images are token-heavy; context fills faster and metered-API users notice the bill — a token-cost affordance earns its keep (medium, post-launch). Capability advertisement is fuzzy across providers — ship permissive-with-clear-error, don't pretend the gate is omniscient (continuous, mild-medium). `search_vec` is a generated column over message text, so the parts migration must keep it extracting from the text part — small change but touches an invariant, needs a test (once, sneaky).
- **Trade-offs**: No modality framework — voice/files/video deferred as their own ideas. But the parts schema and composer attach/preview plumbing are the bones the others grow on, so deferring doesn't mean throwing away.
- **Delivers the what?**: Partially — images only, but that's the modality real demand leads with.
- **Difficulty vs payoff**: difficulty M · payoff H · time-to-first-value 1–2 weeks
- **Your take**: Asked to justify M · H · 1–2 weeks: M is the honest floor (parts schema migration, search_vec expression, renderer, composer, proxy are irreducible and touch invariants — S would be a lie); not L because it stops there — no voice/video/files/framework, and vision-only storage is image bytes in the message row. Payoff H is conditional on the vision-is-90%-of-demand bet; if wrong, payoff drops to M.
