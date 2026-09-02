import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { test } from './fixtures/onboard';
import { ALIGNED_SENTENCE, LATE_MARKER } from './fixtures/kitchen-sink';
import {
	expectCopyAffordance,
	expectMarkdownStructure,
	expectMath,
	expectMermaidDiagram,
	openKitchenSinkReply,
	selectSentence
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
		await selectSentence(body, ALIGNED_SENTENCE);
		await page.getByRole('button', { name: 'Branch from this' }).click();
		const dialog = page.getByRole('dialog', { name: 'Expound on excerpt' });
		await expect(dialog).toBeVisible();
		await expect(dialog.locator('p[title]')).toHaveAttribute('title', ALIGNED_SENTENCE);
		await dialog.getByRole('button', { name: 'Send', exact: true }).click();
		await expect(page.locator('.markdown-body', { hasText: LATE_MARKER })).toBeVisible();
		const response = await page.request.post('/api/db/query', {
			data: {
				op: 'query',
				sql: 'SELECT start_char, end_char, excerpt FROM branch_sources ORDER BY created_at DESC LIMIT 1'
			}
		});
		const { rows } = (await response.json()) as {
			rows: { start_char: number; end_char: number; excerpt: string }[];
		};
		const start = fixtureRaw.indexOf(ALIGNED_SENTENCE);
		expect(start).toBeGreaterThan(0);
		expect(rows[0]?.start_char).toBe(start);
		expect(rows[0]?.end_char).toBe(start + ALIGNED_SENTENCE.length);
		expect(rows[0]?.excerpt).toBe(ALIGNED_SENTENCE);
	});
});
