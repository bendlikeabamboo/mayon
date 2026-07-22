# Expound — "Provide summary" toggle (off by default)

## Context

Every expound branch's staged first message is built by `buildExpoundPrompt`
(`src/lib/chat/expound.ts:41`). It **always** leads with the literal line
`Summarize the current discussion.` (`expound.ts:50`), which makes the LLM
spend the first reply summarizing before expounding — this breaks the user's
concentration.

Add a **per-expound "Provide summary" checkbox, unchecked by default**, in the
`ExpoundPromptConstructor` floating panel. When unchecked (the new default),
omit the summary line so the expound instructions lead directly.

## Locked decisions (from user)

- **Prompt-only**: the choice is **not** persisted. No DB migration, no
  `branch_sources` column, no store/repo/schema/`ExpoundCard`/route changes.
  The choice lives only in the staged first prompt (already visible in the
  branch as the first user message). This is intentionally inconsistent with
  the format toggles, which are persisted — summary is a single bit already
  recoverable from the first message.
- **Uncheck = just omit the line** (do not actively suppress with a
  "do not summarize" instruction). Checked = current behavior.

## Scope boundaries

- Touches: `src/lib/chat/expound.ts`, `src/lib/components/chat/ExpoundPromptConstructor.svelte`,
  `src/lib/chat/expound.test.ts`.
- Does **not** touch: schema, migrations, `branch-sources.ts` repo,
  `chat.svelte.ts` store, `ExpoundCard.svelte`, `+page.svelte`, architecture docs.
- Existing branches keep their already-stored first message unchanged; this
  only affects newly created branches. No backfill.

## Tasks

### 1. `src/lib/chat/expound.ts`

- Add an optional field to `ExpoundOptions`:
  ```ts
  export interface ExpoundOptions {
      excerpt: string;
      customInstructions: string;
      toggles: ExpoundToggle[];
      provideSummary?: boolean;
  }
  ```
- In `buildExpoundPrompt`, make the leading summary line conditional. When
  `o.provideSummary === true`, keep today's leading two entries:
  ```
  Summarize the current discussion.
  <blank>
  The user would like to expound on this excerpt:
  ```
  Otherwise (the new default), drop both the summary line **and** its trailing
  blank line so the prompt leads with `The user would like to expound on this
  excerpt:` and there is no leading blank line. Implementation: build the lines
  array with a conditional spread, e.g.
  ```ts
  return [
      ...(o.provideSummary === true ? ['Summarize the current discussion.', ''] : []),
      'The user would like to expound on this excerpt:',
      '"""',
      o.excerpt,
      '"""',
      '',
      'With the following instructions:',
      instructions,
      '',
      formatsLine
  ].join('\n');
  ```
- Keep `provideSummary` optional defaulting to "no summary" so existing call
  sites (store tests at `chat.svelte.test.ts:146` and `:258`, which omit it)
  automatically pick up the new default. Verified: those tests only assert
  `pendingPrompt.text === prompt` (round-trip equality) and never assert the
  summary line, so they stay green.

### 2. `src/lib/components/chat/ExpoundPromptConstructor.svelte`

- Add panel-local state (resets each open, mirroring `customInstructions` and
  `toggles`):
  ```ts
  let provideSummary = $state(false);
  ```
- Add a checkbox in the panel, **unchecked by default**. Place it directly
  under the "Add formats" block (after the `</div>` closing the formats section
  at line 134, before the Send row at line 136). Match existing muted styling:
  ```svelte
  <label class="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
      <input type="checkbox" bind:checked={provideSummary} class="size-3.5 accent-primary" />
      Provide summary
  </label>
  ```
  (Use the same `text-xs text-muted-foreground` treatment as the section
  labels; native checkbox is fine — there is no shadcn checkbox dependency in
  this panel today.)
- In `submit()`, include the flag in the payload:
  ```ts
  onSubmit({
      excerpt,
      customInstructions,
      toggles: toggleKeys.filter((k) => toggles.has(k)),
      provideSummary
  });
  ```

### 3. `src/lib/chat/expound.test.ts`

- Add two cases to the existing `describe('buildExpoundPrompt', ...)` block:
  1. **Default (no `provideSummary`)**: prompt does **not** contain
     `'Summarize the current discussion.'`, and `.startsWith('The user would
     like to expound on this excerpt:')` is true (no leading blank line).
  2. **`provideSummary: true`**: prompt **does** contain
     `'Summarize the current discussion.'` as its first line
     (`prompt.startsWith('Summarize the current discussion.\n')`).
- Do not modify existing cases (they omit `provideSummary` and now yield the
  no-summary prompt; none assert the summary line, so they remain green).

## Validation

- `pnpm lint && pnpm check && pnpm test` (root) must be green.
- Manual: `pnpm dev` → open a chat with an assistant reply → select an excerpt →
  right-click → Expound → confirm the "Provide summary" checkbox is present and
  **unchecked** → Send without checking it → the new branch's first user
  message leads with "The user would like to expound…" (no summary line) and
  the LLM expounds directly. Repeat with the box **checked** → the first
  message leads with "Summarize the current discussion." (legacy behavior).

## Risks / notes

- The `provideSummary` choice is ephemeral (panel-local `$state`, resets each
  open) — identical to how `customInstructions` and the format `toggles`
  already behave, so UX is consistent.
- Because the choice is prompt-only and not shown on `ExpoundCard`, the only
  record of it is the branch's first stored user message — acceptable per the
  user's decision.
