import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// T021 (specs/018 FR-006): the composer paperclip renders iff
// `supportsVision(activeConfig, activeModelId)` — derived on this page from
// the active provider snapshot and passed down as a prop, exactly like the
// `supportsDeep` precedent. Paste-with-image is intentionally NOT gated
// (contract §3, FR-007 permissive posture).
describe('T021: composer paperclip vision gate (specs/018 FR-006)', () => {
	const source = fs.readFileSync(path.resolve(__dirname, '+page.svelte'), 'utf-8');

	it('derives the vision gate from the active config/model via supportsVision', () => {
		expect(source).toContain('supportsVision(activeConfig, activeModelId)');
		expect(source).toContain("import { supportsVision } from '$lib/ai/vision-capability'");
	});

	it('passes the gate to the Composer as a prop alongside supportsDeep', () => {
		expect(source).toContain('supportsVision={supportsVisionModel}');
		expect(source.indexOf('supportsVision={supportsVisionModel}')).toBeGreaterThan(
			source.indexOf('<Composer')
		);
	});
});
