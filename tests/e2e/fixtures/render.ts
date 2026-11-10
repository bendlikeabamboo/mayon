import { expect, type Locator, type Page } from '@playwright/test';
import { LATE_MARKER } from './kitchen-sink';

/**
 * Live streaming text blocks (029 per-block ids): `msg-live-text-0`,
 * `msg-live-text-1`, … Reasoning blocks mount under `msg-live-reasoning-N`.
 */
export function liveText(page: Page): Locator {
	return page.locator('[id^="msg-live-text"]');
}

export async function openKitchenSinkReply(page: Page): Promise<Locator> {
	const composer = page.getByPlaceholder(/Message the active provider/);
	await composer.fill('Render the kitchen sink');
	await page.getByRole('button', { name: 'Send', exact: true }).click();
	const body = page.locator('.markdown-body').last();
	await expect(body).toContainText(LATE_MARKER);
	await expect(liveText(page)).toHaveCount(0);
	return body;
}

export async function expectMarkdownStructure(body: Locator): Promise<void> {
	await expect(
		body.getByRole('heading', { level: 1, name: 'The Kitchen-Sink Fixture' })
	).toHaveCount(1);
	await expect(body.getByRole('heading', { level: 2, name: 'Markdown Structure' })).toHaveCount(1);
	await expect(body.getByRole('heading', { level: 3, name: 'Nested Emphasis' })).toHaveCount(1);
	await expect(body.locator('ul > li')).toHaveCount(5);
	await expect(body.locator('ul input[type="checkbox"]')).toHaveCount(2);
	await expect(body.locator('ol > li')).toHaveCount(3);
	await expect(body.locator('table')).toHaveCount(1);
	await expect(body.locator('table tbody tr')).toHaveCount(3);
	await expect(body.locator('blockquote')).toContainText('quiet deterministic assertion');
	await expect(body.locator('a[href="https://mermaid.js.org"]')).toHaveCount(1);
}

export async function expectMermaidDiagram(body: Locator): Promise<void> {
	await expect(body.locator('.mermaid-svg svg')).toBeVisible({ timeout: 30_000 });
	// Diagrams are stamped with the resolved theme they were rendered under.
	await expect(body.locator('.mermaid-svg')).toHaveAttribute(
		'data-rendered-theme',
		/^(light|dark)$/
	);
	await expect(body.locator('code.language-mermaid')).toHaveCount(0);
}

export async function selectParagraph(page: Page, body: Locator, text: string): Promise<void> {
	// Real browser selection over the paragraph, then a bubbling mouseup so the
	// app's selection flow computes the toolbar. Synthetic Range + mouseup is
	// NOT sufficient: the toolbar only appears for real selections. The whole
	// cycle retries because the chat viewport's stick-to-bottom logic can
	// scroll the freshly selected paragraph back out from under the toolbar,
	// which would place the fixed-position toolbar outside the viewport.
	const para = body.locator('p').filter({ hasText: text });
	const toolbar = page.getByRole('button', { name: 'Branch from this' });
	await expect(async () => {
		// selectText does not scroll a non-focusable <p>; without this the
		// selection (and thus the fixed-position toolbar) sits off-screen.
		await para.scrollIntoViewIfNeeded();
		await para.selectText();
		await body.evaluate((container) => {
			container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
		});
		await expect(toolbar).toBeVisible();
	}).toPass({ timeout: 15_000 });
}
