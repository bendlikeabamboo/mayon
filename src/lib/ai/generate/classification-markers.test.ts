import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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

// Same mechanic for the fixture-only assertion strings (feature 031) plus the
// source text of the two consumers the drift guard patrols.
const strings = await import(
	fileURLToPath(new URL('../../../../tests/fixtures/mock-llm/strings.mjs', import.meta.url))
);
const serverSource = readFileSync(
	fileURLToPath(new URL('../../../../tests/fixtures/mock-llm/server.mjs', import.meta.url)),
	'utf8'
);
const kitchenSinkSource = readFileSync(
	fileURLToPath(new URL('../../../../tests/e2e/fixtures/kitchen-sink.ts', import.meta.url)),
	'utf8'
);

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

/**
 * Fixture-string drift guard (feature 031, contract
 * specs/031-split-text-e2e-tests/contracts/shared-fixtures.md).
 *
 * The fixture-only assertion strings (grading lever, back-propagation
 * dispatch, image reply) live once in tests/fixtures/mock-llm/strings.mjs;
 * server.mjs serves exactly those constants and
 * tests/e2e/fixtures/kitchen-sink.ts re-exports them for e2e specs. If you
 * are here because this test failed: a served string was re-typed inline in
 * server.mjs or hand-mirrored in kitchen-sink.ts — delete the copy and import
 * (or re-export) the constant instead, so a fixture text change moves both
 * test tiers atomically.
 */
describe('mock-llm fixture strings stay single-sourced', () => {
	it('server.mjs serves the shared strings — no inline copy of any constant value', () => {
		expect(serverSource).toContain("from './strings.mjs'");
		for (const [name, value] of Object.entries(strings)) {
			expect(serverSource, `${name} must be referenced by server.mjs`).toContain(name);
			expect(serverSource, `${name} must not be re-typed inline in server.mjs`).not.toContain(
				value
			);
		}
	});

	it('kitchen-sink.ts re-exports the shared strings without hand-mirroring them', () => {
		expect(kitchenSinkSource).toContain("from '../../fixtures/mock-llm/strings.mjs'");
		for (const [name, value] of Object.entries(strings)) {
			expect(kitchenSinkSource).not.toMatch(new RegExp(`export const ${name}\\s*=\\s*['"\`]`));
			expect(
				kitchenSinkSource,
				`${name} must not be hand-mirrored in kitchen-sink.ts`
			).not.toContain(value);
		}
	});
});
