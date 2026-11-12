/**
 * Corpus tests for repairMermaidSource (spec 028 US2, re-scoped by feature
 * 036 — contracts/repair-semantics.md): a pure, deterministic, idempotent,
 * family-scoped repair pass for common model-produced mermaid syntax faults.
 * Parseability claims are verified against the real mermaid parser, not
 * string-shape assertions.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { repairMermaidSource, buildMermaidFixPrompt } from './mermaid-repair.js';

// Canonical broken diagram from specs/028-mermaid-error-repair (spec.md):
// comma-separated quoted-string list inside an edge label — unparseable.
const SPEC_EXAMPLE = 'graph TD\n  A["waking"] -->|"sad", "SAD", "sleepy", "del"| B["tring"]';

// Unparseable ONLY via the missing `end`; the init directive is valid syntax
// that repair must never rewrite (036 preservation).
const MISSING_END =
	'%%{init: {"theme":"dark", "logLevel": 1}}%%\ngraph TD\n  subgraph "Outer group"\n    A --> B';

// Valid C4 argument lists — non-flowchart family, never rewritten (036).
const C4_CONTEXT = [
	'C4Context',
	'  title Sample C4 context diagram',
	'  Person(pA, "Alice", "A user of the system")',
	'  Person_Ext(pB, "Bob", "External user")',
	'  Container(c1, "DB", "Stores data")',
	'  Rel(pA, c1, "Reads from", "Sync")'
].join('\n');

// Valid xychart quoted/numeric data lists — never rewritten (036).
const XYCHART = [
	'xychart-beta',
	'  title "Sales by month"',
	'  x-axis "months" ["Jan", "Feb", "Mar"]',
	'  y-axis "units" 0 --> 50',
	'  bar [10, 20, 30]'
].join('\n');

// N-element quoted edge-label list (036: must collapse in a single pass).
const EIGHT_CHAIN = 'graph TD\n  A -->|"a", "b", "c", "d", "e", "f", "g", "h"| B';

// Quoted-string prose in a sequenceDiagram message — non-flowchart family,
// never rewritten (036).
const SEQUENCE_PROSE = 'sequenceDiagram\n  Alice->>Bob: say "a", "b" out loud';

const CORPUS = [
	{ name: 'spec example', source: SPEC_EXAMPLE },
	{ name: 'smart quotes in label', source: 'graph TD\n  A["it’s “waking” now"] --> B' },
	{ name: 'embedded quotes in label', source: 'graph TD\n  A["the "best" thing"] --> B' },
	{ name: 'unquoted comma label', source: 'graph TD\n  A[hello, world] --> B' },
	{ name: 'empty quoted pair in edge label', source: 'graph TD\n  A -->|"", ""| B' },
	{ name: 'comma-only node label', source: 'graph TD\n  A[,] --> B' },
	{
		name: 'mixed quote/comma node label',
		source: 'graph TD\n  A[the "best", "worst" thing] --> B'
	},
	{ name: '8-element quoted chain', source: EIGHT_CHAIN },
	{ name: 'smart quotes + comma edge list', source: 'graph TD\n  A -->|“yes”, “no”| B' },
	{ name: 'sequenceDiagram prose with quoted pair', source: SEQUENCE_PROSE },
	{ name: 'init directive on missing-end graph', source: MISSING_END },
	{ name: 'C4 context argument lists', source: C4_CONTEXT },
	{ name: 'xychart data lists', source: XYCHART }
];

const VALID_SOURCES = [
	'graph TD\n  A --> B',
	'graph TD\n  A["plain label"] -->|"edge"| B["other"]',
	'sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi'
];

beforeAll(() => {
	const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
	// mermaid reads these globals at parse time (same pattern as mermaid.test.ts).
	Object.defineProperty(globalThis, 'window', {
		value: dom.window,
		configurable: true,
		writable: true
	});
	Object.defineProperty(globalThis, 'document', {
		value: dom.window.document,
		configurable: true,
		writable: true
	});
	Object.defineProperty(globalThis, 'navigator', {
		value: dom.window.navigator,
		configurable: true
	});
});

/** Parse `source` with the real mermaid parser; true iff it parses. */
async function parses(source: string): Promise<boolean> {
	const mermaid = (await import('mermaid')).default;
	mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
	try {
		await mermaid.parse(source);
		return true;
	} catch {
		return false;
	}
}

