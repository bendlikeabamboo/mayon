---
card: 005
name: mayon-as-mcp-server
origin: dealt
bet: Wins if the text tier is worth shipping, not just testing — one interface, two payoffs
played: no
---

# Card 005 — Mayon as its own MCP server (wild card)

## Story

The server container already speaks stdio MCP for user tools against a sandbox SQLite; you aim that machinery inward and expose Mayon's own runtime — chats, settings, prompt assembly — as MCP tools. The same text interface is at once the agent's verification harness and a real client: you hold a Mayon conversation from any MCP-capable terminal with no browser in sight. The web UI becomes one client among two, and "exercise the app as text" stops being a dev-only trick.

## Killed without playthrough (2026-10-31)

The user killed this card unplayed: "don't even want to see card 005. call it dead." Context at kill time supports it — the bet ("wins if the text tier is worth shipping, not just testing") targets a long-lived external client, but prompt-quality tooling was scoped out to Langfuse, the in-repo harness already serves the implementing agent, and the user's stated priority is machine-enforced guardrails inside the repo, not a new product surface. Card never played; frontmatter stays `played: no`.
