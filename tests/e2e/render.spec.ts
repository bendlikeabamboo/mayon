import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { test } from './fixtures/onboard';
import { ALIGNED_PARAGRAPH, ALIGNED_SENTENCE, LATE_MARKER } from './fixtures/kitchen-sink';
import {
	expectCopyAffordance,
	expectMarkdownStructure,
	expectMath,
	expectMermaidDiagram,
	openKitchenSinkReply,
	selectParagraph,
	setThemePreferenceToSystem
} from './fixtures/render';

const fixtureRaw = readFileSync(
	new URL('../fixtures/mock-llm/kitchen-sink.md', import.meta.url),
	'utf8'
);

test.describe('kitchen-sink rendering', () => {
	test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

	test('renders markdown structure from the deterministic reply', async ({ onboarded }) => {
		const body = await openKitchenSinkReply(onboarded.page);
		await expectMarkdownStructure(body);
	});

	test('renders inline and display math as KaTeX', async ({ onboarded }) => {
		const body = await openKitchenSinkReply(onboarded.page);
		await expectMath(body);
	});

	test('renders the mermaid fence as a diagram', async ({ onboarded }) => {
		const body = await openKitchenSinkReply(onboarded.page);
		await expectMermaidDiagram(body);
	});

	test('re-renders the mermaid diagram when the theme flips to dark', async ({ onboarded }) => {
		const { page } = onboarded;
		const body = await openKitchenSinkReply(page);
		await expectMermaidDiagram(body);
		// Pin the preference to "system" (through the real toggle) so the
		// resolved theme — and with it the diagram — follows the OS-level
		// emulated color scheme.
		await setThemePreferenceToSystem(page);
		await page.emulateMedia({ colorScheme: 'light' });
		await expect(body.locator('.mermaid-svg')).toHaveAttribute('data-rendered-theme', 'light', {
			timeout: 30_000
		});
		await page.emulateMedia({ colorScheme: 'dark' });
		await expect(body.locator('.mermaid-svg')).toHaveAttribute('data-rendered-theme', 'dark', {
			timeout: 30_000
		});
		await expect(body.locator('.mermaid-svg svg')).toBeVisible();
		// Flip back to light and expect the diagram to follow.
		await page.emulateMedia({ colorScheme: 'light' });
		await expect(body.locator('.mermaid-svg')).toHaveAttribute('data-rendered-theme', 'light', {
			timeout: 30_000
		});
		await expect(body.locator('.mermaid-svg svg')).toBeVisible();
	});

	test('gives every code block a working copy affordance', async ({ onboarded }) => {
		const { page } = onboarded;
		const body = await openKitchenSinkReply(page);
		await expectCopyAffordance(page, body);
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
