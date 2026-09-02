---
card: 004
name: voice-first
origin: dealt
bet: Wins if hands-free conversational input unlocks uses attachments never reach
played: yes
---

# Card 004 — Voice first (contrarian)

## Story

You bet the opposite way: skip attachment UIs entirely and make speaking the primary input. Push-to-talk in the composer records audio, transcribes it — or streams it straight to a realtime-capable model — and the transcript enters the chat as text. Mayon becomes something you talk to while your hands are busy in a terminal, and the artifact-paste patterns everyone else ships can arrive later as table stakes.

## Playthrough (2026-09-02)

- **What & why** (recorded at play time, confirmed by user at deal time): Let users feed non-text input — images, video, audio/voice, files — into a chat when the connected model supports that modality. Why: composer and server LLM path are text-only today, so multimodal models deliver none of that value inside Mayon.
- **How it goes**: Push-to-talk in the composer records audio; transcription (provider of choice) or direct streaming to a realtime-capable model turns it into a text transcript that enters chat normally. Hands-free Mayon for debugging-with- terminal-open moments. The catch, inherited from card 001's analysis: voice is a second product — transcription provider selection and cost, mic permissions, latency tuning, and optionally a streaming protocol the completions path doesn't speak.
- **Snags**: Second-product weight — provider, permissions, latency, protocol (bites from week one, bad). Latency and transcription quality define the whole experience; a 2-second lag kills the feel (continuous, bad). Delivers nothing for the stated use case once it surfaced (screenshots for frontend learning) — mismatch is structural, not polishable.
- **Trade-offs**: All artifact input deferred (no images/files/video); bets everything on the hands-free why, which nothing in this session's evidence supports.
- **Delivers the what?**: Partially at best — audio only; and the bet on hands-free being the hidden why is contradicted by the user's stated use.
- **Difficulty vs payoff**: difficulty L · payoff M (for this user: L) · time-to-first-value 3–4 weeks
- **Your take**: User passed on the title before hearing the story. Kit's 30-second version was given; pass judged sound — the contrarian hands-free bet has no support in the user's stated why (show-don't-tell, not speak-don't-type). Dead card, correctly killed.
