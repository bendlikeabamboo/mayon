/**
 * Shared fenced-block extractor for generation parsers.
 *
 * Model output is prompt-driven JSON-in-a-fence. This helper pulls the first
 * fenced block out of the raw text — and, critically, keeps any ``` fences
 * nested *inside* JSON string values intact.
 *
 * `extractFencedBlock(raw, tag?)`:
 *   - tag='gate'     → matches ```gate opening fence only
 *   - tag='json'     → matches ```json or ``` (bare) opening fence
 *   - tag undefined  → same as 'json' (backward compat)
 *
 * `extractFencedJson` is kept as a backward-compatible alias.
 */

/**
 * Pull the first fenced block tagged with `tag` (or ```json / bare ```) from `raw`.
 * Falls back to the whole (trimmed) string when there's no matching fence.
 *
 * **Nested-fence handling:** model output frequently embeds code blocks inside
 * JSON string values (e.g. a step containing ` ```hcl ... ``` `). A naive
 * non-greedy `([\s\S]*?)``` would stop at the *inner* fence and yield
 * truncated, unparseable JSON. We instead capture from the opening fence to the
 * LAST ``` in the text (greedy across the body), which correctly keeps nested
 * fences intact as part of the JSON string.
 */
export function extractFencedBlock(raw: string, tag?: string): string {
	const trimmed = raw.trim();

	let openRegex: RegExp;
	if (tag === 'gate') {
		openRegex = /```gate\s*\n?/i;
	} else if (tag === 'json') {
		openRegex = /```(?:json)?\s*\n?/i;
	} else {
		openRegex = /```(?:json)?\s*\n?/i;
	}

	const open = trimmed.match(openRegex);
	if (!open || open.index === undefined) return trimmed;
	const start = open.index + open[0].length;

	const closeIdx = trimmed.lastIndexOf('```');
	if (closeIdx <= start) {
		return trimmed.slice(start).trim();
	}
	return trimmed.slice(start, closeIdx).trim();
}

/** Backward-compatible alias for extractFencedBlock(raw, 'json'). */
export function extractFencedJson(raw: string): string {
	return extractFencedBlock(raw, 'json');
}
