import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const GROWTH_EDGE = path.resolve(__dirname, 'GrowthEdge.svelte');
const ASSISTANT = path.resolve(__dirname, 'rows/AssistantMessage.svelte');

describe('GrowthEdge source contract', () => {
	const source = fs.readFileSync(GROWTH_EDGE, 'utf-8');

	it('never intercepts pointers — text selection stays native', () => {
		expect(source).toMatch(/pointer-events:\s*none|pointer-events-none/);
	});

	it('sits on the in-content overlay rung of the z-ladder', () => {
		expect(source).toContain('z-10');
	});

	it('reports render counts for the perf probe', () => {
		expect(source).toContain("incRender('GrowthEdge')");
	});

	it('honors reduced motion on its lift transition', () => {
		expect(source).toMatch(
			/motion-reduce:transition-none|prefers-reduced-motion|reducedMotion|motionSafe/
		);
	});
});

describe('GrowthEdge mounting contract', () => {
	const source = fs.readFileSync(ASSISTANT, 'utf-8');

	it('mounts GrowthEdge only in the live branch, never in the durable branch', () => {
		const durableStart = source.indexOf('{:else if isDurable}');
		const liveStart = source.indexOf('{:else}', durableStart);
		expect(durableStart, 'durable branch marker not found').toBeGreaterThan(-1);
		expect(liveStart, 'live branch marker not found').toBeGreaterThan(-1);
		expect(source.slice(durableStart, liveStart)).not.toContain('<GrowthEdge');
		expect(source.slice(liveStart)).toContain('<GrowthEdge');
	});

	it('passes the contract props (variant, buffer, lifting)', () => {
		const tag = source.match(/<GrowthEdge[\s\S]*?\/>/);
		expect(tag, 'GrowthEdge tag not found').not.toBeNull();
		expect(tag![0]).toContain('variant=');
		expect(tag![0]).toContain('buffer=');
		expect(tag![0]).toContain('lifting=');
	});
});
