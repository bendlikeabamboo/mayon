# Idea History Map

This file is a tombstone for idea directories removed from `ideas/` after their knowledge
was consolidated into the project's decision history. Full narratives live at
[`docs/history/index.qmd`](../docs/history/index.qmd), which links out to one per-feature
page per idea (`docs/history/NNN-<slug>.qmd`). The raw sources of every retired directory
remain retrievable from git history (`git log --diff-filter=D -- "ideas/<dir>"`, then
check out the commit before deletion).

**Last used idea number: 013** — new ideas continue numbering upward; do not reuse
retired numbers. (Idea number 011 was never used — a numbering gap, not a retirement.)

| #   | Slug                   | Resulting spec                                                             | History entry                                                               |
| --- | ---------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 001 | settings-navigation    | specs/014-settings-navigation                                              | [#014-settings-navigation](../docs/history/014-settings-navigation.qmd)     |
| 002 | secure-public-launch   | specs/017-secure-public-launch                                             | [#017-secure-public-launch](../docs/history/017-secure-public-launch.qmd)   |
| 003 | chat-outline           | specs/017-section-peek-strip (relates to specs/015-floating-reply-outline) | [#017-section-peek-strip](../docs/history/017-section-peek-strip.qmd)       |
| 004 | automated-chat-testing | specs/017-mock-llm-chat-tests                                              | [#017-mock-llm-chat-tests](../docs/history/017-mock-llm-chat-tests.qmd)     |
| 005 | multimedia-support     | specs/018-image-chat-parts                                                 | [#018-image-chat-parts](../docs/history/018-image-chat-parts.qmd)           |
| 006 | diataxis-docs          | specs/019-diataxis-docs-website                                            | [#019-diataxis-docs-website](../docs/history/019-diataxis-docs-website.qmd) |
| 007 | rc-ui-verification     | specs/020-rc-ui-verification                                               | [#020-rc-ui-verification](../docs/history/020-rc-ui-verification.qmd)       |
| 008 | branch-context-sync    | specs/020-branch-backprop                                                  | [#020-branch-backprop](../docs/history/020-branch-backprop.qmd)             |

Retired: 2026-09-06 by the docs history split.

Loose `ideas/*.md` files fall under the same rule: deleting one without a row here is a
violation. The two files the 2026-11-09 cleanup (`84389bf`) removed alongside this
tombstone are recorded below.

| File               | Status              | Disposition                                                                                                                                                                                                                                                                                                                                                           |
| ------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `llm-mocks.md`     | delivered           | The mock-LLM provider wish became the shipped fixture `tests/fixtures/mock-llm/` (specs [017-mock-llm-chat-tests](../docs/history/017-mock-llm-chat-tests.qmd), [020-rc-ui-verification](../docs/history/020-rc-ui-verification.qmd)).                                                                                                                                |
| `security-scan.md` | partially delivered | Posture detection + Dependabot shipped as [019-security-posture-detection](../docs/history/019-security-posture-detection.qmd); the exfiltration concern was closed by #69's relay hardening (0.10.0); the open remainder (triage the vulnerability backlog to zero known-highs) lives in [dependency-vulnerability-backlog.md](dependency-vulnerability-backlog.md). |

Retired: 2026-11-09 by `84389bf` (idea bookkeeping that also deleted this file and the
two loose files above without tombstone records). Restored: 2026-11-10 by feature
034-release-hygiene (issue #74), advancing the sentinel to 013 and closing the
loose-file rule gap.
