# Decisions: 013-code-artifacts

- Created: 2026-11-09

## Verdict

- **Winner**: Card 003 — live-workspace-sync (dealt), in its git-flavored mutation: public GitHub API reads; no local-folder sync (code lives on GitHub; Mayon is not co-located with it).
- **Runner-up**: Card 002 — chat-attachments (promoted during the playthrough by the user's latest-version-wins context policy; parked as the cheap fallback).
- **Why**: Delivers the why in full — zero paste ferry-work, staleness structurally dead at push granularity, unbounded growth — at a v1 cost below the local-folder flavor's mandatory trust-boundary work. Rulings baked in: reads land in the transcript as lightweight SHA-pinned artifact references; the generic sandbox is decided-but-future and this tool seam is its first tenant; GitHub auth is out of scope for v1.
- **Date**: 2026-11-09
- **Spec**: `spec.md` (this folder).
