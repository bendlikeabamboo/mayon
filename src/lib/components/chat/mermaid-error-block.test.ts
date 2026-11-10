// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { buildMermaidErrorBlock } from './mermaid-error-block.js';
import { buildMermaidFixPrompt } from '#lib/markdown/mermaid-repair.js';

const SOURCE = 'graph TD\n  A[the "best", "worst" thing] --> B';

describe('buildMermaidErrorBlock', () => {
	it('builds the contained .mermaid-error block with the plain-language notice', () => {
		const block = buildMermaidErrorBlock(SOURCE, new Error('Parse error on line 2'));

		expect(block.tagName).toBe('DIV');
		expect(block.classList.contains('mermaid-error')).toBe(true);
		const notice = block.querySelector('p.mermaid-error-notice');
		expect(notice?.textContent).toBe("This diagram couldn't be rendered");
	});

	it('shows the FULL error text (name: message) in a visible pre.mermaid-error-reason outside any details', () => {
		const err = new Error('Parse error on line 2');
		const block = buildMermaidErrorBlock(SOURCE, err);

		const reason = block.querySelector('pre.mermaid-error-reason');
		expect(reason).not.toBeNull();
		expect(reason?.textContent).toBe('Error: Parse error on line 2');
		// Full text is never collapsed: the reason pre must not sit inside a <details>.
		expect(reason?.closest('details')).toBeNull();
	});

	it('falls back to String(err) for non-Error throwables', () => {
		const block = buildMermaidErrorBlock(SOURCE, 'mermaid exploded');

		expect(block.querySelector('pre.mermaid-error-reason')?.textContent).toBe('mermaid exploded');
	});

	it('carries the pre-wrap class hook on the reason pre (CSS lives in Markdown.svelte)', () => {
		const block = buildMermaidErrorBlock(SOURCE, new Error('nope'));

		const reason = block.querySelector('pre.mermaid-error-reason');
		expect(reason?.classList.contains('mermaid-error-reason')).toBe(true);
	});

	it('collapses the diagram source behind a closed details with pre/code', () => {
		const block = buildMermaidErrorBlock(SOURCE, new Error('bad syntax'));

		const details = block.querySelector('details');
		expect(details).not.toBeNull();
		expect(details?.hasAttribute('open')).toBe(false);
		expect(details?.querySelector('summary')?.textContent).toBeTruthy();
		const code = details?.querySelector('pre > code');
		expect(code?.textContent).toBe(SOURCE);
	});

	it('omits the fix button when no handler is passed', () => {
		const block = buildMermaidErrorBlock(SOURCE, new Error('bad syntax'));

		expect(block.querySelector('.mermaid-fix-btn')).toBeNull();
	});

	it('wires the fix button to buildMermaidFixPrompt(source, full reason text) when a handler is passed', () => {
		const onFix = vi.fn();
		const err = new Error('bad syntax');
		const block = buildMermaidErrorBlock(SOURCE, err, onFix);

		const btn = block.querySelector<HTMLButtonElement>('button.mermaid-fix-btn');
		expect(btn).not.toBeNull();
		expect(btn?.textContent).toBe('Fix this diagram');
		btn?.click();

		expect(onFix).toHaveBeenCalledOnce();
		expect(onFix).toHaveBeenCalledWith(buildMermaidFixPrompt(SOURCE, 'Error: bad syntax'));
	});
});
