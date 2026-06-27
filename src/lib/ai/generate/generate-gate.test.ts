import { describe, expect, it } from 'vitest';
import { extractGateBlock, stripGateFence } from './generate-gate';

describe('extractGateBlock', () => {
	it('parses a trailing ```gate fenced block', () => {
		const raw =
			'Here is the unit content.\n\n```gate\n{"nextUnit":"Loops","options":["continue","go deeper"],"progress":"Unit 2 / 5"}\n```';
		const gate = extractGateBlock(raw);
		expect(gate).toEqual({
			nextUnit: 'Loops',
			options: ['continue', 'go deeper'],
			progress: 'Unit 2 / 5'
		});
	});

	it('returns null when no gate fence present', () => {
		const raw = 'Just some regular text with no fence.';
		expect(extractGateBlock(raw)).toBeNull();
	});

	it('returns null on malformed JSON inside gate fence', () => {
		const raw = 'Content\n\n```gate\n{not valid json}\n```';
		expect(extractGateBlock(raw)).toBeNull();
	});

	it('returns null on schema mismatch (missing fields)', () => {
		const raw = 'Content\n\n```gate\n{"nextUnit":"Title"}\n```';
		expect(extractGateBlock(raw)).toBeNull();
	});

	it('ignores a normal ```json block', () => {
		const raw = 'Content\n\n```json\n{"data": 123}\n```';
		expect(extractGateBlock(raw)).toBeNull();
	});

	it('returns null on unknown tag', () => {
		const raw = 'Content\n\n```yaml\nkey: value\n```';
		expect(extractGateBlock(raw)).toBeNull();
	});
});

describe('stripGateFence', () => {
	it('returns prose prefix before the gate fence', () => {
		const raw =
			'Here is the unit content.\n\n```gate\n{"nextUnit":"Loops","options":["continue","go deeper"],"progress":"Unit 2 / 5"}\n```';
		expect(stripGateFence(raw)).toBe('Here is the unit content.');
	});

	it('is a no-op when no gate fence present', () => {
		const raw = 'Just some regular text.';
		expect(stripGateFence(raw)).toBe('Just some regular text.');
	});

	it('preserves a normal ```json code block', () => {
		const raw = 'Look at this:\n\n```json\n{"x": 1}\n```\nMore text.';
		expect(stripGateFence(raw)).toBe(raw);
	});

	it('strips at the first ```gate occurrence only', () => {
		const raw =
			'Content before.\n\n```gate\n{"nextUnit":"A","options":[],"progress":"1/3"}\n```\nExtra after.';
		expect(stripGateFence(raw)).toBe('Content before.');
	});
});
