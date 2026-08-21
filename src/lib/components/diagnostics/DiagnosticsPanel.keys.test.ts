import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PANEL = path.resolve(__dirname, 'DiagnosticsPanel.svelte');

/**
 * Extract every keyed `{#each ...}` clause from the panel source.
 * Returns [collection expression, index var (or null), key expression].
 */
function keyedEachClauses(
	source: string
): Array<{ each: string; indexVar: string | null; key: string }> {
	const clauses: Array<{ each: string; indexVar: string | null; key: string }> = [];
	const re = /\{#each\s+(.+?)\s+as\s+([^\s(]+)(?:\s*,\s*([^\s(]+))?\s*\(([^)]*)\)\s*\}/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(source)) !== null) {
		clauses.push({ each: m[1].trim(), indexVar: m[3] ? m[3] : null, key: m[4] });
	}
	return clauses;
}

describe('US1: DiagnosticsPanel keyed loops survive repeated events', () => {
	const source = fs.readFileSync(PANEL, 'utf-8');

	it('MCP events key is position-qualified (repeated kind+server events do not collide)', () => {
		const mcp = keyedEachClauses(source).filter((c) => c.each.endsWith('.mcpEvents'));
		expect(mcp.length).toBeGreaterThan(0);
		for (const clause of mcp) {
			expect(clause.indexVar, 'mcpEvents loop must declare an index variable').not.toBeNull();
			expect(
				clause.key.includes(clause.indexVar as string),
				`mcpEvents key "${clause.key}" must include the loop position ${clause.indexVar}`
			).toBe(true);
		}
	});

	it('liveParts key is position-qualified (run-length merge does not dedupe non-adjacent types)', () => {
		const live = keyedEachClauses(source).filter((c) => c.each === 'liveParts');
		expect(live.length).toBeGreaterThan(0);
		for (const clause of live) {
			expect(clause.indexVar, 'liveParts loop must declare an index variable').not.toBeNull();
			expect(clause.key.includes(clause.indexVar as string)).toBe(true);
		}
	});

	it('partSequence key is position-qualified (part types repeat across a sequence)', () => {
		const seq = keyedEachClauses(source).filter((c) => c.each.endsWith('.partSequence'));
		expect(seq.length).toBeGreaterThan(0);
		for (const clause of seq) {
			expect(clause.indexVar, 'partSequence loop must declare an index variable').not.toBeNull();
			expect(clause.key.includes(clause.indexVar as string)).toBe(true);
		}
	});
});
