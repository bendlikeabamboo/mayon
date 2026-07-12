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
- **Local-first / offline** — browser SPA (OPFS + IndexedDB). No account, no
  server required. An optional local server (`docker compose up`) unlocks
  stdio MCP tools, CORS-free LLM access, and a sandbox DB.
- **Provider-agnostic AI** — OpenAI, Anthropic, Gemini, Ollama, OpenRouter, and
  more; switch providers freely.

## Get Mayon

### Web demo

Try the live demo at
[bendlikeabamboo.github.io/mayon](https://bendlikeabamboo.github.io/mayon).

### Docker (self-host)

```bash
docker pull ghcr.io/bendlikeabamboo/mayon
docker run -p 8080:80 ghcr.io/bendlikeabamboo/mayon
```

Or with Docker Compose:

```bash
docker compose up -d
```

## Build from source

**Prerequisites:** Node 22, pnpm 10 (see [CONTRIBUTING.md](CONTRIBUTING.md)).

```bash
pnpm install
pnpm dev          # browser SPA at http://localhost:5173
```

## Documentation

Full docs: [bendlikeabamboo.github.io/mayon/docs](https://bendlikeabamboo.github.io/mayon/docs)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions, and PR flow.

## License

[MIT](LICENSE)