describe('repairMermaidSource', () => {
	it('spec example: original fails to parse, repaired output parses', async () => {
		const repaired = repairMermaidSource(SPEC_EXAMPLE);
		expect(await parses(SPEC_EXAMPLE)).toBe(false);
		expect(await parses(repaired)).toBe(true);
	});

	it('is idempotent over the corpus and every first-pass output: repair(repair(x)) === repair(x)', () => {
		for (const { name, source } of CORPUS) {
			const once = repairMermaidSource(source);
			// `once` is repair(x); requiring repair(once) === once asserts the
			// property on the input and closes it over the first-pass output.
			expect(repairMermaidSource(once), name).toBe(once);
		}
	});

	it('returns identity for already-valid sources', () => {
		for (const source of VALID_SOURCES) {
			expect(repairMermaidSource(source)).toBe(source);
		}
	});

	it('preserves the init directive on a missing-end graph (still unparseable)', async () => {
		expect(await parses(MISSING_END)).toBe(false);
		expect(repairMermaidSource(MISSING_END)).toBe(MISSING_END);
	});

	it('preserves valid C4 argument lists', () => {
		expect(repairMermaidSource(C4_CONTEXT)).toBe(C4_CONTEXT);
	});

	it('preserves valid xychart data lists', () => {
		expect(repairMermaidSource(XYCHART)).toBe(XYCHART);
	});

	it('preserves quoted prose in sequenceDiagram messages', () => {
		expect(repairMermaidSource(SEQUENCE_PROSE)).toBe(SEQUENCE_PROSE);
	});

	it('collapses an 8-element quoted chain to one quoted label in a single pass', async () => {
		expect(await parses(EIGHT_CHAIN)).toBe(false);
		const repaired = repairMermaidSource(EIGHT_CHAIN);
		expect(repaired).toBe('graph TD\n  A -->|"a, b, c, d, e, f, g, h"| B');
		expect(await parses(repaired)).toBe(true);
	});

	it('smart-quote case: typographic quotes normalized, repaired output parses', async () => {
		const source = CORPUS[1]!.source;
		const repaired = repairMermaidSource(source);
		expect(repaired).not.toMatch(/[“”‘’]/);
		expect(await parses(repaired)).toBe(true);
	});

	it('unquoted-reserved-char case: comma label wrapped in quotes, parses', async () => {
		const repaired = repairMermaidSource('graph TD\n  A[hello, world] --> B');
		expect(repaired).toContain('A["hello, world"]');
		expect(await parses(repaired)).toBe(true);
	});
});

describe('buildMermaidFixPrompt', () => {
	const source = SPEC_EXAMPLE;
	const reason = 'Parse error on line 2';

	it('contains the re-emit instruction', () => {
		const prompt = buildMermaidFixPrompt(source, reason);
		expect(prompt.toLowerCase()).toMatch(/only.*corrected/);
		expect(prompt).toMatch(/```mermaid/);
	});

	it('wraps the original source verbatim in a mermaid fence', () => {
		const prompt = buildMermaidFixPrompt(source, reason);
		expect(prompt).toContain('```mermaid\n' + source + '\n```');
	});

	it('contains the failure reason verbatim', () => {
		const prompt = buildMermaidFixPrompt(source, reason);
		expect(prompt).toContain(reason);
	});

	it('is deterministic: same input, same output', () => {
		expect(buildMermaidFixPrompt(source, reason)).toBe(buildMermaidFixPrompt(source, reason));
	});
});
