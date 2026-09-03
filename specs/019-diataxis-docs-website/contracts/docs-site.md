# Contract: Documentation Site (navigation & URLs)

The feature's outward-facing contract is the **docs site structure itself** — what readers and external systems (agents, contributors, old links) may rely on.

## URL layout

| Section | Path prefix | Orientation |
|---|---|---|
| Tutorials | `/tutorials/` | learning |
| How-to guides | `/how-to/` | task |
| Reference | `/reference/` | information |
| Explanation | `/explanation/` | understanding |
| Development notes | `/dev-notes/` | chronicle (non-Diátaxis shelf) |
| Decision history | `/history/` | chronicle (non-Diátaxis shelf) |

## Stable entry points (MUST NOT break — FR-008)

- `/` — docs landing with per-section intent descriptions
- Navbar links from the landing page to each section
- The publishing destination and pipeline remain exactly `deploy-pages.yml` → GH Pages

## Navigation contract

- One sidebar, contents grouped by the six sections in the order above; search enabled.
- No linear-only reading order: navigation never presents the site as a single sequence.
- Each section entry identifies the intent it serves ("learning-oriented", "task-oriented", …).

## Redirect contract

- Every previously published page URL keeps answering after cutover via a redirect page emitted from the moved page's `aliases` frontmatter (see data-model.md).
- Internal cross-references and repo-level pointers (`AGENTS.md`, `CONTRIBUTING.md`, `.specify/memory/constitution.md`) point at **new** URLs directly — aliases serve external/bookmarked traffic only.

## Validation contract

- Automated link check over the rendered site reports zero broken internal links (SC-003).
- 100% of pages live under exactly one section directory (SC-001).
