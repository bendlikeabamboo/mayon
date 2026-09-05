# Decisions: 007-rc-ui-verification

- Created: 2026-09-05T12:27:27Z

## Verdict

- **Winner**: user-defined hybrid — Card 001 (`playwright-quiz-labs`) as the spine + Card 004 (`logic-not-browser`) as a logic-layer complement, including the user's Card 001 refinements: (1) the read-only prompt contract rides in-card — the format/contract section of the quiz and lab generation prompts becomes non-editable (custom instructions allowed; full prompt viewable via a settings button); (2) the mock gets a deterministic grading lever — answer text selects the outcome ("should be correct" grades correct, "should be wrong" grades wrong).
- **Runner-up**: Card 001 alone.
- **Why**: 001 is the only card that delivers the what fully; 004 adds cheap, deep Vitest/pglite coverage of grading buckets and error paths a browser suite reaches only painfully. Card 003 declined (the trust gap is app code, not the packaged artifact; Docker reproducibility already sufficient); card 002 rejected as too small; card 005 not picked.
- **Date**: 2026-09-05
- **Spec**: `spec.md` in this folder — paste-ready input for `/speckit.specify`.
