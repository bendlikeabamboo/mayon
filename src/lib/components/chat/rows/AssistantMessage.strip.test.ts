import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ASSISTANT = path.resolve(__dirname, 'AssistantMessage.svelte');
const MESSAGE_LIST = path.resolve(__dirname, '../MessageList.svelte');

describe('US1: AssistantMessage strip integration contract', () => {
	const source = fs.readFileSync(ASSISTANT, 'utf-8');
	const list = fs.readFileSync(MESSAGE_LIST, 'utf-8');

	it('renders the strip only on the durable branch — never on the streaming live tail', () => {
		expect(source).toContain('<SectionStrip');
		expect(source).toMatch(/\{#if isDurable && stripEligible\}/);
	});

	it('derives sections from the displayed reply markdown via the shared extractor', () => {
		expect(source).toContain("from '$lib/markdown/sections'");
		expect(source).toContain('extractSections');
		expect(source).toContain('extractSections(visible)');
	});

	it('gates eligibility on section count AND a body-vs-viewport height measurement', () => {
		expect(source).toContain('isStripCandidate(sections)');
		expect(source).toContain('new ResizeObserver');
		expect(source).toContain("closest<HTMLElement>('.overflow-y-auto')");
		expect(source).toContain('offsetHeight');
		expect(source).toContain('clientHeight');
	});

	it('disconnects the ResizeObserver on teardown', () => {
		expect(source).toContain('return () => ro.disconnect()');
	});

	it('threads an optional onJumpToSection callback through MessageList', () => {
		expect(source).toMatch(/onJumpToSection\?: \(msgId: string, index: number\) => void/);
		expect(source).toContain('onJumpToSection?.(');
		expect(list).toContain('onJumpToSection?:');
		expect(list).toContain('{onJumpToSection}');
	});
});
