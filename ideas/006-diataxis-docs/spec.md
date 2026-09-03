# Diátaxis documentation website

**What**: Restructure Mayon's documentation around the Diátaxis framework (tutorials / how-to guides / reference / explanation), published as a browsable documentation website instead of a linear book.
**Why**: The book format forces readers through one fixed sequence — task-hunters and fact-hunters wade through the same chapters, with teaching, task, and reference content interleaved.

## The path

Stay in Quarto and flip `docs/_quarto.yml` from `book` to `website` — an afternoon of config that keeps the existing GH Pages publish flow, search, and breadcrumbs. Re-home every existing page into exactly one of the four quadrants: `getting-started` is a tutorial; `guide/providers`, `guide/labs` are how-to guides; `dev/seams` is reference; `dev/architecture` is explanation. Non-Diátaxis content — `developer_notes/`, decision history, any changelog — keeps its own dedicated shelf, explicitly not squeezed into a quadrant. Split mixed pages at roughly 3/4 strictness: split where a page genuinely interleaves walkthrough and reference, tolerate minor mixing rather than chopping pages that were fine. Fix the link/URL churn (`AGENTS.md` references, cross-links, GH Pages URLs) as part of the same cutover rather than leaving stale paths behind.

## Known snags

- Page surgery on mixed pages — bites mid-project — the real schedule cost is days of content work, not hours of config.
- Link/URL churn — bites quietly at cutover and lingers — `AGENTS.md`, cross-links, and bookmarked GH Pages URLs all move at once; nothing breaks loudly.
- Quadrant discipline — bites over months — nothing in the format enforces where new pages land; the sidebar is honest only as long as the filing stays honest.

## Accepted trade-offs

- Gives up the linear read-through narrative the book provided.
- Declines platform features (versioned docs, generated API reference, enforced sidebar-as-config) — these were Card 003's benefits; revisit a platform only if the docs keep growing.
- Accepts a standing per-page quadrant decision as the cost of organization.

## The bet

Wins if readers arrive with different intents — learn, do, look up — and quadrant-shaped navigation plus website chrome shorten every journey; with organization as the core craving, this delivers the what the day the sidebar ships.
