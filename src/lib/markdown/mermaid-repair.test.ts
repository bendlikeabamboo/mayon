/**
 * Corpus tests for repairMermaidSource (spec 028 US2): a pure, deterministic,
 * idempotent repair pass for common model-produced mermaid syntax faults.
 * Parseability claims are verified against the real mermaid parser, not
 * string-shape assertions.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { repairMermaidSource } from './mermaid-repair.js';

// Canonical broken diagram from specs/028-mermaid-error-repair (spec.md):
// comma-separated quoted-string list inside an edge label — unparseable.
const SPEC_EXAMPLE = 'graph TD\n  A["waking"] -->|"sad", "SAD", "sleepy", "del"| B["tring"]';

const CORPUS = [
	{ name: 'spec example', source: SPEC_EXAMPLE },
	{ name: 'smart quotes in label', source: 'graph TD\n  A["it’s “waking” now"] --> B' },
	{ name: 'embedded quotes in label', source: 'graph TD\n  A["the "best" thing"] --> B' },
	{ name: 'unquoted comma label', source: 'graph TD\n  A[hello, world] --> B' }
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

	it('is idempotent for every corpus entry: repair(repair(x)) === repair(x)', () => {
		for (const { name, source } of CORPUS) {
			const once = repairMermaidSource(source);
			expect(repairMermaidSource(once), name).toBe(once);
		}
	});

	it('returns identity for already-valid sources', () => {
		for (const source of VALID_SOURCES) {
			expect(repairMermaidSource(source)).toBe(source);
		}
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
