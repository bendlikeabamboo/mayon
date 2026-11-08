/**
 * renderMermaidBlock seam tests (spec 028): US1 failure containment (reject
 * without mermaid injecting its "Syntax error" SVG into document.body — the
 * page-scroll + bottom-banner bug) and US2 one-pass repair at the seam.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderMermaidBlock } from './mermaid.js';

// Canonical broken diagram from specs/028-mermaid-error-repair (spec.md):
// edge label contains a comma-separated quoted-string list — unparseable
// as-is, but repairable by the seam's one repair pass.
const BROKEN_SOURCE = 'graph TD\n  A["waking"] -->|"sad", "SAD", "sleepy", "del"| B["tring"]';

// Unterminated edge: no repair rule applies (identity), so the seam must
// still reject — keeps the US1 containment regression meaningful now that
// repairable sources resolve.
const UNREPAIRABLE_SOURCE = 'graph TD\n  A -->';

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
	// jsdom lacks SVGElement.getBBox; mermaid's layout needs it. A fixed-size
	// stub is enough — layout metrics don't affect the render's validity.
	Object.assign(dom.window.SVGElement.prototype, {
		getBBox: () => ({ x: 0, y: 0, width: 100, height: 20 })
	});
	// mermaid's render success path builds SVG styles via CSSStyleSheet
	// (only the failure path was exercised before US2's repaired renders).
	Object.defineProperty(globalThis, 'CSSStyleSheet', {
		value: dom.window.CSSStyleSheet,
		configurable: true,
		writable: true
	});
});

describe('renderMermaidBlock', () => {
	it('rejects on unrepairable source without appending anything to document.body', async () => {
		const before = document.body.childElementCount;
		let err: unknown;
		try {
			await renderMermaidBlock(UNREPAIRABLE_SOURCE);
		} catch (e) {
			err = e;
		}
		expect(err).toBeDefined();
		// Regression: mermaid's error SVG must never land in document.body.
		expect(document.body.childElementCount).toBe(before);
		expect(document.body.children.length).toBe(before);
	});

	it('resolves with repaired: true for the repairable spec example, body untouched', async () => {
		const before = document.body.childElementCount;
		const result = await renderMermaidBlock(BROKEN_SOURCE);
		expect(result.repaired).toBe(true);
		expect(result.svg).toContain('<svg');
		expect(document.body.childElementCount).toBe(before);
	});

	it('resolves with repaired: false for an already-valid source', async () => {
		const result = await renderMermaidBlock('graph TD\n  A --> B');
		expect(result.repaired).toBe(false);
		expect(result.svg).toContain('<svg');
	});
});
