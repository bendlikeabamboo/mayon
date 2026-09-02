import { expect, type Locator, type Page } from '@playwright/test';
import { LATE_MARKER } from './kitchen-sink';

export async function openKitchenSinkReply(page: Page): Promise<Locator> {
	const composer = page.getByPlaceholder(/Message the active provider/);
	await composer.fill('Render the kitchen sink');
	await page.getByRole('button', { name: 'Send', exact: true }).click();
	const body = page.locator('.markdown-body').last();
	await expect(body).toContainText(LATE_MARKER);
	await expect(page.locator('#msg-live-text')).toHaveCount(0);
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

export async function expectMath(body: Locator): Promise<void> {
	await expect(body.locator('.katex-display .katex')).toHaveCount(1);
	await expect(body.locator('.katex')).toHaveCount(2);
	await expect(body.locator('.katex').first()).toBeVisible();
}

export async function expectMermaidDiagram(body: Locator): Promise<void> {
	await expect(body.locator('.mermaid-svg svg')).toBeVisible({ timeout: 30_000 });
	await expect(body.locator('code.language-mermaid')).toHaveCount(0);
}

export async function expectCopyAffordance(page: Page, body: Locator): Promise<void> {
	const buttons = body.locator('pre .md-copy-btn');
	await expect(buttons).toHaveCount(2);
	const codeText = (await body.locator('pre code').first().textContent()) ?? '';
	await buttons.first().click();
	const clipboard = await page.evaluate(() => navigator.clipboard.readText());
	expect(clipboard.startsWith(codeText)).toBe(true);
}

export async function selectSentence(body: Locator, sentence: string): Promise<void> {
	await body.evaluate((container, target) => {
		const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
		let node = walker.nextNode();
		while (node) {
			const text = node.textContent ?? '';
			const start = text.indexOf(target);
			if (start >= 0) {
				const range = document.createRange();
				range.setStart(node, start);
				range.setEnd(node, start + target.length);
				const selection = window.getSelection();
				selection?.removeAllRanges();
				selection?.addRange(range);
				container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
				return;
			}
			node = walker.nextNode();
		}
		throw new Error(`alignment target not found: ${target}`);
	}, sentence);
}
