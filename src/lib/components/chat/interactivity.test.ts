import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const COMPOSER = path.resolve(__dirname, 'Composer.svelte');
const CHOICES_OFFER = path.resolve(__dirname, 'rows', 'ChoicesOffer.svelte');
const MESSAGE_LIST = path.resolve(__dirname, 'MessageList.svelte');

describe('FR-006/FR-007 interactivity regression (004 T014)', () => {
	it('Composer source must NOT contain suggestion-chip rendering (no suggestedReplies)', () => {
		const source = fs.readFileSync(COMPOSER, 'utf-8');
		expect(source).not.toMatch(/suggestedReplies/);
	});

	it('Composer source must NOT contain gate progress prop', () => {
		const source = fs.readFileSync(COMPOSER, 'utf-8');
		expect(source).not.toMatch(/progress\?:/);
	});

	it('ChoicesOffer must accept an onSelect prop and wire option buttons to it', () => {
		const source = fs.readFileSync(CHOICES_OFFER, 'utf-8');
		expect(source).toMatch(/onSelect\?/);
		expect(source).toMatch(/onclick.*onSelect/);
	});

	it('MessageList must derive active gate via findGateFromMessages and pass onSelect to ChoicesOffer', () => {
		const source = fs.readFileSync(MESSAGE_LIST, 'utf-8');
		expect(source).toMatch(/findGateFromMessages/);
		expect(source).toMatch(/activeGate/);
		expect(source).toMatch(/onSelect/);
	});
});
