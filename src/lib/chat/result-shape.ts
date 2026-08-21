import { TOOL_SUMMARY_THRESHOLD } from './kinds';
import { scanJsonValues } from '$lib/mcp/sources';

/**
 * Shape classification for expanded tool-result bodies — the single shape
 * authority (seams: feature-004 presentation). Pure function of the stored
 * summary string and the whole parsed result metadata; NEVER of tool name,
 * server identity, or registry state. Detection precedence, first match
 * wins (contracts/tool-result-shapes.md):
 *
 *   1. detail.markdown string | detail.mimeType text/markdown  → markdown
 *   2. detail.mimeType application/json                        → json
 *   3. tolerant JSON scan ≥1 value, ≥60% carrying an http(s)
 *      url anywhere inside                                     → records
 *   4. tolerant JSON scan ≥1 value                             → json
 *   5. markdown heuristics (fenced block / heading / density)  → markdown
 *   6. summary longer than TOOL_SUMMARY_THRESHOLD              → text
 *   7. else                                                     → null (short prose)
 *
 * Never throws; unparseable input falls down the ladder.
 */
export type ResultShape =
	| { kind: 'records'; values: unknown[] }
	| { kind: 'json'; value: unknown }
	| { kind: 'markdown'; text: string }
	| { kind: 'text'; text: string };

/** Ratio of scanned values that must carry an http(s) url to qualify as records. */
const RECORDS_URL_RATIO = 0.6;

/** Bounded depth for the url-presence walk inside one parsed value. */
const URL_DEPTH_LIMIT = 8;

function valueHasHttpUrl(value: unknown, depth = 0): boolean {
	if (depth > URL_DEPTH_LIMIT) return false;
	if (typeof value === 'string') return /https?:\/\//i.test(value);
	if (Array.isArray(value)) return value.some((v) => valueHasHttpUrl(v, depth + 1));
	if (value && typeof value === 'object') {
		return Object.values(value).some((v) => valueHasHttpUrl(v, depth + 1));
	}
	return false;
}

export function classifyResult(summary: string, detail: unknown): ResultShape | null {
	const meta = detail && typeof detail === 'object' ? (detail as Record<string, unknown>) : null;

	// Rule 1: explicit markdown marker — detail override beats string heuristics.
	if (typeof meta?.markdown === 'string' || meta?.mimeType === 'text/markdown') {
		return { kind: 'markdown', text: summary };
	}
	// Rule 2: explicit JSON marker — prioritized over markdown heuristics.
	if (meta?.mimeType === 'application/json') {
		return { kind: 'json', value: safeParse(summary) ?? summary };
	}

	// Rules 3–4: tolerant JSON scan, gated to payload-shaped summaries —
	// prose containing a bare number ("Copied 3 items…") must not classify
	// as JSON, so only values opening with a bracket or quote are scanned.
	if (/^\s*[[{"]/.test(summary)) {
		try {
			const values = scanJsonValues(summary);
			if (values.length > 0) {
				const urlCount = values.filter((v) => valueHasHttpUrl(v)).length;
				if (urlCount / values.length >= RECORDS_URL_RATIO) {
					return { kind: 'records', values };
				}
				return { kind: 'json', value: values.length === 1 ? values[0] : values };
			}
		} catch {
			// classification never throws; fall down the ladder
		}
	}

	// Rule 5: markdown heuristics.
	if (isMarkdownish(summary)) return { kind: 'markdown', text: summary };

	// Rules 6–7: length floor.
	if (summary.length > TOOL_SUMMARY_THRESHOLD) return { kind: 'text', text: summary };
	return null;
}

const FENCED_RE = /```|~~~/;
const HEADING_RE = /^#{1,6}\s/m;
const MD_LINK_RE = /\[[^\]]+\]\(https?:\/\/[^)]+\)/g;

function isMarkdownish(summary: string): boolean {
	if (FENCED_RE.test(summary)) return true;
	if (HEADING_RE.test(summary)) return true;
	const links = summary.match(MD_LINK_RE)?.length ?? 0;
	return summary.length <= 400 ? links >= 2 : links >= 3;
}

function safeParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}
