import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ASSISTANT = path.resolve(__dirname, 'AssistantMessage.svelte');
const MESSAGE_LIST = path.resolve(__dirname, '../MessageList.svelte');

describe('US5: AssistantMessage hover-revealed action row', () => {
	const source = fs.readFileSync(ASSISTANT, 'utf-8');

	it('exposes copy · branch · regenerate via accessible labels', () => {
		expect(source).toContain('aria-label="Copy message"');
		expect(source).toContain('aria-label="Branch a new chat from this whole message"');
		expect(source).toContain('aria-label="Regenerate response"');
	});

	it('names the group/message scope on the wrapper', () => {
		expect(source).toContain('group/message');
	});

	it('reveals through group-hover + focus-within (keyboard reachable)', () => {
		expect(source).toContain('group-hover/message:pointer-events-auto');
		expect(source).toContain('group-hover/message:opacity-100');
		expect(source).toContain('focus-within:pointer-events-auto');
		expect(source).toContain('focus-within:opacity-100');
	});

	it('is inert while hidden so invisible buttons cannot catch clicks', () => {
		expect(source).toContain('pointer-events-none');
		expect(source).toContain('opacity-0');
	});

	it('transitions only opacity and honors reduced motion', () => {
		expect(source).toContain('transition-opacity');
		expect(source).not.toContain('transition-transform');
		expect(source).toContain('motion-reduce:transition-none');
	});

	it('pins the coarse-pointer steady-visible override (touch parity)', () => {
		expect(source).toContain('us5-coarse-pointer');
		expect(source).toContain('@media (pointer: coarse)');
		const block = source.match(/\.message-actions\.message-actions\s*\{[^}]*\}/);
		expect(block, '.message-actions.message-actions override not found').not.toBeNull();
		expect(block![0]).toContain('opacity: 1');
		expect(block![0]).toContain('pointer-events: auto');
	});

	it('reserved-height strategy keeps message layout shift-free', () => {
		// The strip is in normal flow at constant height; no absolute overlay.
		expect(source).toMatch(/class="message-actions[^"]*h-6/);
	});

	it('replaces the legacy always-visible Branch and interrupted-only Regenerate placements', () => {
		expect(source).not.toContain('Branch from this message\n');
		// Interrupted notice survives, but its inline outline Regenerate button
		// moved into the consolidated action row.
		expect(source).toContain('This reply was interrupted.');
		expect(source).not.toContain('variant="outline"');
		expect(source).not.toContain('Regenerate</Button');
	});

	it('gates Regenerate reveal to the newest assistant turn via canRegenerate', () => {
		expect(source).toContain('canRegenerate');
		const list = fs.readFileSync(MESSAGE_LIST, 'utf-8');
		expect(list).toContain('canRegenerate={item.entry.id === lastAssistantId}');
		expect(list).toContain("last.kind === 'assistant_message'");
	});
});
