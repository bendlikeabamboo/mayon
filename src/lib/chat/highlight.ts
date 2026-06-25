/**
 * Browser selection → raw-markdown offset mapping (architecture.md §4, P2).
 *
 * The user highlights a span in the **rendered** assistant reply; we need to
 * store `startChar`/`endChar` against the **raw markdown** `content` so a
 * branch can re-pin the excerpt later. Rendered prose and raw markdown are not
 * isomorphic (markdown syntax — list markers, emphasis, code fences — does not
 * survive into rendered text), so we cannot translate offsets 1:1.
 *
 * Strategy (from the plan): anchor on a substring of the rendered selection
 * that also exists verbatim in the raw markdown, then locate the excerpt
 * inside it. Visible prose is usually a substring of the raw markdown (the
 * prose itself is rarely transformed by markdown — only the surrounding
 * markup is). So:
 *
 *   1. Read the selected text and its window within the rendered container.
 *   2. Widen to an anchor: a few characters of context on each side, which is
 *      more likely to be unique than the bare selection.
 *   3. Find that anchor in `rawContent`, tolerating whitespace reflow (a list
 *      marker "\n- " collapses to " " in rendered text).
 *   4. The excerpt sits at the same position inside the anchor — in collapsed
 *      (whitespace-normalized) coordinate space, so reflow inside the window
 *      is handled uniformly.
 *
 * If any step fails (the selection touches generated content like an expanded
 * Mermaid SVG, or the anchor isn't found), return `null` — the caller uses the
 * graceful fallback (`startChar=0`, `endChar=excerpt.length`).
 *
 * Pure: takes plain data (no DOM types) so it is unit-testable. The component
 * gathers the Selection/Range and passes the resolved strings in.
 */

export interface SelectionInput {
	/** The exact text the user selected (from `Selection.toString()`). */
	excerpt: string;
	/** The full visible text of the message's rendered container. */
	containerText: string;
	/** Offset of the selection start within `containerText` (inclusive). */
	startInContainer: number;
	/** Offset of the selection end within `containerText` (exclusive). */
	endInContainer: number;
}

export interface ResolvedOffsets {
	startChar: number;
	endChar: number;
	excerpt: string;
}

/** Characters of surrounding context grabbed on each side to form the anchor. */
const CONTEXT_PAD = 12;

/**
 * A bidirectional whitespace-collapse map: for every position in the collapsed
 * string, `toOriginal[i]` is the index in the original string that produced it.
 */
interface CollapsedText {
	collapsed: string;
	toOriginal: number[];
}

function collapse(s: string): CollapsedText {
	const collapsed: string[] = [];
	const toOriginal: number[] = [];
	let lastWasWs = false;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i]!;
		if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') {
			if (!lastWasWs) {
				collapsed.push(' ');
				toOriginal.push(i);
			}
			lastWasWs = true;
		} else {
			collapsed.push(ch);
			toOriginal.push(i);
			lastWasWs = false;
		}
	}
	// Trim leading/trailing whitespace from the collapsed form (and the map).
	let start = 0;
	let end = collapsed.length;
	while (start < end && collapsed[start] === ' ') start++;
	while (end > start && collapsed[end - 1] === ' ') end--;
	return {
		collapsed: collapsed.slice(start, end).join(''),
		toOriginal: toOriginal.slice(start, end)
	};
}

/**
 * Markdown syntax characters that rendering strips from visible prose. Used
 * only for the lookup fallback when the verbatim (whitespace-collapsed) anchor
 * isn't found — e.g. a rendered "first second" against raw "first - second".
 */
const MARKDOWN_SYNTAX = new Set(['-', '*', '+', '#', '>', '`', '_', '~']);

/**
 * Collapse `s` like `collapse`, additionally dropping pure-syntax characters
 * that markdown rendering removes from visible text. Keeps a parallel
 * `toOriginal` map against the unmodified input so offsets still resolve.
 */
