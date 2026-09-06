import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BRIEF_PROMPT } from './generate-brief';
import { GRADE_TOOL_DESCRIPTION, QUIZ_CONTRACT } from './generate-quiz';
import { LAB_CONTRACT } from './generate';

// The markers module is plain ESM under tests/ (outside this package's TS
// include), so it is loaded dynamically by file URL — still the single source
// of truth that server.mjs imports; no copies are made here.
const markers = await import(
	fileURLToPath(new URL('../../../../tests/fixtures/mock-llm/markers.mjs', import.meta.url))
);
const { BRIEF_MARKER, GRADING_MARKER, LAB_CONTRACT_MARKER, QUIZ_CONTRACT_MARKER } = markers;

/**
 * Classification-marker drift guard (feature 020 review follow-up).
 *
 * The e2e mock (tests/fixtures/mock-llm/server.mjs) classifies request kinds
 * by the markers in tests/fixtures/mock-llm/markers.mjs. Those markers point
 * at bytes inside these code-owned product constants — so when a prompt or
 * tool description is reworded, THIS suite fails at the exact byte that
 * changed, instead of the whole e2e deck failing with unrecognized-request
 * 400s far from the cause. If you are here because this test failed: update
 * the marker in markers.mjs together with the product constant, in the same
 * commit.
 */
describe('mock-llm classification markers stay pinned to product constants', () => {
	it('quiz contract leads with its opening line and contains its output-shape marker', () => {
		expect(QUIZ_CONTRACT.startsWith('You are a quiz designer.')).toBe(true);
		expect(QUIZ_CONTRACT).toContain(QUIZ_CONTRACT_MARKER);
	});

	it('lab contract leads with its opening line and contains its output-shape marker', () => {
		expect(LAB_CONTRACT.startsWith('You are a learning lab designer.')).toBe(true);
		expect(LAB_CONTRACT).toContain(LAB_CONTRACT_MARKER);
	});

	it('grading tool description contains the grading marker', () => {
		expect(GRADE_TOOL_DESCRIPTION).toContain(GRADING_MARKER);
	});

	it('brief prompt leads with the brief marker', () => {
		expect(DEFAULT_BRIEF_PROMPT.startsWith(BRIEF_MARKER)).toBe(true);
	});

	it('markers are mutually distinctive across the code-owned constants', () => {
		// No marker may appear in a constant that belongs to a DIFFERENT kind,
		// so classification order can never be shadowed by code-owned bytes.
		expect(QUIZ_CONTRACT).not.toContain(LAB_CONTRACT_MARKER);
		expect(QUIZ_CONTRACT).not.toContain(BRIEF_MARKER);
		expect(LAB_CONTRACT).not.toContain(QUIZ_CONTRACT_MARKER);
		expect(LAB_CONTRACT).not.toContain(BRIEF_MARKER);
		expect(GRADE_TOOL_DESCRIPTION).not.toContain(QUIZ_CONTRACT_MARKER);
		expect(GRADE_TOOL_DESCRIPTION).not.toContain(LAB_CONTRACT_MARKER);
		expect(GRADE_TOOL_DESCRIPTION).not.toContain(BRIEF_MARKER);
		expect(DEFAULT_BRIEF_PROMPT).not.toContain(QUIZ_CONTRACT_MARKER);
		expect(DEFAULT_BRIEF_PROMPT).not.toContain(LAB_CONTRACT_MARKER);
	});
});
