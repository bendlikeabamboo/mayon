# US8 — One grammar for every list row (T036–T040)

Shared component: `src/lib/components/RowCard.svelte` (T036). Anatomy contract,
fixed order: optional `leading` snippet · title (truncates) · trailing `meta`
timestamp · optional `badges` row · hover-revealed `action` snippet
(`group/card` named group, `opacity-0` + `group-hover/card:opacity-100` +
`focus-within/card:*`, inert via `pointer-events-none` while hidden). Renders
`<a>` when `href` given, else static `<div>`. Base grammar: `surface-card` +
`hover:bg-accent hover:text-accent-foreground` + `transition-colors` +
`focus-within:ring-2 focus-within:ring-ring`. `compact` prop = home mini
variant (`px-2.5 py-1.5`, `text-[11px]` meta, medium-free title weight).

## Anatomy table

| file                             | title                          | timestamp                 | progress            | destructive              | compact? |
| -------------------------------- | ------------------------------ | ------------------------- | ------------------- | ------------------------ | -------- |
| `src/routes/chat/+page.svelte`   | `chat.title`                   | `timeAgo(chat.updatedAt)` | —                   | hover Trash2 (action)    | no       |
| `src/routes/quiz/+page.svelte`   | `Quiz #n`                      | `timeAgo(quiz.createdAt)` | `N questions` badge | hover Delete (action)    | no       |
| `src/routes/lab/+page.svelte`    | `lab.title`                    | `timeAgo(lab.createdAt)`  | —                   | hover Delete (action)    | no       |
| `src/routes/+page.svelte` chats  | `chat.title`                   | `timeAgo(chat.updatedAt)` | —                   | —                        | yes      |
| `src/routes/+page.svelte` labs   | `lab.title`                    | `timeAgo(lab.updatedAt)`  | —                   | —                        | yes      |
| `src/routes/+page.svelte` quizzes| `Quiz`                         | `timeAgo(quiz.createdAt)` | —                   | —                        | yes      |

Quiz chat-title group headers remain plain links **outside** RowCard (section
headers, not rows). Last-attempt score: **deferred** — the quiz listing query
loads quizzes + chat titles + question counts only; attempts are not in the
already-fetched page data, so per T038/data-model note the question count stays
the shipped progress baseline.

## Screenshots (1440×900, dark theme, chromium via playwright-cli)

- `us8-lists.png` — `/chat` list: unified row grammar (title · trailing timestamp).
- `us8-lists-quiz.png` — `/quiz` list: same card anatomy + `N questions` badge; group headers outside rows.
- `us8-home-compact.png` — home recents stacks in compact mode; hero/resume card untouched.

Side-by-side check: `/chat` vs `/quiz` rows are indistinguishable apart from
meta values (quiz adds only the badge line); equal padding rhythm, radius,
border/shadow, hover tint idiom. Home compact rows keep the same grammar at
reduced padding/typography, demoted beneath the hero.

## Tests

`src/lib/components/RowCard.anatomy.test.ts` (T040, repo source-text
convention): 14 assertions pinning slot markers/order, `surface-card`, hover
tint, `group/card` named group, anchor-vs-div branching markers, compact
sizing hooks, inert-until-reveal action, plus adoption-site checks (chat meta +
action slot, quiz badges prop, lab, home compact ×3).

## Notes

- SPA (client-side) navigation used for captures: hard-loading `/chat` or
  `/lab` directly hits a pre-existing boot race (`+page.ts` load runs before
  `bootstrapDb()` finishes → "500 Internal Error"; self-check passes moments
  later). Unrelated to US8; same behavior on baseline.
