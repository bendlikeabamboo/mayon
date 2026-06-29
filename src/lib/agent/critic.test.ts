import { describe, expect, it } from 'vitest';
import { validateTurn } from '$lib/agent/critic';

describe('validateMermaid', () => {
	it('flags bad mermaid source', async () => {
		const issues = await validateTurn('```mermaid\ngraph TD\n  A -->\n```');
		const mermaid = issues.filter((i) => i.type === 'mermaid');
		expect(mermaid.length).toBeGreaterThan(0);
	});

	it('passes good mermaid source', async () => {
		const issues = await validateTurn('```mermaid\ngraph TD\n  A --> B\n```');
		const mermaid = issues.filter((i) => i.type === 'mermaid');
		expect(mermaid).toHaveLength(0);
	});
});

describe('validateCode', () => {
	it('flags odd number of fences', async () => {
		const issues = await validateTurn('```ts\nconst x = 1;\n');
		const code = issues.filter((i) => i.type === 'code');
		expect(code).toHaveLength(1);
		expect(code[0].message).toContain('unterminated code fence');
	});

	it('passes even number of fences', async () => {
		const issues = await validateTurn('```ts\nconst x = 1;\n```');
		const code = issues.filter((i) => i.type === 'code');
		expect(code).toHaveLength(0);
	});
});

describe('validateKatex', () => {
	it('flags invalid KaTeX expression', async () => {
		const issues = await validateTurn('$\\frac{1}{$');
		const katex = issues.filter((i) => i.type === 'katex');
		expect(katex.length).toBeGreaterThan(0);
	});

	it('passes valid KaTeX', async () => {
		const issues = await validateTurn('$x^2$');
		const katex = issues.filter((i) => i.type === 'katex');
		expect(katex).toHaveLength(0);
	});
});

describe('validateAdmonitions', () => {
	it('flags empty type token', async () => {
		const issues = await validateTurn('> [!]');
		const admon = issues.filter((i) => i.type === 'admonition');
		expect(admon).toHaveLength(1);
		expect(admon[0].message).toContain('empty type token');
	});

	it('passes unknown-but-valid type', async () => {
		const issues = await validateTurn('> [!custom] something');
		const admon = issues.filter((i) => i.type === 'admonition');
		expect(admon).toHaveLength(0);
	});

	it('passes when no blockquotes', async () => {
		const issues = await validateTurn('plain text');
		const admon = issues.filter((i) => i.type === 'admonition');
		expect(admon).toHaveLength(0);
	});
});

describe('validateTurn integration', () => {
	it('is async and must be awaited', async () => {
		const result = validateTurn('no issues');
		expect(result).toBeInstanceOf(Promise);
		const issues = await result;
		expect(Array.isArray(issues)).toBe(true);
	});

	it('returns multiple issue types for compound input', async () => {
		const input = '```mermaid\ngraph TD\n  A -->\n```\n```ts\nconst x = 1;\n';
		const issues = await validateTurn(input);
		const types = issues.map((i) => i.type);
		expect(types).toContain('mermaid');
		expect(types).toContain('code');
	});
});
