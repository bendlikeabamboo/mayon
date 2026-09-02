import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { mark } from '$lib/perf/mark';

export interface Section {
	index: number;
	level: 1 | 2 | 3 | 4 | 5 | 6;
	title: string;
	start: number;
	end: number;
	length: number;
	excerpt: string;
}

const EXCERPT_MAX_CHARS = 240;

interface MdNode {
	type: string;
	value?: string;
	depth?: number;
	position?: { start: { offset: number }; end: { offset: number } };
	children?: MdNode[];
}

interface HeadingEntry {
	start: number;
	depth: number;
	text: string;
}

interface ParagraphEntry {
	start: number;
	text: string;
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

let lastRaw: string | undefined;
let lastSections: Section[] | undefined;

export function extractSections(raw: string): Section[] {
	if (raw === lastRaw) return lastSections!;
	return mark('strip:extract', () => {
		const sections = computeSections(raw);
		lastRaw = raw;
		lastSections = sections;
		return sections;
	});
}

export function clearSectionsCache(): void {
	lastRaw = undefined;
	lastSections = undefined;
}

export function isStripCandidate(sections: readonly Section[]): boolean {
	return sections.length >= 3;
}

function computeSections(raw: string): Section[] {
	const tree = processor.parse(raw) as unknown as MdNode;
	const headings: HeadingEntry[] = [];
	const paragraphs: ParagraphEntry[] = [];
	walk(tree, headings, paragraphs);
	const sections: Section[] = [];
	for (let i = 0; i < headings.length; i++) {
		const start = headings[i]!.start;
		const end = i + 1 < headings.length ? headings[i + 1]!.start : raw.length;
		const parts: string[] = [];
		for (const p of paragraphs) {
			if (p.start >= start && p.start < end) parts.push(p.text);
		}
		sections.push({
			index: i,
			level: clampLevel(headings[i]!.depth),
			title: headings[i]!.text,
			start,
			end,
			length: end - start,
			excerpt: capExcerpt(collapse(parts.join(' ')))
		});
	}
	return sections;
}

function walk(node: MdNode, headings: HeadingEntry[], paragraphs: ParagraphEntry[]): void {
	if (node.type === 'blockquote') return;
	if (node.type === 'heading') {
		const offset = node.position?.start.offset;
		if (offset !== undefined) {
			headings.push({
				start: offset,
				depth: node.depth ?? 1,
				text: collapse(collectText(node).join(' '))
			});
		}
		return;
	}
	if (node.type === 'paragraph') {
		const offset = node.position?.start.offset;
		if (offset !== undefined) {
			paragraphs.push({ start: offset, text: collapse(collectText(node).join(' ')) });
		}
		return;
	}
	for (const child of node.children ?? []) walk(child, headings, paragraphs);
}

function collectText(node: MdNode): string[] {
	if (node.type === 'text' || node.type === 'inlineCode') {
		return node.value ? [node.value] : [];
	}
	const out: string[] = [];
	for (const child of node.children ?? []) out.push(...collectText(child));
	return out;
}

function collapse(s: string): string {
	return s.replace(/\s+/g, ' ').trim();
}

function capExcerpt(text: string): string {
	if (text.length <= EXCERPT_MAX_CHARS) return text;
	const cut = text.slice(0, EXCERPT_MAX_CHARS);
	const space = cut.lastIndexOf(' ');
	return space > 0 ? cut.slice(0, space) : cut;
}

function clampLevel(depth: number): Section['level'] {
	return Math.min(6, Math.max(1, depth)) as Section['level'];
}
