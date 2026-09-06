import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const COMPONENT = path.resolve(__dirname, 'PropagatedArtifact.svelte');
const MESSAGE_LIST = path.resolve(__dirname, 'MessageList.svelte');

describe('PropagatedArtifact wiring (020 T012/T014/T020)', () => {
	it('MessageList maps the branch_artifact durable case to PropagatedArtifact with store-backed handlers', () => {
		const source = fs.readFileSync(MESSAGE_LIST, 'utf-8');
		expect(source).toMatch(/item\.kind === 'branch_artifact'/);
		expect(source).toMatch(/<PropagatedArtifact\s*\n?\s*entry=\{item\.entry\}/);
		expect(source).toMatch(/onRegenerate=\{\(id\) => chatStore\.regenerateArtifact\(id\)\}/);
		expect(source).toMatch(/onDelete=\{\(id\) => chatStore\.deleteArtifact\(id\)\}/);
	});

	it('collapsed strip labels source + mode; derived anchor gated; payload expands; summary-gated Regenerate + Delete with confirm', () => {
		const source = fs.readFileSync(COMPONENT, 'utf-8');
		expect(source).toContain('Back-propagated from');
		expect(source).toMatch(/parseMetadata<BranchArtifactMetadata>/);
		expect(source).toMatch(/anchor === 'derived'/);
		expect(source).toMatch(/whitespace-pre-wrap/);
		// US3: Regenerate renders only for summary mode (FR-007); Delete always
		// available behind a confirm step; both wired to parent callbacks.
		expect(source).toMatch(/mode === 'summary' && onRegenerate/);
		expect(source).toMatch(/confirm\(/);
		expect(source).toMatch(/onRegenerate\?\.\(entry\.id\)/);
		expect(source).toMatch(/onDelete\?\.\(entry\.id\)/);
	});
});
