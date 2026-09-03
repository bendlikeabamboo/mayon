import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ASSISTANT = path.resolve(__dirname, 'AssistantMessage.svelte');
const MESSAGE_LIST = path.resolve(__dirname, '../MessageList.svelte');

describe('Refinement: AssistantMessage strip registry integration contract', () => {
	const source = fs.readFileSync(ASSISTANT, 'utf-8');
	const list = fs.readFileSync(MESSAGE_LIST, 'utf-8');

	it('no longer imports or renders the in-message SectionStrip', () => {
		expect(source).not.toContain('SectionStrip');
	});

	it('drops the onJumpToSection and stripEnabled props entirely', () => {
		expect(source).not.toContain('onJumpToSection');
		expect(source).not.toMatch(/stripEnabled\?:/);
		expect(source).not.toMatch(/props as DurableProps\)\.stripEnabled/);
		expect(list).not.toContain('onJumpToSection');
		expect(list).not.toContain('stripEnabled');
	});

	it('consumes the wave-6 registry and flag from context instead of props', () => {
		expect(source).toContain("from '$lib/chat/strip/registry.svelte'");
		expect(source).toContain('getStripRegistry()');
		expect(source).toContain('getStripContext()');
	});

	it('derives the strip flag reactively through the getter-backed context value', () => {
		expect(source).toMatch(
			/stripPrefOn = \$derived\(isDurable && stripContext[\s\S]*stripEnabled\)/
		);
	});

	it('registers { msgId, el: bodyEl, sections } when eligible; unregisters otherwise', () => {
		expect(source).toContain('register({ msgId: entry.id, el: bodyEl, sections })');
		expect(source).toContain('unregister(entry.id)');
		expect(source).toContain('isDurable && stripEligible');
	});

	it('bumps the registry when the message body resizes', () => {
		expect(source).toContain('bump(entry!.id)');
	});

	it('unregisters on unmount via effect cleanup', () => {
		expect(source).toMatch(/return \(\) => \{\s*if \(entry\) reg\.unregister\(entry\.id\);\s*\};/);
	});

	it('keeps eligibility measurement unchanged', () => {
		expect(source).toContain("from '$lib/markdown/sections'");
		expect(source).toContain('extractSections(visible)');
		expect(source).toContain('isStripCandidate(sections)');
		expect(source).toContain('new ResizeObserver');
		expect(source).toContain("closest<HTMLElement>('.overflow-y-auto')");
		expect(source).toContain('offsetHeight');
		expect(source).toContain('clientHeight');
		expect(source).toContain('return () => ro.disconnect()');
	});

	it('still derives sections for durable entries only', () => {
		expect(source).toContain('isDurable ? extractSections(visible) : []');
	});
});