function collapseStripped(s: string): CollapsedText {
	const collapsed: string[] = [];
	const toOriginal: number[] = [];
	let lastWasWs = false;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i]!;
		if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') {
			if (!lastWasWs) {
				collapsed.push(' ');
				toOriginal.push(i);
			}
			lastWasWs = true;
		} else if (MARKDOWN_SYNTAX.has(ch)) {
			// Drop syntax chars but treat them as collapsible whitespace so we
			// don't leave doubled spaces (rendered text has no marker here).
			if (!lastWasWs) {
				collapsed.push(' ');
				toOriginal.push(i);
			}
			lastWasWs = true;
		} else {
			collapsed.push(ch);
			toOriginal.push(i);
			lastWasWs = false;
		}
	}
	let start = 0;
	let end = collapsed.length;
	while (start < end && collapsed[start] === ' ') start++;
	while (end > start && collapsed[end - 1] === ' ') end--;
	return {
		collapsed: collapsed.slice(start, end).join(''),
		toOriginal: toOriginal.slice(start, end)
	};
}

/**
 * Map a rendered-text selection back into raw-markdown offsets. Returns null
 * when the mapping cannot be confidently resolved (caller falls back).
 */
export function resolveSelectionOffsets(
	rawContent: string,
	selection: SelectionInput
): ResolvedOffsets | null {
	const { excerpt, containerText, startInContainer, endInContainer } = selection;

	// Sanity: the excerpt must actually live within the reported window.
	if (
		excerpt.length === 0 ||
		startInContainer < 0 ||
		endInContainer > containerText.length ||
		endInContainer - startInContainer < excerpt.length
	) {
		return null;
	}

	// Confirm the reported excerpt matches the slice of container text. If not,
	// the caller fed us inconsistent data — bail to the fallback.
	const containerSlice = containerText.slice(startInContainer, endInContainer);
	const cExcerpt = collapse(excerpt).collapsed;
	const cSlice = collapse(containerSlice).collapsed;
	if (cSlice !== cExcerpt && !cSlice.includes(cExcerpt)) {
		return null;
	}

	// Widen to an anchor with context on both sides, clamped to the container.
	const ctxStart = Math.max(0, startInContainer - CONTEXT_PAD);
	const ctxEnd = Math.min(containerText.length, endInContainer + CONTEXT_PAD);
	const anchor = containerText.slice(ctxStart, ctxEnd);

	// Resolve entirely in collapsed space so reflow inside the window is handled.
	// Try verbatim-collapse first; fall back to syntax-stripping when the anchor
	// spanned a list marker / emphasis / heading hash that rendering removed.
	const attempts: Array<{ raw: CollapsedText; anchor: CollapsedText }> = [
		{ raw: collapse(rawContent), anchor: collapse(anchor) }
	];
	// Only add the stripped fallback if the verbatim attempt would miss.
	if (attempts[0].raw.collapsed.indexOf(attempts[0].anchor.collapsed) < 0) {
		attempts.push({
			raw: collapseStripped(rawContent),
			anchor: collapseStripped(anchor)
		});
	}

	let resolvedCollapsedStart = -1;
	let resolvedRaw: CollapsedText | null = null;
	for (const a of attempts) {
		const hit = a.raw.collapsed.indexOf(a.anchor.collapsed);
		if (hit < 0) continue;
		const relStart = a.anchor.collapsed.indexOf(cExcerpt);
		if (relStart < 0) continue;
		resolvedCollapsedStart = hit + relStart;
		resolvedRaw = a.raw;
		break;
	}
	if (resolvedCollapsedStart < 0 || !resolvedRaw) return null;

	const collapsedStart = resolvedCollapsedStart;
	const collapsedEnd = collapsedStart + cExcerpt.length;
	if (collapsedEnd > resolvedRaw.toOriginal.length) return null;

	const startChar = resolvedRaw.toOriginal[collapsedStart]!;
	const endChar = resolvedRaw.toOriginal[collapsedEnd - 1]! + 1;

	// Final verification: the raw slice must collapse to the excerpt, accepting
	// either variant (verbatim vs syntax-stripped) since markers may be present.
	const rawSlice = rawContent.slice(startChar, endChar);
	if (
		collapse(rawSlice).collapsed !== cExcerpt &&
		collapseStripped(rawSlice).collapsed !== cExcerpt
	) {
		return null;
	}

	return { startChar, endChar, excerpt };
}
