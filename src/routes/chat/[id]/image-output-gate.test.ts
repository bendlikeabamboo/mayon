import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// T017 (specs/030): the image-output indication derives on this page from
// `supportsImageOutput(activeConfig, activeModelId)` and passes down to the
// Composer exactly like the `supportsVisionModel` precedent (018 FR-006).
// Advisory only — the flag must never gate, block, strip, or rewrite any
// request payload (contract guarantee 1).
describe('T017: image-output chat-surface indication (specs/030)', () => {
	const source = fs.readFileSync(path.resolve(__dirname, '+page.svelte'), 'utf-8');

	it('derives the indication from the active config/model via supportsImageOutput', () => {
		expect(source).toContain('supportsImageOutput(activeConfig, activeModelId)');
		expect(source).toContain(
			"import { supportsImageOutput } from '#lib/ai/image-output-capability.js'"
		);
	});

	it('passes the indication to the Composer alongside the vision gate', () => {
		expect(source).toContain('supportsImageOutput={supportsImageOutputModel}');
		expect(source.indexOf('supportsImageOutput={supportsImageOutputModel}')).toBeGreaterThan(
			source.indexOf('<Composer')
		);
	});
});
