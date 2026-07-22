import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import { admonition } from './admonition';

export type SegmentKind =
	| 'prose'
	| 'inline-code'
	| 'block-code'
	| 'link-text'
	| 'math-inline'
	| 'math-display'
	| 'mermaid'
	| 'inter-block-ws';

export interface Segment {
	kind: SegmentKind;
	rendered: string;
	startChar: number;
	endChar: number;
}

export interface SourceMap {
	segments: Segment[];
	canonical: string;
	canonicalToSegment: number[];
}

interface HastPosition {
	start: { offset: number; line: number; column: number };
	end: { offset: number; line: number; column: number };
}

interface HastElement {
	type: 'element';
	tagName: string;
	properties: Record<string, unknown>;
	children: Array<HastElement | HastText>;
	position?: HastPosition;
}

interface HastText {
	type: 'text';
	value: string;
	position?: HastPosition;
}

interface HastRoot {
	type: 'root';
	children: Array<HastElement | HastText>;
	position?: HastPosition;
}

type HastNode = HastRoot | HastElement | HastText;

export const _testPlugins = [remarkParse, remarkGfm, remarkMath, remarkRehype, admonition];

const SOURCE_MAP_CACHE_SIZE = 64;
const sourceMapCache = new Map<string, SourceMap>();

export function _clearSourceMapCache(): void {
	sourceMapCache.clear();
}

const sourcemapProcessor = unified()
	.use(remarkParse)
	.use(remarkGfm)
	.use(remarkMath)
	.use(remarkRehype)
	.use(admonition);

function classNames(el: HastElement): string[] {
	const cls = el.properties?.className;
	if (!Array.isArray(cls)) return [];
	return cls.map((c: unknown) => String(c));
}

function textConcat(node: HastElement): string {
	let result = '';
	for (const child of node.children) {
		if (child.type === 'text') {
			result += child.value;
		} else if (child.type === 'element') {
			result += textConcat(child);
		}
	}
	return result;
}

