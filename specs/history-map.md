# Spec Feature History Map

This file is a tombstone for feature directories removed from `specs/` after their
knowledge was consolidated into the project's decision history. Full narratives live at
[`docs/history/index.qmd`](../docs/history/index.qmd), which links out to one per-feature
page per spec (`docs/history/NNN-<slug>.qmd`); load-bearing contract detail
referenced from living docs/code is preserved verbatim under
`docs/history/appendices/`. The raw sources of every retired directory remain retrievable
from git history (`git log --diff-filter=D -- "specs/<dir>"`, then check out the commit
before deletion).

**Last used feature number: 020** — new features continue numbering upward; do not reuse
retired numbers.

| # | Slug | History entry | Status | Appendices preserved |
|---|------|---------------|--------|----------------------|
| 001 | brave-search-mcp | [#001](../docs/history/001-brave-search-mcp.qmd#sec-001) | standing | – |
| 002 | chat-timeline-kinds | [#002](../docs/history/002-chat-timeline-kinds.qmd#sec-002) | partly superseded → #004 | – |
| 003 | timeline-ux-fixes | [#003](../docs/history/003-timeline-ux-fixes.qmd#sec-003) | standing | – |
| 004 | internal-area-unification | [#004](../docs/history/004-internal-area-unification.qmd#sec-004) | contracts standing; result-body section superseded → #005 | 004-interactive-surfaces, 004-tool-activity-status, 004-request-trace |
| 005 | shape-driven-results | [#005](../docs/history/005-shape-driven-results.qmd#sec-005) | standing | 005-tool-result-shapes |
| 006 | ai-elements-adoption | [#006](../docs/history/006-ai-elements-adoption.qmd#sec-006) | standing | – |
| 007 | inference-provider-templates | [#007](../docs/history/007-inference-provider-templates.qmd#sec-007) | standing | – |
| 008 | inference-router-templates | [#008](../docs/history/008-inference-router-templates.qmd#sec-008) | standing | – |
| 009 | provider-request-settings | [#009](../docs/history/009-provider-request-settings.qmd#sec-009) | standing | 009-request-settings-resolution, 009-dialect-catalog |
| 010 | custom-expound-instructions | [#010](../docs/history/010-custom-expound-instructions.qmd#sec-010) | standing | – |
| 011 | podman-support | [#011](../docs/history/011-podman-support.qmd#sec-011) | standing | 011-engine-selection |
| 012 | ui-visual-articulation | [#012](../docs/history/012-ui-visual-articulation.qmd#sec-012) | standing (mid-flight pivots narrated) | 012-settings-keys |
| 013 | consolidate-spec-history | [#013](../docs/history/013-consolidate-spec-history.qmd#sec-013) | standing | – |
| 014 | settings-navigation | [#014](../docs/history/014-settings-navigation.qmd#sec-014) | standing | – |
| 015 | floating-reply-outline | [#015](../docs/history/015-floating-reply-outline.qmd#sec-015) | designed, not built; primitives shipped via 017-section-peek-strip | – |
| 016 | github-copilot-support | [#016](../docs/history/016-github-copilot-support.qmd#sec-016) | standing | 016-copilot-server-api |
| 017 | mock-llm-chat-tests | [#017](../docs/history/017-mock-llm-chat-tests.qmd#sec-017) | standing | – |
| 017 | section-peek-strip | [#017](../docs/history/017-section-peek-strip.qmd#sec-017) | standing | – |
| 017 | secure-public-launch | [#017](../docs/history/017-secure-public-launch.qmd#sec-017) | standing | 017-auth-api |
| 018 | image-chat-parts | [#018](../docs/history/018-image-chat-parts.qmd#sec-018) | standing | 018-provider-vision-flag |
| 019 | diataxis-docs-website | [#019](../docs/history/019-diataxis-docs-website.qmd#sec-019) | standing | – |
| 019 | security-posture-detection | [#019](../docs/history/019-security-posture-detection.qmd#sec-019) | standing | – |
| 020 | branch-backprop | [#020](../docs/history/020-branch-backprop.qmd#sec-020) | standing | 020-branch-backprop-data-model |
| 020 | rc-ui-verification | [#020](../docs/history/020-rc-ui-verification.qmd#sec-020) | standing | 020-mock-llm-protocol, 020-prompt-settings-contract |

Idea directories removed from `ideas/` by the same consolidation, with the spec each
resulted in:

| # | Slug | Resulting spec | History entry |
|---|------|----------------|---------------|
| 001 | settings-navigation | specs/014-settings-navigation | [#014-settings-navigation](../docs/history/014-settings-navigation.qmd) |
| 002 | secure-public-launch | specs/017-secure-public-launch | [#017-secure-public-launch](../docs/history/017-secure-public-launch.qmd) |
| 003 | chat-outline | specs/017-section-peek-strip (relates to specs/015-floating-reply-outline) | [#017-section-peek-strip](../docs/history/017-section-peek-strip.qmd) |
| 004 | automated-chat-testing | specs/017-mock-llm-chat-tests | [#017-mock-llm-chat-tests](../docs/history/017-mock-llm-chat-tests.qmd) |
| 005 | multimedia-support | specs/018-image-chat-parts | [#018-image-chat-parts](../docs/history/018-image-chat-parts.qmd) |
| 006 | diataxis-docs | specs/019-diataxis-docs-website | [#019-diataxis-docs-website](../docs/history/019-diataxis-docs-website.qmd) |
| 007 | rc-ui-verification | specs/020-rc-ui-verification | [#020-rc-ui-verification](../docs/history/020-rc-ui-verification.qmd) |
| 008 | branch-context-sync | specs/020-branch-backprop | [#020-branch-backprop](../docs/history/020-branch-backprop.qmd) |

Retired: 2026-08-27 by feature 013-consolidate-spec-history.
Retired: 2026-09-06 by the docs history split (specs 013–020 and ideas 001–008 condensed
into per-feature pages).
