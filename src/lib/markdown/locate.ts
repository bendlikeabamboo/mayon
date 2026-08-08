import type { SourceMap } from './sourcemap';

export function canonicalOffsetOfSegmentStart(sm: SourceMap, segIdx: number): number {
	for (let i = 0; i < sm.canonicalToSegment.length; i++) {
		if (sm.canonicalToSegment[i] === segIdx) return i;
	}
	return sm.canonicalToSegment.length;
}

export function locateCanonical(
	sm: SourceMap,
	startChar: number,
	endChar: number
): { start: number; end: number } | null {
	let segStartIdx = -1;
	let segEndIdx = -1;

	for (let i = 0; i < sm.segments.length; i++) {
		const seg = sm.segments[i]!;
		if (seg.kind === 'inter-block-ws') continue;
		if (segStartIdx === -1 && seg.startChar <= startChar && startChar < seg.endChar) {
			segStartIdx = i;
		}
		if (seg.startChar < endChar && endChar <= seg.endChar) {
			segEndIdx = i;
		}
	}

	if (segStartIdx === -1 || segEndIdx === -1 || segStartIdx > segEndIdx) return null;

	const canonStart =
		canonicalOffsetOfSegmentStart(sm, segStartIdx) +
		(startChar - sm.segments[segStartIdx]!.startChar);

	const segEnd = sm.segments[segEndIdx]!;
	const canonEnd = canonicalOffsetOfSegmentStart(sm, segEndIdx) + (endChar - segEnd.startChar);

	if (canonStart >= canonEnd) return null;

	return { start: canonStart, end: canonEnd };
}
