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
	selectParagraph
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
		// Rows come back positional: [start_char, end_char, excerpt].
		const queryRow = async () => {
			const response = await page.request.post('/api/db/query', {
				data: {
					op: 'query',
					sql: 'SELECT start_char, end_char, excerpt FROM branch_sources ORDER BY created_at DESC LIMIT 1'
				}
			});
			const { rows } = (await response.json()) as { rows: Array<[number, number, string]> };
			return rows[0];
		};
		// The branch persists asynchronously behind the new chat's first turn.
		let row: [number, number, string] | undefined;
		await expect
			.poll(
				async () => {
					row = await queryRow();
					return row;
				},
				{ timeout: 15_000 }
			)
			.toBeTruthy();
		const start = fixtureRaw.indexOf(ALIGNED_PARAGRAPH);
		expect(start).toBeGreaterThan(0);
		expect(row![0]).toBe(start);
		expect(row![1]).toBe(start + ALIGNED_PARAGRAPH.length);
		expect(row![2]).toBe(ALIGNED_PARAGRAPH);
	});
});
