import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Section jump orchestration contracts (017)', () => {
	const source = fs.readFileSync(path.resolve(__dirname, '+page.svelte'), 'utf-8');

	it('anchors filter headings inside blockquotes/callouts to match extraction exclusions', () => {
		expect(source).toContain("h.closest('blockquote, .callout')");
	});

	it('a section jump releases stick suppression on the next user turn', () => {
		const send = source.slice(source.indexOf('async function onSend'));
		expect(send).toContain('scrolledToHash = false');
	});

	it('the landing flash timer is cleared on teardown', () => {
		const cleanup = source.slice(source.indexOf('return () => {'));
		expect(cleanup).toContain('clearTimeout(sectionFlashTimer)');
	});
});
