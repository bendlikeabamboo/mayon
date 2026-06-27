import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './render';

// Local mirror of the component's mermaid-block detector (avoids importing the
// DOM-only mermaid.ts module into a node test).
function hasMermaidCheck(html: string): boolean {
	return /<code[^>]*class="[^"]*\blanguage-mermaid\b[^"]*"/.test(html);
}

describe('renderMarkdown', () => {
	it('renders paragraphs and inline code', () => {
		const html = renderMarkdown('Hello `world`.');
		expect(html).toContain('<p>');
		expect(html).toContain('<code>world</code>');
	});

	it('renders GFM tables', () => {
		const md = '| a | b |\n| --- | --- |\n| 1 | 2 |';
		const html = renderMarkdown(md);
		expect(html).toContain('<table>');
		expect(html).toContain('<th>a</th>');
	});

	it('renders fenced code with a highlight.js language class', () => {
		const md = '```js\nconst x = 1;\n```';
		const html = renderMarkdown(md);
		expect(html).toContain('class="hljs');
		expect(html).toContain('language-js');
	});

	it('leaves fenced mermaid as a language-mermaid code block (rendered lazily by the component)', () => {
		const md = '```mermaid\ngraph TD\nA-->B\n```';
		const html = renderMarkdown(md);
		expect(hasMermaidCheck(html)).toBe(true);
		expect(html).toContain('language-mermaid');
		// The mermaid source survives as escaped text (not raw HTML).
		expect(html).toContain('graph TD');
	});

	it('renders inline + block math via KaTeX', () => {
		const md = 'Inline $a^2$ and block:\n\n$$\\int_0^1 x\\,dx$$';
		const html = renderMarkdown(md);
		expect(html).toContain('katex');
	});

	it('escapes raw HTML in prose (sanitize blocks it)', () => {
		const md = '<script>alert(1)</script>\n\nplain text';
		const html = renderMarkdown(md);
		expect(html).not.toContain('<script>');
		expect(html).toContain('plain text');
	});

	it('renders [!WARNING] as a callout div (not a blockquote)', () => {
		const md = '> [!WARNING]\n> Never commit the state file.';
		const html = renderMarkdown(md);
		expect(html).toContain('class="callout callout-warning"');
		expect(html).toContain('class="callout-title"');
		expect(html).toContain('>Warning</');
		expect(html).toContain('Never commit the state file.');
		expect(html).not.toContain('<blockquote');
	});

	it('renders same-line body [!NOTE] callout correctly', () => {
		const md = '> [!NOTE] Terraform is declarative — you describe desired state.';
		const html = renderMarkdown(md);
		expect(html).toContain('class="callout callout-note"');
		expect(html).toContain('>Note</');
		expect(html).toContain('Terraform is declarative');
		expect(html).not.toContain('[!NOTE]');
	});

	it('leaves a plain blockquote unchanged', () => {
		const md = '> just a quote';
		const html = renderMarkdown(md);
		expect(html).toContain('<blockquote');
		expect(html).not.toContain('callout');
	});
});
