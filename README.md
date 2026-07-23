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

Mayon needs both the web SPA and the server (plus Postgres). The included
compose file pulls the published images and wires them together:

```bash
docker compose pull
docker compose up -d
```

Then open http://localhost:8080. To pin a specific release, set
`MAYON_VERSION` (e.g. `0.1.0`) in a `.env` file or export it before `up`.

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
