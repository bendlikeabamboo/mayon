import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const BODY = path.resolve(__dirname, 'ToolResultBody.svelte');

describe('ToolResultBody: records rendering (source-inspection)', () => {
	const source = fs.readFileSync(BODY, 'utf-8');

	it('exists and consumes the ResultShape union', () => {
		expect(source).toContain("from '$lib/chat/result-shape'");
	});

	it('renders card titles as external links', () => {
		expect(source).toContain('target="_blank"');
		expect(source).toContain('rel="noopener noreferrer"');
	});

	it('derives cards via collectCards from the shared sources module', () => {
		expect(source).toContain("from '$lib/mcp/sources'");
		expect(source).toContain('collectCards');
	});

	it('shows a muted overflow line for capped cards', () => {
		expect(source).toMatch(/\+\{[^}]*\}\s*more|more/);
		expect(source).toContain('text-muted-foreground');
	});

	it('caps the rendered card list at MAX_CARDS with a slice bound', () => {
		expect(source).toContain('MAX_CARDS = 10');
		expect(source).toMatch(/slice\(0,\s*MAX_CARDS\)/);
	});

	it('uses the quiet-row card vocabulary (text-xs, truncate)', () => {
		expect(source).toContain('text-xs');
		expect(source).toContain('truncate');
	});
});

describe('ToolResultBody: markdown / json / text rendering (source-inspection)', () => {
	const source = fs.readFileSync(BODY, 'utf-8');

	it('renders markdown shapes through the timeline Markdown renderer inside bounded styles', () => {
		expect(source).toContain("import Markdown from '../Markdown.svelte'");
		expect(source).toMatch(/\{(:else )?if shape\.kind === 'markdown'\}/);
		expect(source).toMatch(/<Markdown raw=\{shape\.text\} \/>/);
	});

	it('pretty-prints json shapes with 2-space indent in the bounded pre', () => {
		expect(source).toMatch(/JSON\.stringify\(\s*shape\.value,\s*null,\s*2\s*\)/);
		expect(source).toMatch(/shape\.kind === 'json'/);
	});

	it('renders text shapes as raw summary in the bounded pre', () => {
		expect(source).toMatch(/shape\.kind === 'text'/);
		expect(source).toMatch(/\{shape\.text\}/);
	});

	it('every branch carries the bounded container classes', () => {
		const bounded = source.match(/max-h-60/g) ?? [];
		expect(bounded.length).toBeGreaterThanOrEqual(3);
	});
});

describe('ToolResultBody: degradation safety (US4, source-inspection)', () => {
	const source = fs.readFileSync(BODY, 'utf-8');

	it('records branch is bounded (max-h-60 overflow-y-auto)', () => {
		expect(source).toMatch(/flex max-h-60[\s\S]*?overflow-y-auto/);
	});

	it('every shape branch is bounded — no unbounded container exists', () => {
		const branches = source.match(/\{[#:](?:else )?if shape\.kind === '/g) ?? [];
		expect(branches.length).toBe(4); // records, markdown, json, text
		const bounded = source.match(/max-h-60/g) ?? [];
		const scrollable = source.match(/overflow-y-auto/g) ?? [];
		expect(bounded.length).toBeGreaterThanOrEqual(4);
		expect(scrollable.length).toBeGreaterThanOrEqual(4);
	});

	it('renders no payload markup as raw HTML (no {@html} in the component)', () => {
		expect(source).not.toContain('{@html}');
	});
});
