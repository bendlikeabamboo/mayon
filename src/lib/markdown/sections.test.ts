import { beforeEach, describe, expect, it } from 'vitest';
import { clearSectionsCache, extractSections, isStripCandidate } from './sections';

describe('extractSections', () => {
	beforeEach(() => {
		clearSectionsCache();
	});

	it('returns an empty array for input with no headings', () => {
		expect(extractSections('')).toEqual([]);
		expect(extractSections('just some prose\n\nmore prose')).toEqual([]);
	});

	it('walks headings in document order with 0-based indices', () => {
		const raw = '# One\n\ntext\n\n## Two\n\nmore\n\n### Three\n\ntail';
		const sections = extractSections(raw);
		expect(sections.map((s) => [s.index, s.level, s.title])).toEqual([
			[0, 1, 'One'],
			[1, 2, 'Two'],
			[2, 3, 'Three']
		]);
	});

	it('caps heading level at 6 across all depths', () => {
		const raw = '# a\n\n## b\n\n### c\n\n#### d\n\n##### e\n\n###### f';
		const sections = extractSections(raw);
		expect(sections.map((s) => s.level)).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it('counts setext headings as sections', () => {
		const raw = 'Title\n=====\n\nbody\n\nSub\n---\n\nrest';
		const sections = extractSections(raw);
		expect(sections.map((s) => [s.level, s.title])).toEqual([
			[1, 'Title'],
			[2, 'Sub']
		]);
	});

	it('ignores headings inside fenced code', () => {
		const raw = '# Real\n\n```md\n# Fake\n```\n\n## After';
		expect(extractSections(raw).map((s) => s.title)).toEqual(['Real', 'After']);
	});

	it('ignores headings inside indented code', () => {
		const raw = '# Real\n\n    # Not a heading\n\n## After';
		expect(extractSections(raw).map((s) => s.title)).toEqual(['Real', 'After']);
	});

	it('ignores headings inside blockquotes', () => {
		const raw = '# Real\n\n> # Quoted heading\n>\n> quoted body\n\n## After';
		expect(extractSections(raw).map((s) => s.title)).toEqual(['Real', 'After']);
	});

	it('ignores headings inside admonitions (blockquote callouts)', () => {
		const raw = '# Real\n\n> [!note]\n> # Heading inside callout\n> body\n\n## After';
		expect(extractSections(raw).map((s) => s.title)).toEqual(['Real', 'After']);
	});

	it('ignores headings inside tables', () => {
		const raw = '# Real\n\n| a | b |\n| --- | --- |\n| # not | x |\n\n## After';
		expect(extractSections(raw).map((s) => s.title)).toEqual(['Real', 'After']);
	});

	it('ignores headings inside math blocks', () => {
		const raw = '# Real\n\n$$\n# not a heading\n$$\n\n## After';
		expect(extractSections(raw).map((s) => s.title)).toEqual(['Real', 'After']);
	});

	it('ignores headings inside raw HTML blocks', () => {
		const raw = '# Real\n\n<div>\n# not a heading\n</div>\n\n## After';
		expect(extractSections(raw).map((s) => s.title)).toEqual(['Real', 'After']);
	});

	it('tiles offsets from the first heading to the end of input', () => {
		const raw = 'intro text\n\n# Alpha\n\nbody one\n\n## Beta\n\nbody two';
		const sections = extractSections(raw);
		expect(sections[0]!.start).toBe(raw.indexOf('# Alpha'));
		expect(sections[0]!.end).toBe(sections[1]!.start);
		expect(sections[1]!.end).toBe(raw.length);
	});

	it('gives the last section an end at raw length even with a trailing newline', () => {
		const raw = '# A\n\ntext\n\n## B\n\nmore\n';
		const sections = extractSections(raw);
		expect(sections[sections.length - 1]!.end).toBe(raw.length);
	});

	it('keeps length equal to end minus start', () => {
		const raw = '# A\n\nsome body\n\n## B\n\nother body\n\n### C\n\ntail';
		for (const s of extractSections(raw)) {
			expect(s.length).toBe(s.end - s.start);
		}
	});

	it('excludes text before the first heading from every section', () => {
		const raw = 'lead-in paragraph\n\n# First\n\nbody';
		const sections = extractSections(raw);
		expect(sections).toHaveLength(1);
		expect(sections[0]!.start).toBe(raw.indexOf('# First'));
	});

	it('produces a single section covering the whole input for one heading', () => {
		const raw = '# Only\n\nbody text';
		const sections = extractSections(raw);
		expect(sections).toHaveLength(1);
		expect(sections[0]!.start).toBe(0);
		expect(sections[0]!.end).toBe(raw.length);
	});

	it('builds the excerpt from plain paragraph text without markdown syntax', () => {
		const raw =
			'# Title\n\nThis is **bold** and `code` and [a link](https://example.com).\n\n## Next';
		const [first] = extractSections(raw);
		expect(first!.excerpt).toContain('This is bold and');
		expect(first!.excerpt).toContain('a link');
		expect(first!.excerpt).not.toContain('#');
		expect(first!.excerpt).not.toContain('*');
		expect(first!.excerpt).not.toContain('`');
		expect(first!.excerpt).not.toContain('[');
		expect(first!.excerpt).not.toContain(']');
		expect(first!.excerpt).not.toContain('(');
	});

	it('collapses whitespace in the excerpt across lines and paragraphs', () => {
		const raw = '# T\n\nline one\nline two\n\npara two\n\n## U';
		expect(extractSections(raw)[0]!.excerpt).toBe('line one line two para two');
	});

	it('excludes the heading text from the section excerpt', () => {
		const raw = '# Headline\n\nbody prose here\n\n## Next';
		const [first] = extractSections(raw);
		expect(first!.excerpt).toBe('body prose here');
		expect(first!.excerpt).not.toContain('Headline');
	});

	it('allows an empty excerpt for a heading-only section', () => {
		const raw = '# A\n\n## B\n\ntext';
		const sections = extractSections(raw);
		expect(sections[0]!.excerpt).toBe('');
		expect(sections[1]!.excerpt).toBe('text');
	});

	it('caps the excerpt at a hard limit without markdown syntax', () => {
		const words = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
		const raw = `# Long\n\n${words}\n\n## End`;
		const [first] = extractSections(raw);
		expect(first!.excerpt.length).toBeLessThanOrEqual(240);
		expect(first!.excerpt).not.toContain('#');
		expect(first!.excerpt).toContain('word0');
	});

	it('returns a trimmed plain title, empty for a bare heading', () => {
		const raw = '##   \n\nbody';
		expect(extractSections(raw)[0]!.title).toBe('');
	});

	it('trims surrounding whitespace from the title', () => {
		const raw = '##   Spaced   \n\nbody';
		expect(extractSections(raw)[0]!.title).toBe('Spaced');
	});

	it('renders inline formatting in the title as plain text', () => {
		const raw = '## Hello *world* and `stuff`\n\nbody';
		const title = extractSections(raw)[0]!.title;
		expect(title).toBe('Hello world and stuff');
		expect(title).not.toContain('*');
		expect(title).not.toContain('`');
	});

	it('memoizes repeated calls on the same input', () => {
		const raw = '# A\n\n## B\n\n### C';
		const first = extractSections(raw);
		expect(extractSections(raw)).toEqual(first);
	});

	it('keeps alternating inputs independent in the last-value cache', () => {
		const a = '# A\n\ntext a';
		const b = '## B\n\ntext b';
		const fromA = extractSections(a);
		extractSections(b);
		expect(extractSections(a)).toEqual(fromA);
		expect(extractSections(b)).not.toEqual(fromA);
	});

	it('still returns stable results after clearSectionsCache', () => {
		const raw = '# A\n\n## B';
		const first = extractSections(raw);
		clearSectionsCache();
		expect(extractSections(raw)).toEqual(first);
	});
});

describe('isStripCandidate', () => {
	it('is false for zero, one, or two sections', () => {
		expect(isStripCandidate([])).toBe(false);
		expect(isStripCandidate(extractSections('# A'))).toBe(false);
		expect(isStripCandidate(extractSections('# A\n\n## B'))).toBe(false);
	});

	it('is true for three or more sections', () => {
		expect(isStripCandidate(extractSections('# A\n\n## B\n\n### C'))).toBe(true);
		expect(isStripCandidate(extractSections('# A\n\n## B\n\n### C\n\n#### D'))).toBe(true);
	});
});
