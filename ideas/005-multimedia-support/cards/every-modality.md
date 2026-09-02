---
card: 001
name: every-modality
origin: user
bet: Wins if multimodal breadth is table stakes and users expect every advertised model capability to work in Mayon
played: yes
---

# Card 001 — Every modality, one composer (your card)

## Story

You add an attachment affordance to the composer that accepts images, video, audio, and documents, plus a push-to-talk voice mode. Each message becomes content parts — text plus media — and the app checks what the connected model advertises before letting a modality through. Chat stops being a text window into the model and becomes the place where every kind of material lands, whatever model you've plugged in.

## Playthrough (2026-09-02)

- **What & why** (recorded at play time, confirmed by user at deal time): Let users feed non-text input — images, video, audio/voice, files — into a chat when the connected model supports that modality, so Mayon exercises the full capability of the models it connects to. Why: composer and server LLM path are text-only today, so multimodal models deliver none of that value inside Mayon.
- **How it goes**: Week one is pleasant — messages become content parts, old messages migrate to single text parts, the composer gains an attachment affordance. Week two forces the blob-storage decision: Postgres bloats pg_dump backups, disk volumes escape the backup story, and the choice is architectural and permanent-feeling. Week three exposes voice mode as a second product (mic capture/permissions, transcription provider, optionally a streaming protocol the completions path doesn't speak); video mostly can't go inline in chat APIs and ships gated off. Post-launch, users ask for the smallest modality first (paste a screenshot) and fat image payloads drive token costs up, forcing client-side downsizing.
- **Snags**: Blob storage/backup interaction — bites week two — bad, architectural. Voice-as-second-product — bites week three-four — very bad, a project of its own. Capability gating across providers is fuzzy (inconsistent capability advertisement) — bites continuously — medium. Search (`search_vec` generated column over text) and transcript renderer/expound assume text messages — bites at migration — medium but sneaky. Token-cost explosion from media-heavy messages — bites post-launch — medium.
- **Trade-offs**: Breadth over depth: five shallow modalities instead of one whole one; storage and parts-schema choices ossify before usage data exists; long time-to-first-value; voice likely never gets past "works."
- **Delivers the what?**: Fully in scope by construction (it is the what), but delivery is thin per modality.
- **Difficulty vs payoff**: difficulty L · payoff H · time-to-first-value ~4–6 weeks
- **Your take**: User pushed back on the blob-storage snag: it's a local single-user app, does it really need to scale? Answered: no — estimated 2,000–5,000 images/year ≈ 1–2 GB/year (hunch, not data), and the pg-native backup invariant actually argues for storing blobs in Postgres (`bytea` rides inside pg_dump; files on a server volume would be silently lost on restore). Mitigation that still matters: client-side compress/downsize before upload. Storage snag downgraded from architectural to an afternoon; card's remaining weight is voice-as-a-second-product and video's weak API support. User is weighing whether to do everything in one go but wants to see the remaining cards first. Asked to justify L · H · ~4–6 weeks: L because it's card 002's work plus four parallel workstreams (composer affordances, voice project, video investigation, gating matrix) with a coordination tax; time-to-first-value counts the whole spread as committed; payoff H because it delivers the what by construction.
