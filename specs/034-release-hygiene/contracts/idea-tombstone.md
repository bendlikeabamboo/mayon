# Contract: idea tombstone

Scope: `ideas/history-map.md` (restored). Verified sources: `84389bf^` (original file),
current `ideas/` listing.

## File structure (normative)

1. Title + intro: same purpose statement as the original (tombstone for idea
   directories removed after consolidation; raw sources retrievable from git history).
2. Sentinel line: `**Last used idea number: 013** — new ideas continue numbering
   upward; do not reuse retired numbers.` Plus a one-line aside: idea number 011 was
   never used (numbering gap, not a retirement).
3. Directory table: rows 001–008 restored verbatim from `84389bf^:ideas/history-map.md`.
4. **New** loose-file retirement table with exactly these rows:

| File | Status | Disposition |
|---|---|---|
| `llm-mocks.md` | delivered | The mock-LLM provider wish became the shipped fixture `tests/fixtures/mock-llm/` (specs [017-mock-llm-chat-tests](../docs/history/017-mock-llm-chat-tests.qmd), [020-rc-ui-verification](../docs/history/020-rc-ui-verification.qmd)). |
| `security-scan.md` | partially delivered | Posture detection + Dependabot shipped as [019-security-posture-detection](../docs/history/019-security-posture-detection.qmd); the exfiltration concern was closed by #69's relay hardening (0.10.0); the open remainder (triage the vulnerability backlog to zero known-highs) lives in [dependency-vulnerability-backlog.md](dependency-vulnerability-backlog.md). |

5. Retired stamp: note the 2026-11-09 deletion (`84389bf`) and the 2026-11-10
   restoration (this feature), so provenance of the gap itself is recorded.

## Rules

- Deleting any `ideas/` entry without a row here (or a `.gitignore` entry for
  uncommittable churn) is a violation — silent deletion is what this contract exists
  to prevent.
- The sentinel must equal the highest idea **directory** number whenever an idea is
  added or retired.
- Loose `ideas/*.md` retirements go in table (4); directory retirements in table (3).
- File is Prettier-covered: must pass `prettier --check ideas/history-map.md`.
