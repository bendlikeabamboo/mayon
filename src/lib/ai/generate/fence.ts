/**
 * Shared fenced-JSON extractor for generation parsers (P3 lab, P4 quiz).
 *
 * Model output is prompt-driven JSON-in-a-fence. This helper pulls the first
 * ```json (or bare ```) block out of the raw text — and, critically, keeps any
 * ``` fences nested *inside* JSON string values intact. It is reused by
 * {@link module:lab.parseGeneratedLab} (P3) and `parseGeneratedQuiz` /
 * `parseGradedAnswer` (P4) so the nested-fence handling lives in one place.
 */

/**
 * Pull the first ```json (or bare ```) fenced block from `raw`. Falls back to
 * the whole (trimmed) string when there's no fence — some models emit bare JSON.
 *
 * **Nested-fence handling:** model output frequently embeds code blocks inside
 * JSON string values (e.g. a step containing ` ```hcl ... ``` `). A naive
 * non-greedy `([\s\S]*?)``` would stop at the *inner* fence and yield
 * truncated, unparseable JSON. We instead capture from the opening fence to the
 * LAST ``` in the text (greedy across the body), which correctly keeps nested
 * fences intact as part of the JSON string. If that fails to parse, the caller's
 * retry path kicks in.
 */
export function extractFencedJson(raw: string): string {
	const trimmed = raw.trim();
	// Opening fence: ``` optionally tagged (json/JSON/no tag).
	const open = trimmed.match(/```(?:json)?\s*\n?/i);
	if (!open || open.index === undefined) return trimmed;
	const start = open.index + open[0].length;
	// Closing fence: the LAST ``` in the text (greedy). This preserves any
	// nested ``` that appear inside JSON string values.
	const closeIdx = trimmed.lastIndexOf('```');
	if (closeIdx <= start) {
		// No closing fence after the opening one — take everything to the end.
		return trimmed.slice(start).trim();
	}
	return trimmed.slice(start, closeIdx).trim();
}
