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

	it('parses a trailing bare JSON gate object without fence', () => {
		const raw =
			'Here is the unit content.\n\n{\n  "nextUnit": "Loops",\n  "options": ["continue", "go deeper"],\n  "progress": "Unit 2 / 5"\n}';
		const gate = extractGateBlock(raw);
		expect(gate).toEqual({
			nextUnit: 'Loops',
			options: ['continue', 'go deeper'],
			progress: 'Unit 2 / 5'
		});
	});

	it('returns null when trailing bare JSON lacks required fields', () => {
		const raw = 'Content\n\n{"nextUnit": "Title", "options": []}';
		expect(extractGateBlock(raw)).toBeNull();
	});

	it('prefers fenced gate over trailing bare JSON', () => {
		const raw =
			'Content.\n\n```gate\n{"nextUnit":"A","options":["continue"],"progress":"1/2"}\n```';
		expect(extractGateBlock(raw)).toEqual({
			nextUnit: 'A',
			options: ['continue'],
			progress: '1/2'
		});
	});

	it('parses a ```json fenced block containing gate-shaped JSON', () => {
		const raw =
			'Here is the unit content.\n\n```json\n{"nextUnit":"Loops","options":["continue","go deeper"],"progress":"Unit 2 / 5"}\n```';
		expect(extractGateBlock(raw)).toEqual({
			nextUnit: 'Loops',
			options: ['continue', 'go deeper'],
			progress: 'Unit 2 / 5'
		});
	});

	it('does not confuse a normal ```json block that lacks gate fields', () => {
		const raw = 'Look at this:\n\n```json\n{"data": 123}\n```';
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

	it('strips trailing bare JSON gate object when no fence present', () => {
		const raw =
			'Here is the unit content.\n\n{\n  "nextUnit": "Loops",\n  "options": ["continue", "go deeper"],\n  "progress": "Unit 2 / 5"\n}';
		expect(stripGateFence(raw)).toBe('Here is the unit content.');
	});

	it('preserves normal JSON blocks that are not gate-shaped', () => {
		const raw = 'Look at this:\n\n{"x": 1}\nMore text.';
		expect(stripGateFence(raw)).toBe(raw);
	});

	it('prefers fenced gate strip over bare JSON fallback', () => {
		const raw = 'Content.\n\n```gate\n{"nextUnit":"A","options":[],"progress":"1/2"}\n```';
		expect(stripGateFence(raw)).toBe('Content.');
	});

	it('strips a ```json fenced block containing gate-shaped JSON', () => {
		const raw =
			'Here is the unit content.\n\n```json\n{"nextUnit":"Loops","options":["continue","go deeper"],"progress":"Unit 2 / 5"}\n```';
		expect(stripGateFence(raw)).toBe('Here is the unit content.');
	});

	it('preserves a normal ```json block that lacks gate fields', () => {
		const raw = 'Look at this:\n\n```json\n{"data": 123}\n```';
		expect(stripGateFence(raw)).toBe(raw);
	});
});
