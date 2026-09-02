---
card: 003
name: files-as-text
origin: dealt
bet: Wins if the underlying need is bringing outside material into chat, not native model modalities
played: yes
---

# Card 003 — Files become text (reframe)

## Story

You read the goal as "bring outside material into the conversation," not "exercise model modalities." Attach a PDF, a code file, or a doc, and a server-side extraction step converts it to text that enters context exactly like today's MCP attachment system notes. It works on every model — including text-only ones — with zero content-parts plumbing, and paste-a-screenshot-of-text becomes a solved special case whenever a vision model happens to be connected.

## Playthrough (2026-09-02)

- **What & why** (recorded at play time, confirmed by user at deal time): Let users feed non-text input — images, video, audio/voice, files — into a chat when the connected model supports that modality. Why: composer and server LLM path are text-only today, so multimodal models deliver none of that value inside Mayon.
- **How it goes**: Composer gains attach; files go to the server, an extraction step converts them to text, and the text enters context via the same seam MCP resource attachments already use (`attachmentSystemNotesFor`, src/lib/chat/context.ts). Week one: attach a PDF, ask for a summary of section 3 — works on every model including text-only ones. No parts schema, no migration, no capability gate. Week two: extraction quality quietly becomes the product — digital PDFs and code extract cleanly, scanned PDFs garble, tables scramble, formulas turn to soup.
- **Snags**: Silent-garble failure — the model confidently summarizes a scrambled table and nobody learns the extraction was mush; invisible failures burn trust worse than errors (bites week two+, bad). Context stuffing — a 100-page PDF blows the window, forcing chunking/truncation decisions (bites fast, medium). The OCR escape hatch (route scanned docs through a vision model) is card 002 re-entering through the back door — scope growth disguised as a fallback (sneaky).
- **Trade-offs**: Native modalities abandoned entirely — no images-as-images, no audio, no video. Mayon stays a text app with a good import pipe; the parts migration still awaits if native vision ever matters.
- **Delivers the what?**: Partially — fully delivers "bring material in" for documents on any model; nothing for images/audio/video.
- **Difficulty vs payoff**: difficulty M · payoff H if material-import is the real why, M if native modalities were the point · time-to-first-value 1–2 weeks
- **Your take**: User disagreed outright: their concrete use case is learning frontend engineering by sending screenshots — an image the model must see, not a document to extract. Reframe bet failed for this user; payoff downgraded from conditional-H to missed. Corollary noted: vision is non-negotiable in the eventual pick (carried by cards 001, 002, and 005 in tool-result form; absent from 003 and 004).
