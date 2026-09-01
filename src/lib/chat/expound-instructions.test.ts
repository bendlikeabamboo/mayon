import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useFileTestDb } from '$lib/db/driver/pg-test';
import {
	DEFAULT_EXPOUND_INSTRUCTIONS,
	getExpoundInstructions,
	sanitizeInstructions,
	saveExpoundInstructions,
	validateInstruction,
	type ExpoundInstruction
} from './expound-instructions';

const testDb = useFileTestDb();
beforeAll(() => testDb.setup());
beforeEach(() => testDb.reset());
afterAll(() => testDb.teardown());

describe('DEFAULT_EXPOUND_INSTRUCTIONS', () => {
	it('contains exactly the five built-ins in order', () => {
		expect(DEFAULT_EXPOUND_INSTRUCTIONS).toEqual([
			{ id: 'diagrams', name: 'Diagrams (prompt diagrams)', builtin: true },
			{ id: 'tables', name: 'Comparison Tables', builtin: true },
			{ id: 'code', name: 'Code Examples', builtin: true },
			{
				id: 'mermaid-diagram',
				name: 'Mermaid Diagram',
				description: 'Render flows and relationships as fenced Mermaid code blocks',
				builtin: true
			},
			{
				id: 'focus-callouts',
				name: 'Focus Callouts',
				description: 'Emphasize key takeaways with callout blocks',
				builtin: true
			}
		]);
	});
});

describe('sanitizeInstructions', () => {
	it('falls back to defaults on null', () => {
		expect(sanitizeInstructions(null)).toEqual([...DEFAULT_EXPOUND_INSTRUCTIONS]);
	});

	it('falls back to defaults on undefined', () => {
		expect(sanitizeInstructions(undefined)).toEqual([...DEFAULT_EXPOUND_INSTRUCTIONS]);
	});

	it('falls back to defaults on a non-array string', () => {
		expect(sanitizeInstructions('not json')).toEqual([...DEFAULT_EXPOUND_INSTRUCTIONS]);
	});

	it('falls back to defaults on a non-array object', () => {
		expect(sanitizeInstructions({ id: 'diagrams' })).toEqual([...DEFAULT_EXPOUND_INSTRUCTIONS]);
	});

	it('falls back to defaults on an empty array', () => {
		expect(sanitizeInstructions([])).toEqual([...DEFAULT_EXPOUND_INSTRUCTIONS]);
	});

	it('drops only invalid elements', () => {
		const raw = [
			{ id: 'ok-1', name: 'Analogies', description: 'Ground ideas in the familiar' },
			42,
			null,
			{ id: '', name: 'no id' },
			{ id: 'ok-2', name: '   ' },
			{ id: 'ok-3', name: 'a'.repeat(61) },
			{ id: 'ok-4', name: 'Too long description', description: 'd'.repeat(201) },
			{ id: 'ok-5', name: 'Bad builtin', builtin: 'yes' },
			{ id: 'ok-6', name: 'Kept' }
		];
		expect(sanitizeInstructions(raw)).toEqual([
			{ id: 'ok-1', name: 'Analogies', description: 'Ground ideas in the familiar' },
			{ id: 'ok-6', name: 'Kept' }
		]);
	});

	it('passes a valid custom list through', () => {
		const custom = [
			{ id: 'a', name: 'Analogies' },
			{
				id: 'b',
				name: 'Mermaid Diagram',
				description: 'Render flows and relationships as Mermaid diagrams',
				builtin: true
			}
		];
		expect(sanitizeInstructions(custom)).toEqual(custom);
	});
});

describe('validateInstruction', () => {
	const list: ExpoundInstruction[] = [
		{ id: 'diagrams', name: 'Diagrams (prompt diagrams)', builtin: true },
		{ id: 'mine', name: 'Real-world Analogies' }
	];

	it('rejects a blank name', () => {
		expect(validateInstruction(list, { name: '   ' })).toContain('Name');
	});

	it('rejects a duplicate name case-insensitively', () => {
		expect(validateInstruction(list, { name: 'real-world analogies' })).toContain('already exists');
	});

	it('rejects a name longer than 60 chars', () => {
		expect(validateInstruction(list, { name: 'a'.repeat(61) })).toContain('60');
	});

	it('rejects a description longer than 200 chars', () => {
		expect(validateInstruction(list, { name: 'Fresh', description: 'd'.repeat(201) })).toContain(
			'200'
		);
	});

	it('accepts a valid draft', () => {
		expect(validateInstruction(list, { name: 'Metaphors', description: 'Mixing metaphors' })).toBe(
			null
		);
	});

	it('accepts a name matching its own entry when ignoreId is set', () => {
		expect(validateInstruction(list, { name: 'Real-world Analogies' }, 'mine')).toBe(null);
	});
});

describe('expoundInstructions settings round-trip', () => {
	it('save then read round-trips a custom list', async () => {
		const custom: ExpoundInstruction[] = [
			{ id: 'a', name: 'Real-world Analogies', description: 'Ground ideas in the familiar' },
			{ id: 'b', name: 'Mermaid Diagram', builtin: true }
		];
		await saveExpoundInstructions(custom);
		expect(await getExpoundInstructions()).toEqual(custom);
	});

	it('read falls back to defaults when the key is absent', async () => {
		expect(await getExpoundInstructions()).toEqual([...DEFAULT_EXPOUND_INSTRUCTIONS]);
	});
});
