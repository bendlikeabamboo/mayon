import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures/onboard';
import { ALIGNED_PARAGRAPH, ALIGNED_SENTENCE, LATE_MARKER } from './fixtures/kitchen-sink';
import {
	expectMarkdownStructure,
	expectMermaidDiagram,
	openKitchenSinkReply,
	selectParagraph
} from './fixtures/render';

const fixtureRaw = readFileSync(
	new URL('../fixtures/mock-llm/kitchen-sink.md', import.meta.url),
	'utf8'
);

test.describe('kitchen-sink rendering', () => {
	test('renders markdown structure from the deterministic reply', async ({ onboarded }) => {
		const body = await openKitchenSinkReply(onboarded.page);
		await expectMarkdownStructure(body);
	});

	test('renders the mermaid fence as a diagram', async ({ onboarded }) => {
		const body = await openKitchenSinkReply(onboarded.page);
		await expectMermaidDiagram(body);
	});

	test('maps a selection to known raw offsets through the expound path', async ({ onboarded }) => {
		const { page } = onboarded;
		const body = await openKitchenSinkReply(page);
		await selectParagraph(page, body, ALIGNED_SENTENCE);
		await page.getByRole('button', { name: 'Branch from this' }).click();
		const dialog = page.getByRole('dialog', { name: 'Expound on excerpt' });
		await expect(dialog).toBeVisible();
		await expect(dialog.locator('p[title]')).toHaveAttribute('title', ALIGNED_PARAGRAPH);
		await dialog.getByRole('button', { name: 'Send', exact: true }).click();
		await expect(page.locator('.markdown-body', { hasText: LATE_MARKER })).toBeVisible();
		// Rows come back positional: [start_char, end_char, excerpt]. Read a
		// recent window, never just the latest row: on a shared dev DB another
		// session's rows can sit on top, and the suite never mutates rows it
		// does not own.
		const queryRows = async (): Promise<Array<[number, number, string]>> => {
			const response = await page.request.post('/api/db/query', {
				data: {
					op: 'query',
					sql: 'SELECT start_char, end_char, excerpt FROM branch_sources ORDER BY created_at DESC LIMIT 10'
				}
			});
			const { rows } = (await response.json()) as { rows: Array<[number, number, string]> };
			return rows;
		};
		// The branch persists asynchronously behind the new chat's first turn;
		// poll for THIS test's row by its exact offsets + excerpt.
		const start = fixtureRaw.indexOf(ALIGNED_PARAGRAPH);
		expect(start).toBeGreaterThan(0);
		const end = start + ALIGNED_PARAGRAPH.length;
		let row: [number, number, string] | undefined;
		await expect
			.poll(
				async () => {
					const match = (await queryRows()).find(
						(candidate) =>
							candidate[0] === start && candidate[1] === end && candidate[2] === ALIGNED_PARAGRAPH
					);
					if (match) row = match;
					return row;
				},
				{ timeout: 15_000 }
			)
			.toBeTruthy();
		expect(row![0]).toBe(start);
		expect(row![1]).toBe(end);
		expect(row![2]).toBe(ALIGNED_PARAGRAPH);
	});
});

/**
 * Text of every timeline row wrapper (`#msg-{id}` divs in timeline order, see
 * MessageList.svelte) with live blocks and chrome whitespace collapsed away —
 * the readable shape used to pin row order after reload/regenerate.
 */
async function timelineRowTexts(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		Array.from(document.querySelectorAll('[id^="msg-"]')).map((el) =>
			(el as HTMLElement).innerText.trim()
		)
	);
}

