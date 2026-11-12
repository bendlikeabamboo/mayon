/**
 * Deterministic, idempotent repair of common model-produced mermaid syntax
 * faults (spec 028 US2, re-scoped by feature 036 —
 * specs/036-mermaid-repair-integrity/contracts/repair-semantics.md). Pure
 * string surgery: no mermaid import, no DOM, no state. Applied ONCE by the
 * render seam (mermaid.ts), and only after the original source failed —
 * valid sources never reach this code path and are returned untouched
 * (identity).
 *
 * 036 semantics: directive (`%%{…}%%`) and comment (`%% …`) lines are
 * protected — no rule rewrites a character on them. The remaining rules are
 * a fixed order of single passes (no rescan loops), scoped by diagram family
 * (rules 2–4 apply only when the first non-protected, non-empty line declares
 * `graph`/`flowchart`) and by label position, so valid C4/xychart/init syntax
 * is never rewritten. Each rule is a no-match on its own output and rule
 * outputs cannot create matches for earlier rules ⇒ idempotent by
 * construction.
 */

// Typographic quotes break mermaid's quoting; normalize to straight ones.
const SMART_QUOTES: Record<string, string> = {
	'“': '"',
	'”': '"',
	'‘': "'",
	'’': "'"
};
const SMART_QUOTE_CHARS = /[“”‘’]/g;

// Protected lines: directives (`%%{…}%%`) and comments (`%% …`) — untouched,
// valid or not (directive-local repair is out of scope).
const PROTECTED_LINE = /^\s*%%/;

// The first non-protected, non-empty line declares the diagram family; rules
// 2–4 target shapes that exist only in the flowchart family.
const FLOWCHART_DECLARE = /^\s*(?:graph|flowchart)\b/;

// Rule 2: a comma-separated run of ≥2 quoted strings inside a pipe-delimited
// edge label is never valid — collapse the whole run to ONE quoted label.
const QUOTED_EDGE_LIST = /\|("[^"]*"(?:\s*,\s*"[^"]*")+)\s*\|/g;
const QUOTED_RUN_PART = /"([^"]*)"/g;

// Rule 3: a `"` inside a quoted label (opened after `[`, `(`, `|`; closed
// before `]`, `)`, `|`) breaks parsing; mermaid's native `#quot;` entity is
// the safe escape (processed pre-sanitize, valid under securityLevel strict).
const EMBEDDED_QUOTE = /([[(|])"(.*?)"(?=[\])|])/g;

// Rule 4: unquoted square-bracket label containing a comma on a bracket
// preceded by a node identifier — wrap in double quotes. The identifier
// prefix keeps data-series positions (e.g. xychart, non-flowchart anyway)
// out of scope.
const UNQUOTED_COMMA_LABEL = /([A-Za-z_][-\w]*)\[([^"\]"]*,[^"\]"]*)\]/g;

export function repairMermaidSource(source: string): string {
	const lines = source.split('\n');
	// Family detection: the first non-protected, non-empty line.
	let flowchartFamily = false;
	for (const line of lines) {
		if (PROTECTED_LINE.test(line) || line.trim() === '') continue;
		flowchartFamily = FLOWCHART_DECLARE.test(line);
		break;
	}
	return lines
		.map((line) => {
			// Protected lines: no rule rewrites any character on them.
			if (PROTECTED_LINE.test(line)) return line;
			// Rule 1 — normalize smart quotes (never valid outside protected
			// lines), the only rule that applies in every family.
			let out = line.replace(SMART_QUOTE_CHARS, (ch) => SMART_QUOTES[ch]!);
			if (!flowchartFamily) return out;
			// Rule 2 — collapse quoted edge-label lists to one quoted label.
			out = out.replace(QUOTED_EDGE_LIST, (_match, run: string) => {
				const parts: string[] = [];
				for (const part of run.matchAll(QUOTED_RUN_PART)) parts.push(part[1] ?? '');
				return `|"${parts.join(', ')}"|`;
			});
			// Rule 3 — escape embedded quotes inside quoted label spans.
			out = out.replace(EMBEDDED_QUOTE, (match, open: string, inner: string) =>
				inner.includes('"') ? open + '"' + inner.replaceAll('"', '#quot;') + '"' : match
			);
			// Rule 4 — wrap comma-containing unquoted node labels.
			out = out.replace(
				UNQUOTED_COMMA_LABEL,
				(_match, id: string, label: string) => `${id}["${label}"]`
			);
			return out;
		})
		.join('\n');
}

/**
 * Canned follow-up prompt for the fix-diagram affordance (spec 028 US3,
 * contracts/fix-affordance.md): asks for ONLY a corrected mermaid fence,
 * carries the original source verbatim, and names the failure reason.
 * Pure string builder — deterministic, no DOM, no state.
 */
export function buildMermaidFixPrompt(source: string, reason: string): string {
	return [
		'The mermaid diagram below failed to render. Reply with ONLY a corrected version of it as a single valid ```mermaid code fence — no other text.',
		'',
		'Original source:',
		'```mermaid',
		source,
		'```',
		'',
		`The diagram failed to render with this error: ${reason}`
	].join('\n');
}
