import { describe, it, expect } from 'vitest';
import { summarizeToolCall } from './tool-summary';

describe('summarizeToolCall', () => {
	it('formats create_quiz with topic', () => {
		expect(summarizeToolCall('create_quiz', { topic: 'Python basics' })).toBe(
			'Create a quiz on: Python basics'
		);
	});

	it('formats create_quiz without topic', () => {
		expect(summarizeToolCall('create_quiz', {})).toBe('Create a quiz on: this chat');
	});

	it('formats create_lab with topic', () => {
		expect(summarizeToolCall('create_lab', { topic: 'React hooks' })).toBe(
			'Create a lab on: React hooks'
		);
	});

	it('formats create_lab without topic', () => {
		expect(summarizeToolCall('create_lab', {})).toBe('Create a lab on: this chat');
	});

	it('formats branch_chat with topic', () => {
		expect(summarizeToolCall('branch_chat', { topic: 'Deep dive' })).toBe(
			'Branch this conversation (Deep dive)'
		);
	});

	it('formats branch_chat without topic', () => {
		expect(summarizeToolCall('branch_chat', {})).toBe('Branch this conversation');
	});

	it('formats save_brief with goal', () => {
		expect(summarizeToolCall('save_brief', { goal: 'Learn Rust' })).toBe(
			'Set learning goal: Learn Rust'
		);
	});

	it('formats save_brief without goal', () => {
		expect(summarizeToolCall('save_brief', {})).toBe('Set learning goal: (unspecified)');
	});

	it('formats draft_lab_skeleton', () => {
		expect(summarizeToolCall('draft_lab_skeleton', { topic: 'Svelte' })).toBe(
			'Draft a lab outline: Svelte'
		);
	});

	it('formats draft_quiz_outline', () => {
		expect(summarizeToolCall('draft_quiz_outline', { topic: 'TypeScript' })).toBe(
			'Draft a quiz outline: TypeScript'
		);
	});

	it('formats toggle_checklist_item', () => {
		expect(summarizeToolCall('toggle_checklist_item', {})).toBe('Toggle a checklist step');
	});

	it('formats read_checklist', () => {
		expect(summarizeToolCall('read_checklist', {})).toBe('Read the lab checklist');
	});

	it('formats list_artifacts', () => {
		expect(summarizeToolCall('list_artifacts', {})).toBe('List labs and quizzes');
	});

	it('formats read_artifact with kind', () => {
		expect(summarizeToolCall('read_artifact', { kind: 'lab' })).toBe('Read a lab');
	});

	it('formats read_artifact without kind', () => {
		expect(summarizeToolCall('read_artifact', {})).toBe('Read a artifact');
	});

	it('formats summarize_progress', () => {
		expect(summarizeToolCall('summarize_progress', {})).toBe('Summarize progress');
	});

	it('returns null for unknown tool', () => {
		expect(summarizeToolCall('nonexistent_tool', {})).toBe(null);
	});

	it('returns null for null args', () => {
		expect(summarizeToolCall('create_quiz', null)).toBe('Create a quiz on: this chat');
	});

	it('returns null for non-object args', () => {
		expect(summarizeToolCall('create_quiz', 42)).toBe('Create a quiz on: this chat');
	});

	it('never throws on malformed args', () => {
		expect(() => summarizeToolCall('create_quiz', 'bad')).not.toThrow();
	});
});
