import type { SourceMap, SegmentKind } from '$lib/markdown/sourcemap';

export interface ResolvedOffsets {
	startChar: number;
	endChar: number;
	excerpt: string;
}

export type ResolveReason = 'empty' | 'generated' | 'unaligned';

export type ResolveResult =
	| ({ ok: true } & ResolvedOffsets)
	| { ok: false; reason: ResolveReason };

export interface AlignmentEntry {
	node: Text;
	canonicalStart: number;
	canonicalEnd: number;
	segmentKind: SegmentKind;
	excluded: boolean;
}

export interface AlignmentTable {
	entries: AlignmentEntry[];
	aligned: boolean;
	unalignedNode: Text | null;
}

export const EXCLUDED_CHROME_SELECTORS = [
	'.katex',
	'.callout-title',
	'code.language-mermaid',
	'.md-copy-btn',
	'.mermaid-svg'
] as const;

export function canonicalize(s: string): string {
	const out: string[] = [];
	let lastWasWs = false;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i]!;
		if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') {
			if (!lastWasWs) {
				out.push(' ');
				lastWasWs = true;
			}
		} else {
			out.push(ch);
			lastWasWs = false;
		}
	}
	let start = 0;
	let end = out.length;
	while (start < end && out[start] === ' ') start++;
	while (end > start && out[end - 1] === ' ') end--;
	return out.slice(start, end).join('');
}

function isExcludedNode(node: Text): boolean {
	const parent = node.parentElement;
	if (!parent) return false;
	for (const sel of EXCLUDED_CHROME_SELECTORS) {
		if (parent.closest(sel)) return true;
	}
	return false;
}

function segmentKindAt(sm: SourceMap, index: number): SegmentKind {
	if (index < 0 || index >= sm.canonicalToSegment.length) return 'prose';
	return sm.segments[sm.canonicalToSegment[index]!]!.kind;
}

function canonicalOffsetOfSegmentStart(sm: SourceMap, segIdx: number): number {
	for (let i = 0; i < sm.canonicalToSegment.length; i++) {
		if (sm.canonicalToSegment[i] === segIdx) return i;
	}
	return sm.canonicalToSegment.length;
}

export function alignDomToCanonical(container: HTMLElement, sm: SourceMap): AlignmentTable {
	let cursor = 0;
	const entries: AlignmentEntry[] = [];
	let aligned = true;
	let unalignedNode: Text | null = null;

	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	let current: Node | null = walker.nextNode();

	while (current) {
		const n = current as Text;
		current = walker.nextNode();

		if (isExcludedNode(n)) {
			const kind = cursor > 0 ? segmentKindAt(sm, cursor - 1) : segmentKindAt(sm, cursor);
			entries.push({
				node: n,
				canonicalStart: cursor,
				canonicalEnd: cursor,
				segmentKind: kind,
				excluded: true
			});
			continue;
		}

		const text = n.textContent ?? '';
		if (text.length === 0) continue;

		if (sm.canonical.startsWith(text, cursor)) {
			let pos = 0;
			while (pos < text.length) {
				const remaining = text.length - pos;
				const segStart = cursor + pos;
				if (segStart >= sm.canonicalToSegment.length) break;
				const segIdx = sm.canonicalToSegment[segStart]!;
				const seg = sm.segments[segIdx]!;
				const segEndInCanonical = segStart + seg.rendered.length;
				const chunkLen = Math.min(remaining, segEndInCanonical - segStart);

				entries.push({
					node: n,
					canonicalStart: segStart,
					canonicalEnd: segStart + chunkLen,
					segmentKind: seg.kind,
					excluded: false
				});

				cursor += chunkLen;
				pos += chunkLen;
			}
		} else {
			aligned = false;
			if (!unalignedNode) unalignedNode = n;
		}
	}

	return { entries, aligned, unalignedNode };
}

function isNodeInRange(range: Range, node: Node): boolean {
	try {
		return range.intersectsNode(node);
	} catch {
		return false;
	}
}

export function resolveSelection(
	table: AlignmentTable,
	sm: SourceMap,
	range: Range
): ResolveResult {
	if (range.collapsed || range.toString().trim() === '') {
		return { ok: false, reason: 'empty' };
	}

	if (!table.aligned && table.unalignedNode && isNodeInRange(range, table.unalignedNode)) {
		return { ok: false, reason: 'unaligned' };
	}

	let startCanonical = Infinity;
	let endCanonical = -1;
	let foundAny = false;

	for (const entry of table.entries) {
		if (entry.excluded) continue;
		if (!isNodeInRange(range, entry.node)) continue;

		foundAny = true;
		let entryStart = entry.canonicalStart;
		let entryEnd = entry.canonicalEnd;

		if (entry.node === range.startContainer) {
			entryStart = entry.canonicalStart + range.startOffset;
		}
		if (entry.node === range.endContainer) {
			entryEnd = entry.canonicalStart + range.endOffset;
		}

		if (entryStart < entryEnd) {
			if (entryStart < startCanonical) startCanonical = entryStart;
			if (entryEnd > endCanonical) endCanonical = entryEnd;
		}
	}

	if (!foundAny || startCanonical === Infinity || endCanonical <= startCanonical) {
		return { ok: false, reason: 'empty' };
	}

	for (const entry of table.entries) {
		if (!entry.excluded) continue;
		if (!isNodeInRange(range, entry.node)) continue;

		const nodeLen = entry.node.textContent?.length ?? 0;
		if (entry.node === range.startContainer && range.startOffset === 0) continue;
		if (entry.node === range.endContainer && range.endOffset === nodeLen) continue;

		return { ok: false, reason: 'generated' };
	}

	for (let i = startCanonical; i < endCanonical; i++) {
		const kind = segmentKindAt(sm, i);
		if (kind === 'math-inline' || kind === 'math-display' || kind === 'mermaid') {
			return { ok: false, reason: 'generated' };
		}
	}

	if (segmentKindAt(sm, startCanonical) === 'inter-block-ws') {
		let found = false;
		for (let i = startCanonical; i < endCanonical; i++) {
			if (segmentKindAt(sm, i) !== 'inter-block-ws') {
				startCanonical = i;
				found = true;
				break;
			}
		}
		if (!found) return { ok: false, reason: 'empty' };
	}

	if (endCanonical > 0 && segmentKindAt(sm, endCanonical - 1) === 'inter-block-ws') {
		for (let i = endCanonical - 1; i >= startCanonical; i--) {
			if (segmentKindAt(sm, i) !== 'inter-block-ws') {
				endCanonical = i + 1;
				break;
			}
		}
	}

	const firstIdx = sm.canonicalToSegment[startCanonical]!;
	const lastIdx = sm.canonicalToSegment[endCanonical - 1]!;

	const firstSegCanonicalStart = canonicalOffsetOfSegmentStart(sm, firstIdx);
	const lastSegCanonicalStart = canonicalOffsetOfSegmentStart(sm, lastIdx);

	const startChar = sm.segments[firstIdx]!.startChar + (startCanonical - firstSegCanonicalStart);
	const endChar = sm.segments[lastIdx]!.startChar + (endCanonical - lastSegCanonicalStart);

	const excerpt = sm.canonical.slice(startCanonical, endCanonical);

	return { ok: true, startChar, endChar, excerpt };
}
