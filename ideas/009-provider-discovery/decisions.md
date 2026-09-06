# Decisions: 009-provider-discovery

- Created: 2026-09-06

## Verdict

- **Winner**: user-defined hybrid — Card 003 (grouped provider picker with cross-group search) as the spine, Card 001 (LM Studio + vLLM onboarding) living inside its Local group, and Card 004's explicit per-endpoint tools toggle as the capability mechanism.
- **Runner-up**: Card 003 alone — superseded by the hybrid, which adds the onboarding depth and the capability fix.
- **Rejected**: Card 005 (auto-detect local runtimes) — "too much scope" (user, 2026-09-06); its detection-and-coaching states remain sequel material. Card 002 (local presets only) — under-scoped; never faced the findability half.
- **Why**: 001 delivers local onboarding deeply but only soothes the list; 003 makes findability scale structurally; 004's explicit tools toggle retires the silent tools-off snag for every endpoint. Together they cover both halves of the what; 005's payoff did not justify its failure-mode surface (LM Studio CORS catch-22, port false positives, PNA tightening).
- **Date**: 2026-09-06
- **Spec**: `spec.md` (this folder) — paste-ready input for `/speckit.specify`.
