import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { admonition, admonitionTypes } from './admonition';

interface HastRoot {
	type: 'root';
	children: unknown[];
}

function toHast(md: string): HastRoot {
	return unified().use(remarkParse).use(remarkRehype).runSync(unified().use(remarkParse).parse(md));
}

function applyPlugin(md: string): HastRoot {
	const tree = toHast(md);
	unified().use(admonition).runSync(tree);
	return tree;
}

function json(tree: HastRoot): string {
	return JSON.stringify(tree, (k, v) => (k === 'position' ? undefined : v), 2);
}

function findDivByCallout(tree: HastRoot) {
	let result: unknown = null;
	function walk(node: unknown) {
		if (node && typeof node === 'object' && (node as { type: string }).type === 'element') {
			const el = node as {
				tagName: string;
				properties: { className?: string[] };
				children: unknown[];
			};
			if (
				el.tagName === 'div' &&
				Array.isArray(el.properties.className) &&
				el.properties.className.includes('callout')
			) {
				result = el;
			} else {
				for (const child of el.children) walk(child);
			}
		}
	}
	for (const child of (tree as HastRoot).children) walk(child);
	return result;
}

describe('admonitionTypes', () => {
	it('contains the expected types', () => {
		expect(admonitionTypes.has('note')).toBe(true);
		expect(admonitionTypes.has('tip')).toBe(true);
		expect(admonitionTypes.has('warning')).toBe(true);
		expect(admonitionTypes.has('concept')).toBe(true);
		expect(admonitionTypes.has('info')).toBe(true);
	});
});

describe('admonition rehype plugin', () => {
	it('converts a recognized [!NOTE] blockquote to a div', () => {
		const tree = applyPlugin('> [!NOTE] Hello world');
		const el = findDivByCallout(tree) as {
			tagName: string;
			properties: { className: string[] };
			children: unknown[];
		};
		expect(el).not.toBeNull();
		expect(el.tagName).toBe('div');
		expect(el.properties.className).toContain('callout');
		expect(el.properties.className).toContain('callout-note');
		const title = el.children[0] as {
			tagName: string;
			properties: { className: string[] };
			children: { value: string }[];
		};
		expect(title.tagName).toBe('p');
		expect(title.properties.className).toContain('callout-title');
		expect(title.children[0].value).toBe('Note');
	});

	const recognizedTypes = [
		['NOTE', 'Note', 'callout-note'],
		['TIP', 'Tip', 'callout-tip'],
		['WARNING', 'Warning', 'callout-warning'],
		['CONCEPT', 'Concept', 'callout-concept'],
		['INFO', 'Info', 'callout-info']
	] as const;

	for (const [raw, label, cls] of recognizedTypes) {
		it(`converts [!${raw}] to ${label}`, () => {
			const tree = applyPlugin(`> [!${raw}] Body text`);
			const el = findDivByCallout(tree) as {
				properties: { className: string[] };
				children: unknown[];
			};
			expect(el).not.toBeNull();
			expect(el.properties.className).toContain(cls);
			expect((el.children[0] as { children: { value: string }[] }).children[0].value).toBe(label);
		});
	}

	it('handles mixed-case [!Note]', () => {
		const tree = applyPlugin('> [!Note] Hello');
		const el = findDivByCallout(tree) as {
			properties: { className: string[] };
			children: unknown[];
		};
		expect(el).not.toBeNull();
		expect(el.properties.className).toContain('callout-note');
	});

	it('strips marker from same-line body text (prompt shape)', () => {
		const tree = applyPlugin(
			'> [!NOTE] Terraform is declarative — you describe desired state; the tool reconciles.'
		);
		const el = findDivByCallout(tree) as { children: unknown[] };
		const bodyParagraph = el.children[1] as { tagName: string; children: { value: string }[] };
		expect(bodyParagraph.tagName).toBe('p');
		expect(bodyParagraph.children[0].value).toBe(
			'Terraform is declarative — you describe desired state; the tool reconciles.'
		);
	});

	it('drops empty paragraph when marker is alone on its line', () => {
		const tree = applyPlugin('> [!WARNING]\n> body text');
		const el = findDivByCallout(tree) as { children: unknown[] };
		const bodyParagraph = el.children[1] as { tagName: string; children: { value: string }[] };
		expect(bodyParagraph.tagName).toBe('p');
		expect(bodyParagraph.children[0].value.trim()).toBe('body text');
	});

	it('converts unknown type to neutral callout with title-cased label', () => {
		const tree = applyPlugin('> [!IMPORTANT] This is important\n> body text');
		const el = findDivByCallout(tree) as {
			properties: { className: string[] };
			children: unknown[];
		};
		expect(el).not.toBeNull();
		expect(el.properties.className).toEqual(['callout']);
		expect(el.properties.className).not.toContain('callout-important');
		const title = el.children[0] as { children: { value: string }[] };
		expect(title.children[0].value).toBe('Important');
		expect(el.children.length).toBe(2);
		const body = el.children[1] as { tagName: string; children: { value: string }[] };
		expect(body.tagName).toBe('p');
		expect(body.children[0].value).toContain('This is important');
	});

	it('leaves a plain blockquote untouched', () => {
		const tree = applyPlugin('> just a quote');
		const html = json(tree);
		expect(html).toContain('"tagName": "blockquote"');
		expect(html).not.toContain('callout');
	});

	it('leaves a blockquote with [!NOTE] mid-text untouched', () => {
		const tree = applyPlugin('> This mentions [!NOTE] mid-text');
		const html = json(tree);
		expect(html).toContain('"tagName": "blockquote"');
		expect(html).not.toContain('callout');
	});

	it('re-parents multi-paragraph body', () => {
		const tree = applyPlugin('> [!NOTE]\n> First paragraph.\n>\n> Second paragraph.');
		const el = findDivByCallout(tree) as { children: unknown[] };
		expect(el.children.length).toBe(3);
		const p1 = el.children[1] as { tagName: string; children: { value: string }[] };
		const p2 = el.children[2] as { tagName: string; children: { value: string }[] };
		expect(p1.tagName).toBe('p');
		expect(p1.children[0].value.trim()).toBe('First paragraph.');
		expect(p2.tagName).toBe('p');
		expect(p2.children[0].value.trim()).toBe('Second paragraph.');
	});

	it('preserves list body children', () => {
		const tree = applyPlugin('> [!NOTE]\n> - item 1\n> - item 2');
		const el = findDivByCallout(tree) as { children: unknown[] };
		const ul = el.children[1] as { tagName: string };
		expect(ul.tagName).toBe('ul');
	});
});
