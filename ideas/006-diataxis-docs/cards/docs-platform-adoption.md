---
card: 003
name: docs-platform-adoption
origin: dealt
bet: Wins if docs keep growing and platform features — versioning, search, API reference — outweigh the one-time migration cost
played: yes
---

# Card 003 — Docs platform adoption (contrarian)

## Story

You stop reworking Quarto at all and move the docs to a dedicated documentation platform — Docusaurus, MkDocs Material, or VitePress — which bakes in Diátaxis-shaped navigation, first-class search, versioned docs, and generated API/reference pages as defaults. You spend the first day migrating content and re-pointing the GH Pages deploy; from then on, structure is a convention the platform enforces rather than something you re-litigate each time docs grow. The contrarian bet is that the tool you already have is the problem, and the boring industry-standard answer beats a hand-rolled restructure.

## Playthrough (2026-09-03)

- **How it goes**: A platform is picked (Docusaurus fits the existing pnpm/Node repo; MkDocs Material would add Python). Day one: scaffold + re-point GH Pages deploy. Days two–three: migration grind — .qmd → .md, Quarto callouts → platform admonitions, part/chapter tree → sidebar config; done in a weekend. The platform then enforces the sidebar structure as config, ships high-quality search, and — uniquely among the deck — enables typed API reference generation (server package, @mayon/shared, the StorageDriver seam), so reference docs stop being hand-maintained copies of the types. Total path/URL churn exceeds Card 001's, including AGENTS.md references to the Quarto docs site.
- **Snags**: Total churn + migration on top — bites during the cutover weekend — AGENTS.md and all cross-links rewrite. Second-framework treadmill — compounds forever — docs builds gain Node/React/MDX/plugin dependency risk independent of app code; permanent tax for a solo maintainer.
- **Trade-offs**: Gives up single-toolchain simplicity and Quarto familiarity; adds ongoing maintenance surface; platform features (versioning, generated reference) only pay off if docs keep growing.
- **Delivers the what?**: Fully — Diátaxis nav + real browsable website, plus bonuses (versioning, search, API reference) the what never required.
- **Difficulty vs payoff**: difficulty M · payoff H if docs grow, M if they plateau · time-to-first-value ~1 week
- **Your take**: Resolved by verdict — Card 001 won; generated API reference / versioning / enforced structure not worth the toolchain tax at current docs scale.
