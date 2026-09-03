---
card: 001
name: diataxis-website
origin: user
bet: Wins if readers arrive with different intents — learn, do, look up — and quadrant-shaped navigation shortens every journey
played: yes
---

# Card 001 — Diátaxis website (your card)

## Story

You keep Quarto but flip `project.type` from `book` to `website`, and re-home every existing page into exactly one of the four Diátaxis quadrants: tutorials (learning-oriented), how-to guides (task-oriented), reference (information-oriented), explanation (understanding-oriented). The sidebar becomes four clearly labeled sections instead of narrative parts — a new user lands in a tutorial, a developer hunting the `StorageDriver` contract goes straight to reference, and nothing about teaching, doing, or looking up is interleaved in one linear read. The site publishes to GH Pages as before, just browsable by intent instead of by chapter order.

## Playthrough (2026-09-03)

- **Goal (from deal)**: What — restructure docs around Diátaxis (tutorials/how-to/reference/explanation) published as a browsable website instead of a linear book. Why — the book forces one fixed sequence; task-hunters and fact-hunters wade through the same chapters with interleaved teaching/task/reference content.
- **How it goes**: The `_quarto.yml` flip from `book` to `website` is an afternoon — navbar, search, breadcrumbs come free. Mapping the clean pages (architecture→explanation, building→how-to, seams→reference, getting-started→tutorial) goes smoothly in week one. Then content surgery starts: guide pages mixing walkthroughs with reference tables must be split, or quadrant navigation feels dishonest. Finally the orphan problem surfaces: `developer_notes/` and `decision history/` are chronological stories that fit no quadrant; they either get squeezed into Explanation or kept as an acknowledged non-Diátaxis section. Paths move, churning `AGENTS.md` references, cross-links, and GH Pages URLs — nothing breaks loudly, so stale links linger.
- **Snags**: Page surgery on mixed pages — bites mid-project — the real schedule cost (days-to-weeks, not hours). Taxonomy orphans (developer_notes/history) — bites at mapping time — forces an unprincipled exception. Link/URL churn — bites quietly at the end and keeps biting — stale bookmarks and broken cross-refs.
- **Trade-offs**: Gives up the linear read-through narrative; imposes a standing discipline cost (every new page needs a quadrant decision); risk of quadrant purism chopping pages that were fine.
- **Delivers the what?**: Fully — this is the what, both quadrants and website; intent-shaped navigation ships with the sidebar.
- **Difficulty vs payoff**: difficulty M · payoff H · time-to-first-value ~days
- **Your take**: Non-Diátaxis content (developer_notes, changelog, decision history, etc.) keeps its own dedicated space — not squeezed into a quadrant. Page splitting at "3/4ths strict" — mostly split mixed pages, tolerate some mixing. Core craving: "I just really want it organized."