function codeInnerRange(raw: string, posStart: number, posEnd: number): [number, number] {
	const content = raw.slice(posStart, posEnd);
	const firstNewline = content.indexOf('\n');
	if (firstNewline === -1) return [posStart, posEnd];

	const contentStart = posStart + firstNewline + 1;

	let closeStart = -1;
	for (let i = content.length - 1; i >= contentStart - posStart; i--) {
		if (content[i] === '\n') {
			const line = content.slice(i + 1);
			if (/^`{3,}/.test(line)) {
				closeStart = posStart + i;
				break;
			}
		}
	}

	if (closeStart === -1) {
		if (import.meta.env?.DEV) {
			console.warn('[sourcemap] failed to parse closing fence; falling back to element position');
		}
		return [posStart, posEnd];
	}

	return [contentStart, closeStart];
}

function walk(
	raw: string,
	node: HastNode,
	linkOverride: SegmentKind | null,
	segments: Segment[],
	insidePre: boolean,
	skipNextWs: boolean = false
): void {
	if (node.type === 'root' || node.type === 'element') {
		if (node.type === 'element' && node.tagName === 'br') {
			const pos = node.position;
			if (pos) {
				segments.push({
					kind: 'prose',
					rendered: '\n',
					startChar: pos.start.offset,
					endChar: pos.end.offset
				});
			}
			return;
		}

		if (node.type === 'element' && node.tagName === 'pre') {
			const codeChild = node.children.find((c) => c.type === 'element' && c.tagName === 'code') as
				| HastElement
				| undefined;

			if (codeChild) {
				const cls = classNames(codeChild);
				if (cls.includes('language-mermaid')) {
					const pos = codeChild.position ?? node.position;
					if (pos) {
						segments.push({
							kind: 'mermaid',
							rendered: '',
							startChar: pos.start.offset,
							endChar: pos.end.offset
						});
					}
					return;
				}

				const pos = codeChild.position ?? node.position;
				if (pos) {
					const [innerStart, innerEnd] = codeInnerRange(raw, pos.start.offset, pos.end.offset);
					segments.push({
						kind: 'block-code',
						rendered: textConcat(codeChild),
						startChar: innerStart,
						endChar: innerEnd
					});
				}
				return;
			}
		}

		if (node.type === 'element' && node.tagName === 'code' && !insidePre) {
			const cls = classNames(node);
			if (cls.includes('math-inline')) {
				const pos = node.position;
				if (pos) {
					segments.push({
						kind: 'math-inline',
						rendered: '',
						startChar: pos.start.offset,
						endChar: pos.end.offset
					});
				}
				return;
			}
			if (cls.includes('math-display')) {
				const pos = node.position;
				if (pos) {
					segments.push({
						kind: 'math-display',
						rendered: '',
						startChar: pos.start.offset,
						endChar: pos.end.offset
					});
				}
				return;
			}

			const pos = node.position;
			if (pos) {
				segments.push({
					kind: 'inline-code',
					rendered: textConcat(node),
					startChar: pos.start.offset + 1,
					endChar: pos.end.offset - 1
				});
			}
			return;
		}

		const newLinkOverride: SegmentKind | null =
			node.type === 'element' && node.tagName === 'a' ? 'link-text' : linkOverride;

		const childInsidePre = insidePre || (node.type === 'element' && node.tagName === 'pre');
		let localSkipWs = skipNextWs;
		for (const child of node.children) {
			const isBrChild = child.type === 'element' && child.tagName === 'br';
			walk(raw, child, newLinkOverride, segments, childInsidePre, localSkipWs);
			localSkipWs = isBrChild;
		}
		return;
	}

	if (node.type === 'text') {
		if (skipNextWs && !node.position && /^\s*$/.test(node.value)) {
			return;
		}
		const pos = node.position;
		if (pos) {
			segments.push({
				kind: linkOverride ?? 'prose',
				rendered: node.value,
				startChar: pos.start.offset,
				endChar: pos.end.offset
			});
		} else if (/^\s*$/.test(node.value)) {
			segments.push({
				kind: 'inter-block-ws',
				rendered: node.value,
				startChar: -1,
				endChar: -1
			});
		}
	}
}

export function buildSourceMap(input: string): SourceMap {
	const cached = sourceMapCache.get(input);
	if (cached) return cached;

	const tree = sourcemapProcessor.runSync(sourcemapProcessor.parse(input)) as HastRoot;
	const segments: Segment[] = [];
	walk(input, tree, null, segments, false);

	for (let i = segments.length - 1; i >= 0; i--) {
		const seg = segments[i];
		if (seg.kind !== 'inter-block-ws') continue;

		let prevEnd = -1;
		for (let j = i - 1; j >= 0; j--) {
			if (segments[j].kind !== 'inter-block-ws') {
				prevEnd = segments[j].endChar;
				break;
			}
		}
		if (prevEnd === -1) prevEnd = 0;

		let nextStart = input.length;
		for (let j = i + 1; j < segments.length; j++) {
			if (segments[j].kind !== 'inter-block-ws') {
				nextStart = segments[j].startChar;
				break;
			}
		}

		seg.startChar = prevEnd;
		seg.endChar = nextStart;
	}

	const filtered = segments.filter(
		(s) => !(s.kind === 'inter-block-ws' && s.rendered === '' && s.startChar >= s.endChar)
	);

	const canonical = filtered.map((s) => s.rendered).join('');

	const canonicalToSegment: number[] = [];
	for (let i = 0; i < filtered.length; i++) {
		for (let j = 0; j < filtered[i].rendered.length; j++) {
			canonicalToSegment.push(i);
		}
	}

	const result: SourceMap = { segments: filtered, canonical, canonicalToSegment };

	if (sourceMapCache.size >= SOURCE_MAP_CACHE_SIZE) {
		const oldest = sourceMapCache.keys().next().value;
		if (oldest !== undefined) sourceMapCache.delete(oldest);
	}
	sourceMapCache.set(input, result);

	return result;
}
