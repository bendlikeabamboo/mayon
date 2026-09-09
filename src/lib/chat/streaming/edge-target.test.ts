import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { resolveEdgeTarget } from './edge-target';

function setup(html: string): HTMLElement {
	const dom = new JSDOM(`<!DOCTYPE html><div id="root">${html}</div>`);
	return dom.window.document.getElementById('root')!;
}

describe('resolveEdgeTarget (jsdom)', () => {
	it('classifies a prose tail as normal and returns a rect descriptor', () => {
		const target = resolveEdgeTarget(setup('<p>Hello world <strong>tail</strong></p>'));
		expect(target.effect).toBe('normal');
		expect(target.rect).not.toBeNull();
		expect(Number.isFinite(target.rect!.top)).toBe(true);
		expect(Number.isFinite(target.rect!.left)).toBe(true);
	});

	it('suppresses the effect when the tail is a pre/code block', () => {
		const target = resolveEdgeTarget(setup('<p>before</p><pre><code>const x = 1;</code></pre>'));
		expect(target.effect).toBe('suppressed');
	});

	it('suppresses the effect when the tail is a table', () => {
		const target = resolveEdgeTarget(setup('<table><tbody><tr><td>cell</td></tr></tbody></table>'));
		expect(target.effect).toBe('suppressed');
	});

	it('softens the effect when the tail is a list item', () => {
		const target = resolveEdgeTarget(setup('<ul><li>one</li><li>two</li></ul>'));
		expect(target.effect).toBe('soften');
		expect(target.rect).not.toBeNull();
	});

	it('hides with no rect when the container has no text target', () => {
		const target = resolveEdgeTarget(setup(''));
		expect(target.effect).toBe('hidden');
		expect(target.rect).toBeNull();
	});
});
