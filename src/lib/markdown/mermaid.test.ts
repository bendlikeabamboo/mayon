/**
 * Failure-containment regression for renderMermaidBlock (US1, spec 028):
 * a failed render must reject WITHOUT mermaid injecting its "Syntax error"
 * SVG into document.body (the page-scroll + bottom-banner bug).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderMermaidBlock } from './mermaid.js';

// Canonical broken diagram from specs/028-mermaid-error-repair (spec.md):
// edge label contains embedded double quotes and commas — unparseable.
const BROKEN_SOURCE = 'graph TD\n  A["waking"] -->|"sad", "SAD", "sleepy", "del"| B["tring"]';

beforeAll(() => {
	const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
	// mermaid (and d3/dompurify inside it) read these globals at render time.
	// Node 22 already defines `navigator`, so replace it explicitly.
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

describe('renderMermaidBlock failure containment', () => {
	it('rejects on unparseable source without appending anything to document.body', async () => {
		const before = document.body.childElementCount;
		let err: unknown;
		try {
			await renderMermaidBlock(BROKEN_SOURCE);
		} catch (e) {
			err = e;
		}
		expect(err).toBeDefined();
		// Regression: mermaid's error SVG must never land in document.body.
		expect(document.body.childElementCount).toBe(before);
		expect(document.body.children.length).toBe(before);
	});
});
