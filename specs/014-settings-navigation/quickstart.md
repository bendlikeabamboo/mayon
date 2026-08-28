# Quickstart: Settings Page Navigation

**Feature**: 014-settings-navigation | **Date**: 2026-08-28

Validation guide proving the spec's acceptance scenarios end-to-end. Prerequisites: dependencies installed (`pnpm install`), dev stack running (`pnpm dev` → web on http://localhost:5173, server on :4319; Docker or Podman via `MAYON_DEV_ENGINE`). If `@mayon/shared` or deps changed, rebuild images first (`pnpm dev:build`). No database changes exist in this feature — no migrations to run.

## Automated gates

```bash
pnpm check                                  # svelte-check
pnpm lint                                   # ESLint + Prettier
pnpm test                                   # Vitest (includes new src/lib/settings/*.test.ts)
```

Expected: all green. New tests cover the section registry integrity, hash discipline rules, scroll-spy reducer, and source-assertions on component wiring (see `specs/014-settings-navigation/contracts/settings-navigation.md` §3 for the rules they encode).

## Perf probe (constitution IV — run before and after the change)

1. Open http://localhost:5173/settings, console: `window.__MAYON_PERF__ = 1` and `localStorage.mayon_perf_scenario = 'settings-nav'`.
2. Scroll the page top→bottom→top a few times, jump via rail and search, note the `[mayon-perf]` summary (frames, longtasks, input latency).
3. Acceptance: no regression vs. the pre-change baseline captured the same way; no long tasks attributable to jump/spy handlers.

## Manual scenarios (map to spec user stories)

### S1 — Rail jump + scroll-spy (US1)

1. Load `/settings` at desktop width (≥ 1024px). **Expect**: a slim rail lists Providers, MCP Servers, Learner profile, Expound Instructions, Lab generation prompt, Quiz generation prompt, Data, Sandbox DB (top→bottom, mirroring the page headings).
2. Click **Data**. **Expect**: smooth scroll lands with the Data heading at the viewport top; URL ends `#data`; the rail highlights Data.
3. Scroll manually upward through Quiz prompt → Lab prompt. **Expect**: highlight follows each section as it enters the top band, ending on the true current section; URL hash updates while scrolling, but pressing Back afterwards does **not** replay the scroll (no history entries from scrolling — FR-005).
4. Add/remove a provider (list height change), then click **Providers** in the rail. **Expect**: still lands exactly at the Providers heading (no drift).

### S2 — Search (US2)

1. On `/settings`, click the visible search field at the top of the page (no shortcut used). **Expect**: field is usable directly; typing `rest` offers the Data section via its `restore` alias.
2. Press `Cmd-K` (or `Ctrl-K`). **Expect**: the field focuses (already-focused: stays focused). Nothing scrolls; page state intact.
3. Type `sandbox` and select the hit (Sandbox DB section present when the server advertises `sandbox-db`). **Expect**: smooth scroll to Sandbox DB, its heading flashes briefly (~1.5 s), URL ends `#sandbox-db`, one new history entry.
4. Type `zzzz`. **Expect**: "No matching section" empty state; page does not scroll.
5. Navigate to `/search` (sidebar) and press `Cmd-K`. **Expect**: the app-wide search opens as before — the settings scoping did not touch the global binding (regression, FR-009).

### S3 — Hash anchors, back/forward, deep links (US3)

1. Click **MCP Servers**, then **Data** in the rail. Press Back twice. **Expect**: first Back lands on MCP Servers (top of viewport), second Back returns to the pre-jump position; each land is exact, not mid-content (browser scroll offset overridden — FR-008).
2. Paste `/settings#quiz-prompt` into the address bar of a new tab. **Expect**: page loads directly at the Quiz generation prompt section.
3. In a stack where Sandbox DB is **off** (server without `sandbox-db` capability), open `/settings#sandbox-db`. **Expect**: page opens normally at the top, no error; the rail/search/sheet list omits Sandbox DB (FR-012). With the capability on, the same hash lands on the section.
4. Start an edit inside a provider form, rail-jump to Data and back. **Expect**: the edit is intact — nothing unmounted, no unsaved-changes prompt (FR-016).

### S4 — Mobile floating jump (US4)

1. Set viewport to a phone width (< 1024px, e.g. 390px devtools preset). **Expect**: rail hidden; a floating jump button is visible bottom-right without covering primary content.
2. Tap the button, pick **Data**. **Expect**: sheet closes, page scrolls to Data, URL ends `#data` — two taps total (SC-008), same history semantics as desktop.
3. Reopen the sheet and dismiss without picking. **Expect**: no scroll, no history entry.

### S5 — Reduced motion & flash (FR-015)

1. Enable OS/browser reduced motion (or devtools rendering emulation), then rail-jump to **Data**. **Expect**: instant repositioning without animation; hash/history/flash-landing all identical to the animated case.

## References

- Rules being verified: `specs/014-settings-navigation/contracts/settings-navigation.md` (§1 history table, §2 keyboard map)
- Entity/rules detail: `specs/014-settings-navigation/data-model.md`
- Acceptance scenarios: `specs/014-settings-navigation/spec.md`