// 035 T018 (optional, maintainer-verifiable): interleaved micro-thoughts
// against the REAL dev stack. REQUIRES the Docker dev stack (`pnpm dev`, web
// on :5173 — the playwright baseURL default) with the mock-llm fixture the
// stack embeds: `[[interleaved-thoughts]]` is a mock-server marker
// (tests/fixtures/mock-llm/server.mjs, kind `chat_interleaved`), so the round
// trip exercises the real SSE → loop → store → UI path. The implementer agent
// tier MUST NOT run this spec (no Docker there); it is left runnable — no
// `test.skip` — for the maintainer per specs/035-micro-thoughts-fixes/
// quickstart.md V7. The fast-tier bar for the same shape is the T017 store
// test in src/lib/stores/chat.svelte.test.ts.
test.describe('interleaved micro-thoughts (035 T018 — maintainer-only)', () => {
	test('live blocks render once each, reload preserves row order, regenerate replaces the whole turn', async ({
		onboarded
	}) => {
		const { page } = onboarded;

		// First turn of a fresh root chat carries no tools, so the marker
		// classifies as chat_interleaved: reasoning×2 → content×2 → reasoning×2
		// → content×2 → trailing reasoning over ~150 ms-paced SSE frames.
		const composer = page.getByPlaceholder(/Message the active provider/);
		await composer.fill('[[interleaved-thoughts]] What is 2+2?');
		await page.getByRole('button', { name: 'Send', exact: true }).click();

		// Live: each thought mounts exactly once under its per-block id (029
		// per-block keys) and STAYS mounted while later segments start — blocks
		// close at the next segment start, they never duplicate or unmount
		// mid-turn. The trailing thought is the last to appear; the mounts are
		// monotonic, so once it is visible all five live blocks are present.
		await expect(page.locator('#msg-live-reasoning-0')).toBeVisible({ timeout: 30_000 });
		await expect(page.locator('#msg-live-reasoning-1')).toBeVisible({ timeout: 30_000 });
		await expect(page.locator('#msg-live-text-1')).toBeVisible({ timeout: 30_000 });
		await expect(page.locator('#msg-live-reasoning-2')).toBeVisible({ timeout: 30_000 });
		await expect(page.locator('[id^="msg-live-reasoning"]')).toHaveCount(3);
		await expect(page.locator('[id^="msg-live-text"]')).toHaveCount(2);

		// Teardown: the live view clears and the durable walk lands
		// [user, reasoning, text, reasoning, text, trailing reasoning].
		await expect(page.locator('[id^="msg-live-"]')).toHaveCount(0, { timeout: 30_000 });
		await expect
			.poll(() => timelineRowTexts(page), { timeout: 15_000 })
			.toEqual([
				expect.stringContaining('What is 2+2?'),
				'Thought process',
				expect.stringContaining('2 + 2 = 4.'),
				'Thought process',
				expect.stringContaining('That stays 4.'),
				'Thought process'
			]);

		// Reload: anchored thoughts keep their persisted positions — the row
		// order survives byte-for-byte, and the trailing thought does NOT hide
		// the regenerate gate on the last text row (035 US3).
		await page.reload();
		await expect(page.getByRole('button', { name: 'Thought process' })).toHaveCount(3);
		await expect
			.poll(() => timelineRowTexts(page), { timeout: 15_000 })
			.toEqual([
				expect.stringContaining('What is 2+2?'),
				'Thought process',
				expect.stringContaining('2 + 2 = 4.'),
				'Thought process',
				expect.stringContaining('That stays 4.'),
				'Thought process'
			]);
		await expect(page.getByRole('button', { name: 'Regenerate response' })).toBeVisible();

		// Regenerate replaces the WHOLE turn (035 US3): every row after the
		// previous user row is deleted, the turn re-sends — and because the
		// re-send is no longer the chat's first turn, the mock classifies it as
		// a tools-bearing chat stream (kitchen sink), so the interleaved rows
		// must be gone entirely: exactly [user, user, plain reply], no orphaned
		// "Thought process" rows, no duplicate thoughts.
		await page.getByRole('button', { name: 'Regenerate response' }).click();
		await expect(page.locator('[id^="msg-live-"]')).toHaveCount(0, { timeout: 30_000 });
		await expect(page.locator('.markdown-body', { hasText: LATE_MARKER })).toBeVisible({
			timeout: 30_000
		});
		await expect(page.getByRole('button', { name: 'Thought process' })).toHaveCount(0);
		await expect
			.poll(() => timelineRowTexts(page), { timeout: 15_000 })
			.toEqual([
				expect.stringContaining('What is 2+2?'),
				expect.stringContaining('What is 2+2?'),
				expect.stringContaining(LATE_MARKER)
			]);
	});
});
