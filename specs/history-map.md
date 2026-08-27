# Spec Feature History Map

This file is a tombstone for feature directories removed from `specs/` after their
knowledge was consolidated into the project's decision history. Full narratives live at
[`docs/history/index.qmd`](../docs/history/index.qmd); load-bearing contract detail
referenced from living docs/code is preserved verbatim under
`docs/history/appendices/`. The raw sources of every retired directory remain retrievable
from git history (`git log --diff-filter=D -- "specs/<dir>"`, then check out the commit
before deletion).

**Last used feature number: 013** — new features continue numbering upward; do not reuse
retired numbers.

| # | Slug | History entry | Status | Appendices preserved |
|---|------|---------------|--------|----------------------|
| 001 | brave-search-mcp | [#001](../docs/history/index.qmd#sec-001) | standing | – |
| 002 | chat-timeline-kinds | [#002](../docs/history/index.qmd#sec-002) | partly superseded → #004 | – |
| 003 | timeline-ux-fixes | [#003](../docs/history/index.qmd#sec-003) | standing | – |
| 004 | internal-area-unification | [#004](../docs/history/index.qmd#sec-004) | contracts standing; result-body section superseded → #005 | 004-interactive-surfaces, 004-tool-activity-status, 004-request-trace |
| 005 | shape-driven-results | [#005](../docs/history/index.qmd#sec-005) | standing | 005-tool-result-shapes |
| 006 | ai-elements-adoption | [#006](../docs/history/index.qmd#sec-006) | standing | – |
| 007 | inference-provider-templates | [#007](../docs/history/index.qmd#sec-007) | standing | – |
| 008 | inference-router-templates | [#008](../docs/history/index.qmd#sec-008) | standing | – |
| 009 | provider-request-settings | [#009](../docs/history/index.qmd#sec-009) | standing | 009-request-settings-resolution, 009-dialect-catalog |
| 010 | custom-expound-instructions | [#010](../docs/history/index.qmd#sec-010) | standing | – |
| 011 | podman-support | [#011](../docs/history/index.qmd#sec-011) | standing | 011-engine-selection |
| 012 | ui-visual-articulation | [#012](../docs/history/index.qmd#sec-012) | standing (mid-flight pivots narrated) | 012-settings-keys |

Retired: 2026-08-27 by feature 013-consolidate-spec-history.
