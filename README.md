# Mayon

Mayon — a local-first learning app built around a branchable chat graph.

Chat with an AI about any topic, highlight a dense response, and branch a new
conversation from that exact excerpt. From any chat, generate AI-powered
hands-on labs and mixed-format quizzes (MCQ, flashcard, short-answer with AI
grading). Everything stays on your machine — no account, no server, no
telemetry.

## What it is

- **Branchable chat graph** — highlight and fork conversations; navigate a tree
  of branches with sidebar, breadcrumbs, and cross-links.
- **Hands-on labs** — step-by-step guides with interactive checklists generated
  from any chat.
- **Quizzes** — MCQ, flashcard, and short-answer questions with AI grading and
  score tracking.
- **Local-first / self-hosted** — browser SPA backed by a Postgres primary
  store via a small local server. Self-host with `docker compose up`; no
  account, no telemetry.
- **Provider-agnostic AI** — OpenAI, Anthropic, Gemini, Ollama, OpenRouter, and
  more; switch providers freely.

## Get Mayon

### Web demo

Try the live demo at
[bendlikeabamboo.github.io/mayon](https://bendlikeabamboo.github.io/mayon).

### Docker (self-host)

Mayon runs as three containers (web SPA, server, Postgres). The quickest way to
run it — a single command that checks for Docker, generates a secure Postgres
password, writes the files to `~/.mayon`, and starts the stack:

```bash
curl -fsSL https://github.com/bendlikeabamboo/mayon/releases/latest/download/install.sh | bash
```

Then open http://localhost:8080. Files land in `~/.mayon`; use
`~/.mayon/install.sh` to manage the stack afterwards (`stop`, `start`,
`restart`, `logs`, `status`, `upgrade`, `uninstall`).

**Pin a release** (recommended for reproducible installs):

```bash
curl -fsSL https://github.com/bendlikeabamboo/mayon/releases/download/v0.1.0/install.sh | bash
```

**Prefer no install script?** Run the compose file directly with plain Docker:

```bash
docker compose -f https://raw.githubusercontent.com/bendlikeabamboo/mayon/main/docker-compose.yml up -d
```

All three paths accept `MAYON_PORT` (web port, default `8080`) and
`MAYON_VERSION` (image tag) via env. To move off port 8080, set
`MAYON_PORT=3000` in `~/.mayon/.env` and restart.

## Build from source

**Prerequisites:** Node 22, pnpm 10, and Docker (see [CONTRIBUTING.md](CONTRIBUTING.md)).

```bash
pnpm install
pnpm dev          # all-Docker dev stack: web HMR (:5173) + server + db
```

## Documentation

Full docs: [bendlikeabamboo.github.io/mayon/docs](https://bendlikeabamboo.github.io/mayon/docs)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions, and PR flow.

## License

[MIT](LICENSE)
