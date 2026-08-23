/**
 * Expound-on-excerpt branching (expound-context-menu-branching plan).
 *
 * Pure, DOM-free helpers for building the expound prompt and guarding against
 * overlapping excerpts (a word can't belong to two expounds; one branch per
 * excerpt falls out of the same half-open overlap check).
 *
 * Offsets are raw-markdown character offsets (as resolved by
 * `resolveSelection` against the source map (`src/lib/chat/selection.ts`);
 * an unresolved selection disables the menu before reaching the store), and ranges are treated
 * as half-open `[startChar, endChar)` intervals so adjacent excerpts never
 * register as overlapping.
 */

const LEGACY_TOGGLE_LABELS: Readonly<Record<string, string>> = Object.freeze({
	diagrams: 'Diagrams (prompt diagrams)',
	tables: 'Comparison Tables',
	code: 'Code Examples'
});

export interface ExpoundOptions {
	excerpt: string;
	customInstructions: string;
	toggles: string[];
	provideSummary?: boolean;
}

/** A half-open `[startChar, endChar)` character span. */
export interface CharSpan {
	startChar: number;
	endChar: number;
}

/**
 * Build the expound prompt sent as the first user message of the new branch.
 * The excerpt is embedded verbatim; empty custom instructions collapse to a
 * "(none provided)" placeholder; selected instruction names name the extra
 * formats to prefer, or "no extra formats" when none are chosen.
 */
export function buildExpoundPrompt(o: ExpoundOptions): string {
	const instructions = o.customInstructions.trim() || '(none provided)';
	const formats = o.toggles.join(', ');
	const formatsLine =
		formats.length > 0
			? `Adding [${formats}] whenever possible.`
			: 'Adding no extra formats whenever possible.';

	return [
		...(o.provideSummary === true ? ['Summarize the current discussion.', ''] : []),
		'The user would like to expound on this excerpt:',
		'"""',
		o.excerpt,
		'"""',
		'',
		'With the following instructions:',
		instructions,
		'',
		formatsLine
	].join('\n');
}

/**
 * Half-open `[start, end)` overlap test. Returns true when the two spans share
 * at least one character. Adjacent spans (`a.endChar === b.startChar`) do NOT
 * overlap, so back-to-back excerpts are allowed.
 */
export function spansOverlap(a: CharSpan, b: CharSpan): boolean {
	return a.startChar < b.endChar && b.startChar < a.endChar;
}

export function serializeAddFormats(names: string[]): string {
	return JSON.stringify(names);
}

/**
 * Parse a stored `add_formats` value into display names. Legacy v1 keys
 * (`diagrams`/`tables`/`code`) map to their labels at read time; every other
 * string passes through verbatim — recorded names of since-removed or renamed
 * instructions must keep rendering (no valid-set filtering).
 */
export function parseAddFormats(raw: string | null | undefined): string[] {
	if (!raw) return [];
	try {
		const arr = JSON.parse(raw);
		if (!Array.isArray(arr)) return [];
		return arr
			.filter((v: unknown) => typeof v === 'string')
			.map((v: string) => LEGACY_TOGGLE_LABELS[v] ?? v);
	} catch {
		return [];
	}
}

/**
 * True when `sel` overlaps any entry in `existing`. Used to enforce one branch
 * per excerpt and to prevent a word belonging to two expounds.
 */
export function selectionOverlapsExisting(sel: CharSpan, existing: CharSpan[]): boolean {
	return existing.some((span) => spansOverlap(sel, span));
}
