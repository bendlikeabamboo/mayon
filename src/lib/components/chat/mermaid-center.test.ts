import { describe, expect, it } from 'vitest';
import { computeCenter } from './mermaid-center';

describe('computeCenter', () => {
	it('centers a small SVG inside a large viewport', () => {
		const result = computeCenter({ w: 1000, h: 800 }, { w: 400, h: 300 });
		expect(result).toEqual({ x: 300, y: 250 });
	});

	it('returns negative offsets when SVG is larger than viewport', () => {
		const result = computeCenter({ w: 200, h: 200 }, { w: 800, h: 600 });
		expect(result).toEqual({ x: -300, y: -200 });
	});

	it('returns zero offset when SVG equals viewport size', () => {
		const result = computeCenter({ w: 500, h: 500 }, { w: 500, h: 500 });
		expect(result).toEqual({ x: 0, y: 0 });
	});

	it('centers a square SVG inside a square viewport', () => {
		const result = computeCenter({ w: 100, h: 100 }, { w: 50, h: 50 });
		expect(result).toEqual({ x: 25, y: 25 });
	});

	it('does not mutate input objects', () => {
		const viewport = { w: 1000, h: 800 };
		const svg = { w: 400, h: 300 };
		const frozenVp = Object.freeze({ ...viewport });
		const frozenSvg = Object.freeze({ ...svg });
		computeCenter(frozenVp, frozenSvg);
		expect(frozenVp).toEqual({ w: 1000, h: 800 });
		expect(frozenSvg).toEqual({ w: 400, h: 300 });
	});
});
