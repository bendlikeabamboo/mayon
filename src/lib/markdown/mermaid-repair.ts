/**
 * Deterministic, idempotent repair of common model-produced mermaid syntax
 * faults (spec 028 US2). Pure string surgery: no mermaid import, no DOM, no
 * state. Applied ONCE by the render seam (mermaid.ts), and only after the
 * original source failed — valid sources never reach this code path and are
 * returned untouched (identity).
 */

// Typographic quotes break mermaid's quoting; normalize to straight ones.
const SMART_QUOTES: Record<string, string> = {
	'“': '"',
	'”': '"',
	'‘': "'",
	'’': "'"
};

// `"a", "b"` (comma-separated quoted strings) is never valid mermaid — the
// model meant one label listing the values, so collapse to `"a, b"`.
const QUOTED_LIST = /"([^"]*)",\s*"([^"]*)"/;

// A `"` inside a quoted label (opened after `[`, `(`, `|`; closed before
// `]`, `)`, `|`) breaks parsing; mermaid's native `#quot;` entity is the
// safe escape (processed pre-sanitize, valid under securityLevel strict).
const EMBEDDED_QUOTE = /([[(|])"(.*?)"(?=[\])|])/g;

// Unquoted square-bracket label containing a comma: wrap in double quotes.
// ponytail: only commas are wrapped — a `"` in an unquoted label is rarer and
// would need ordering tricks; ceiling is "wrap quote too", upgrade path is a
// rule between the embedded-quote pass and this one.
const UNQUOTED_COMMA_LABEL = /\[([^"\]"]*,[^"\]"]*)\]/g;

export function repairMermaidSource(source: string): string {
	let s = source.replace(/[“”‘’]/g, (ch) => SMART_QUOTES[ch]!);
	while (QUOTED_LIST.test(s)) {
		s = s.replace(QUOTED_LIST, (_, a: string, b: string) => `"${a}, ${b}"`);
	}
	s = s.replace(EMBEDDED_QUOTE, (match, open: string, inner: string) =>
		inner.includes('"') ? open + '"' + inner.replaceAll('"', '#quot;') + '"' : match
	);
	s = s.replace(UNQUOTED_COMMA_LABEL, (_, label: string) => `["${label}"]`);
	return s;
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
