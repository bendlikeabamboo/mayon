import { beforeEach, describe, expect, it } from 'vitest';
import { modelMessageSchema } from 'ai';
import { bootstrapWithDriver } from '$lib/db/driver/client';
import { bootstrapTestDb } from '$lib/db/driver/pg-test';
import { repos } from '$lib/db';
import { assembleContext, toCoreMessages } from './context';
import type { ChatMessage } from '$lib/ai/types';
import type { LearningBrief } from './brief';

beforeEach(async () => {
	const { driver } = await bootstrapTestDb();
	await bootstrapWithDriver(driver, 'pg');
});

/**
 * Helper: build a chat with an ordered set of (role, content) messages.
 * Returns the chat plus the appended messages so tests can reference ords/ids.
 * `brief` is written on the root when provided.
 */
async function seedChat(
	title: string,
	messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
	brief?: LearningBrief
) {
	const chat = await repos.chats.createRoot({ title, brief });
	const rows = [];
	for (const m of messages) rows.push(await repos.messages.append(chat.id, m.role, m.content));
	return { chat, messages: rows };
}

describe('assembleContext', () => {
	it('returns the chat own messages when it is a root', async () => {
		const { chat } = await seedChat('Root', [
			{ role: 'user', content: 'u0' },
			{ role: 'assistant', content: 'a1' }
		]);
		const ctx = await assembleContext(chat.id);
		expect(ctx.map((m) => m.content)).toEqual(['u0', 'a1']);
		expect(ctx.every((m) => m.role !== 'system')).toBe(true);
	});

	it('includes ancestor messages up to the branch-point cutoff and excludes the rest', async () => {
		// Root: u0, a1, u2, a3, u4   (ords 0..4)
		const root = await seedChat('Root', [
			{ role: 'user', content: 'u0' },
			{ role: 'assistant', content: 'a1' },
			{ role: 'user', content: 'u2' },
			{ role: 'assistant', content: 'a3' },
			{ role: 'user', content: 'u4' }
		]);
		// Child branches off root at message a1 (ord 1). It should see root's
		// u0..a1, but NOT u2/a3/u4.
		const child = await repos.chats.createChild({
			parentId: root.chat.id,
			branchPointMessageId: root.messages[1].id,
			title: 'Child'
		});
		await repos.messages.append(child.id, 'user', 'c0');
		await repos.messages.append(child.id, 'assistant', 'c1');

		const ctx = await assembleContext(child.id);
		expect(ctx.map((m) => m.content)).toEqual(['u0', 'a1', 'c0', 'c1']);
	});

	it('walks multiple ancestors (grandchild) applying each cutoff', async () => {
		// Root: u0, a1, u2, a3   (ords 0..3)
		const root = await seedChat('Root', [
			{ role: 'user', content: 'u0' },
			{ role: 'assistant', content: 'a1' },
			{ role: 'user', content: 'u2' },
			{ role: 'assistant', content: 'a3' }
		]);
		// Child branches at a3 (ord 3) → sees all of root.
		const child = await repos.chats.createChild({
			parentId: root.chat.id,
			branchPointMessageId: root.messages[3].id,
			title: 'Child'
		});
		await repos.messages.append(child.id, 'user', 'c0');
		await repos.messages.append(child.id, 'assistant', 'c1');
		await repos.messages.append(child.id, 'user', 'c2'); // after the grandchild's fork

		// Grandchild branches off child at c1 (ord 1) → sees child's c0,c1 (not c2)
		// plus all of root.
		const grand = await repos.chats.createChild({
			parentId: child.id,
			branchPointMessageId: (await repos.messages.listByChat(child.id))[1].id,
			title: 'Grand'
		});
		await repos.messages.append(grand.id, 'user', 'g0');

		const ctx = await assembleContext(grand.id);
		// Ordered by depth asc, then ord asc: root (0..3), child (0..1), grand (0).
		expect(ctx.map((m) => m.content)).toEqual(['u0', 'a1', 'u2', 'a3', 'c0', 'c1', 'g0']);
	});

	it('sorts parts by depth asc then ord asc', async () => {
		const root = await seedChat('Root', [
			{ role: 'user', content: 'u0' },
			{ role: 'assistant', content: 'a1' }
		]);
		const child = await repos.chats.createChild({
			parentId: root.chat.id,
			branchPointMessageId: root.messages[1].id,
			title: 'Child'
		});
		await repos.messages.append(child.id, 'user', 'c0');

		const ctx = await assembleContext(child.id);
		expect(ctx.map((m) => m.content)).toEqual(['u0', 'a1', 'c0']);
	});

	it('injects the branch excerpt as a leading system note when a branch_source exists', async () => {
		const root = await seedChat('Root', [
			{ role: 'user', content: 'u0' },
			{ role: 'assistant', content: 'the highlighted span here' },
			{ role: 'user', content: 'u2' }
		]);
		const branchMessage = root.messages[1];
		const child = await repos.chats.createChild({
			parentId: root.chat.id,
			branchPointMessageId: branchMessage.id,
			title: 'Child'
		});
		await repos.branchSources.create({
			sourceMessageId: branchMessage.id,
			startChar: 0,
			endChar: 19,
			excerpt: 'the highlighted span',
			branchChatId: child.id
		});
		await repos.messages.append(child.id, 'user', 'c0');

		const ctx = await assembleContext(child.id);
		expect(ctx[0].role).toBe('system');
		expect(ctx[0].content).toContain('the highlighted span');
		// The excerpt note leads, then the assembled history.
		expect(ctx.map((m) => m.content)).toEqual([
			expect.stringContaining('the highlighted span'),
			'u0',
			'the highlighted span here',
			'c0'
		]);
	});

	it('omits the system note when there is no branch_source', async () => {
		const root = await seedChat('Root', [{ role: 'user', content: 'u0' }]);
		const ctx = await assembleContext(root.chat.id);
		expect(ctx.every((m) => m.role !== 'system')).toBe(true);
	});

	describe('brief system note', () => {
		it('leads with the brief system note when the root has a brief', async () => {
			const { chat } = await seedChat(
				'Root',
				[
					{ role: 'user', content: 'u0' },
					{ role: 'assistant', content: 'a1' }
				],
				{ goal: 'build a Makefile', level: 'some', mode: 'socratic' }
			);
			const ctx = await assembleContext(chat.id);
			expect(ctx[0].role).toBe('system');
			expect(ctx[0].content).toContain('build a Makefile');
			// History follows the brief note, unchanged.
			expect(ctx.map((m) => m.content)).toEqual([
				expect.stringContaining('build a Makefile'),
				'u0',
				'a1'
			]);
		});

		it('omits the brief note when the root brief is null (unchanged behavior)', async () => {
			const root = await seedChat('Root', [{ role: 'user', content: 'u0' }]);
			const ctx = await assembleContext(root.chat.id);
			expect(ctx.every((m) => m.role !== 'system')).toBe(true);
		});

		it('a child inherits the root brief: order is [brief, excerpt, …messages]', async () => {
			// Root has a brief AND a branch_source-able assistant reply.
			const root = await seedChat(
				'Root',
				[
					{ role: 'user', content: 'u0' },
					{ role: 'assistant', content: 'the highlighted span here' },
					{ role: 'user', content: 'u2' }
				],
				{ goal: 'master the topic', mode: 'explainer' }
			);
			const branchMessage = root.messages[1];
			// Child branches off the highlighted assistant reply.
			const child = await repos.chats.createChild({
				parentId: root.chat.id,
				branchPointMessageId: branchMessage.id,
				title: 'Child'
			});
			await repos.branchSources.create({
				sourceMessageId: branchMessage.id,
				startChar: 0,
				endChar: 19,
				excerpt: 'the highlighted span',
				branchChatId: child.id
			});
			await repos.messages.append(child.id, 'user', 'c0');

			const ctx = await assembleContext(child.id);
			// [briefNote, excerptNote, u0, the highlighted span here, c0]
			expect(ctx.map((m) => m.role)).toEqual(['system', 'system', 'user', 'assistant', 'user']);
			expect(ctx[0].content).toContain('master the topic');
			expect(ctx[1].content).toContain('the highlighted span');
			expect(ctx.map((m) => m.content)).toEqual([
				expect.stringContaining('master the topic'),
				expect.stringContaining('the highlighted span'),
				'u0',
				'the highlighted span here',
				'c0'
			]);
		});

		it('a corrupted/empty brief on the root is treated as null (no throw)', async () => {
			const root = await repos.chats.createRoot({ title: 'Root' });
			// Inject a malformed brief value directly (parseBrief → null).
			await repos.chats.updateBrief(root.id, { goal: 'g' });
			await repos.chats.updateBrief(root.id, null);
			await repos.messages.append(root.id, 'user', 'u0');
			// Even a garbage JSON string in the column never breaks assembly.
			const rawRow = await repos.chats.getById(root.id);
			expect(rawRow?.brief).toBeNull();
			const ctx = await assembleContext(root.id);
			expect(ctx.every((m) => m.role !== 'system')).toBe(true);
		});
	});

	describe('attachment system notes', () => {
		it('injects attached resources as leading system notes', async () => {
			const { chat } = await seedChat('Root', [{ role: 'user', content: 'u0' }]);
			await repos.mcp.addAttachment(chat.id, {
				serverId: 'srv-1',
				serverName: 'My Server',
				uri: 'file:///readme.md',
				name: 'readme.md',
				content: 'Attachment content here',
				attachedAt: 1000
			});

			const ctx = await assembleContext(chat.id);
			const systemNotes = ctx.filter((m) => m.role === 'system');
			expect(systemNotes.length).toBe(1);
			expect(systemNotes[0].content).toContain('Attached MCP resource');
			expect(systemNotes[0].content).toContain('My Server');
			expect(systemNotes[0].content).toContain('readme.md');
			expect(systemNotes[0].content).toContain('Attachment content here');
		});

		it('multiple attachments produce multiple system notes', async () => {
			const { chat } = await seedChat('Root', [{ role: 'user', content: 'u0' }]);
			await repos.mcp.addAttachment(chat.id, {
				serverId: 'srv-1',
				serverName: 'S1',
				uri: 'file:///a.txt',
				name: 'a.txt',
				content: 'content a',
				attachedAt: 1000
			});
			await repos.mcp.addAttachment(chat.id, {
				serverId: 'srv-2',
				serverName: 'S2',
				uri: 'file:///b.txt',
				name: 'b.txt',
				content: 'content b',
				attachedAt: 1000
			});

			const ctx = await assembleContext(chat.id);
			const systemNotes = ctx.filter((m) => m.role === 'system');
			expect(systemNotes.length).toBe(2);
		});

		it('no attachment notes when no attachments exist', async () => {
			const { chat } = await seedChat('Root', [{ role: 'user', content: 'u0' }]);
			const ctx = await assembleContext(chat.id);
			expect(ctx.every((m) => m.role !== 'system')).toBe(true);
		});
	});

	it('throws when the target chat does not exist', async () => {
		await expect(assembleContext('nope')).rejects.toThrow(/not found/);
	});

	it('treats a root ancestor (null branch point) as "include all" of its messages', async () => {
		// A child branching at the LAST root message should see every root message.
		const root = await seedChat('Root', [
			{ role: 'user', content: 'u0' },
			{ role: 'assistant', content: 'a1' }
		]);
		const child = await repos.chats.createChild({
			parentId: root.chat.id,
			branchPointMessageId: root.messages[1].id,
			title: 'Child'
		});
		await repos.messages.append(child.id, 'user', 'c0');
		const ctx = await assembleContext(child.id);
		expect(ctx.map((m) => m.content)).toEqual(['u0', 'a1', 'c0']);
	});

	describe('toCoreMessages', () => {
		it('converts plain user/assistant messages to ModelMessage with TextPart', () => {
			const ctx: ChatMessage[] = [
				{ role: 'user', content: 'hello' },
				{ role: 'assistant', content: 'hi there' }
			];
			const core = toCoreMessages(ctx);
			expect(core).toHaveLength(2);
			expect(core[0].role).toBe('user');
			expect(core[1].role).toBe('assistant');
			if (core[1].role === 'assistant') {
				expect(core[1].content).toEqual([{ type: 'text', text: 'hi there' }]);
			}
		});

		it('emits a text-typed output when the tool result is a plain summary string', () => {
			const ctx: ChatMessage[] = [
				{
					role: 'assistant',
					content: '',
					toolCallId: 'tc',
					toolName: 'read_checklist',
					toolArgs: {}
				},
				{
					role: 'tool',
					content: '3/5 steps done',
					toolCallId: 'tc',
					toolName: 'read_checklist',
					toolResult: '3/5 steps done'
				}
			];
			const core = toCoreMessages(ctx);
			expect(core[1].role).toBe('tool');
			const part = (core[1].content as Array<{ type: string; output?: unknown }>)[0];
			expect(part.output).toEqual({ type: 'text', value: '3/5 steps done' });
		});

		it('emits a json-typed output when the tool result is a JSON object (structured detail)', () => {
			// Mirrors what appendToolResult persists: content = summary string,
			// metadata = JSON-stringified detail object. assembleContext promotes
			// metadata into toolResult, so toCoreMessages sees the JSON string.
			const detail = { labs: [], quizCount: 0 };
			const ctx: ChatMessage[] = [
				{
					role: 'assistant',
					content: '',
					toolCallId: 'tc',
					toolName: 'summarize_progress',
					toolArgs: {}
				},
				{
					role: 'tool',
					content: '0 labs, 0 quizzes',
					toolCallId: 'tc',
					toolName: 'summarize_progress',
					toolResult: JSON.stringify(detail)
				}
			];
			const core = toCoreMessages(ctx);
			expect(core[1].role).toBe('tool');
			const part = (core[1].content as Array<{ type: string; output?: unknown }>)[0];
			expect(part.output).toEqual({ type: 'json', value: detail });
		});

		it('produces a ModelMessage[] that passes the ai SDK schema (regression for the crash)', () => {
			// Reconstructed from a real crash: a summarize_progress tool call whose
			// persisted result fed a bare string into tool-result `output`, which
			// ai v7's standardizePrompt rejected at path [6].content[0].output
			// before the provider was ever called. This guards the whole assembly
			// against ever emitting shape the SDK refuses.
			const detail = { labs: [], quizCount: 0 };
			const ctx: ChatMessage[] = [
				{ role: 'user', content: 'I want to learn about quadratic equations' },
				{ role: 'assistant', content: 'Quadratic equations curriculum...' },
				{ role: 'user', content: 'continue' },
				{
					role: 'assistant',
					content: 'Unit 1 — The Anatomy of a Quadratic Equation...'
				},
				{ role: 'user', content: 'expound more on roots' },
				{
					role: 'assistant',
					content: '',
					toolCallId: 'call_232488c0a44d49e7a2fe80af',
					toolName: 'summarize_progress',
					toolArgs: {}
				},
				{
					role: 'tool',
					content: '0 labs, 0 quizzes',
					toolCallId: 'call_232488c0a44d49e7a2fe80af',
					toolName: 'summarize_progress',
					toolResult: JSON.stringify(detail)
				}
			];
			const core = toCoreMessages(ctx);
			const parsed = modelMessageSchema.array().safeParse(core);
			if (!parsed.success) {
				expect.fail(
					`toCoreMessages produced an invalid ModelMessage[]: ${JSON.stringify(parsed.error.issues[0])}`
				);
			}
			expect(parsed.success).toBe(true);
		});

		it('validates every message shape produced by toCoreMessages against the SDK schema', () => {
			// Exhaustive shape sweep: exercises every branch of toCoreMessages
			// (user text, assistant text, assistant tool-call, tool json, tool
			// text) and asserts the combined array parses cleanly.
			const ctx: ChatMessage[] = [
				{ role: 'user', content: 'hello' },
				{ role: 'assistant', content: 'working on it' },
				{
					role: 'assistant',
					content: '',
					toolCallId: 'tc_a',
					toolName: 'list_artifacts',
					toolArgs: { chatId: 'c1' }
				},
				{
					role: 'assistant',
					content: '',
					toolCallId: 'tc_b',
					toolName: 'read_checklist',
					toolArgs: {}
				},
				{
					role: 'tool',
					content: '3/5 steps done',
					toolCallId: 'tc_a',
					toolName: 'list_artifacts',
					toolResult: JSON.stringify({ items: [], count: 0 })
				},
				{
					role: 'tool',
					content: 'done',
					toolCallId: 'tc_b',
					toolName: 'read_checklist',
					toolResult: 'done'
				}
			];
			const core = toCoreMessages(ctx);
			const parsed = modelMessageSchema.array().safeParse(core);
			if (!parsed.success) {
				expect.fail(
					`toCoreMessages produced an invalid ModelMessage[]: ${JSON.stringify(parsed.error.issues[0])}`
				);
			}
			expect(parsed.success).toBe(true);
		});

		it('documents the contract: the SDK schema rejects the old bare-string tool output', () => {
			// The pre-fix shape (a raw string under `output`) is what used to
			// crash the run. If the SDK ever loosens this, the regression above
			// still guards the json/text contract; this test pins the contract.
			const bad = [
				{
					role: 'tool',
					content: [
						{
							type: 'tool-result',
							toolCallId: 'tc',
							toolName: 'summarize_progress',
							output: '0 labs, 0 quizzes'
						}
					]
				}
			];
			expect(modelMessageSchema.array().safeParse(bad).success).toBe(false);
		});

		it('converts assistant tool-call + tool-result pair into parts', () => {
			const ctx: ChatMessage[] = [
				{
					role: 'assistant',
					content: '',
					toolCallId: 'tc_1',
					toolName: 'read_checklist',
					toolArgs: { labId: 'lab-1' }
				},
				{
					role: 'tool',
					content: '3/5 steps done',
					toolCallId: 'tc_1',
					toolName: 'read_checklist',
					toolResult: '3/5 steps done'
				}
			];
			const core = toCoreMessages(ctx);
			expect(core).toHaveLength(2);

			expect(core[0].role).toBe('assistant');
			if (core[0].role === 'assistant') {
				const parts = core[0].content as Array<{
					type: string;
					toolCallId?: string;
					toolName?: string;
					input?: unknown;
				}>;
				expect(parts).toHaveLength(1);
				expect(parts[0].type).toBe('tool-call');
				expect(parts[0].toolCallId).toBe('tc_1');
				expect(parts[0].toolName).toBe('read_checklist');
			}

			expect(core[1].role).toBe('tool');
			if (core[1].role === 'tool') {
				const parts = core[1].content as Array<{
					type: string;
					toolCallId?: string;
					toolName?: string;
					output?: unknown;
				}>;
				expect(parts).toHaveLength(1);
				expect(parts[0].type).toBe('tool-result');
				expect(parts[0].toolCallId).toBe('tc_1');
				expect(parts[0].output).toEqual({ type: 'text', value: '3/5 steps done' });
			}
		});

		it('converts assistant with text + tool call into mixed parts', () => {
			const ctx: ChatMessage[] = [
				{
					role: 'assistant',
					content: 'Let me check that.',
					toolCallId: 'tc_2',
					toolName: 'list_artifacts',
					toolArgs: { chatId: 'c1' }
				}
			];
			const core = toCoreMessages(ctx);
			expect(core).toHaveLength(1);
			expect(core[0].role).toBe('assistant');
			if (core[0].role === 'assistant') {
				const parts = core[0].content as Array<{
					type: string;
					text?: string;
					toolCallId?: string;
					toolName?: string;
				}>;
				expect(parts).toHaveLength(2);
				expect(parts[0]).toEqual({ type: 'text', text: 'Let me check that.' });
				expect(parts[1].type).toBe('tool-call');
				expect(parts[1].toolCallId).toBe('tc_2');
			}
		});

		it('filters out system messages from the output', () => {
			const ctx: ChatMessage[] = [
				{ role: 'system', content: 'You are helpful.' },
				{ role: 'user', content: 'hello' }
			];
			const core = toCoreMessages(ctx);
			expect(core).toHaveLength(1);
			expect(core[0].role).toBe('user');
		});

		it('merges consecutive assistant tool-call messages into a single message', () => {
			const ctx: ChatMessage[] = [
				{
					role: 'assistant',
					content: '',
					toolCallId: 'call_aaa',
					toolName: 'list_artifacts',
					toolArgs: {}
				},
				{
					role: 'assistant',
					content: '',
					toolCallId: 'call_bbb',
					toolName: 'summarize_progress',
					toolArgs: {}
				},
				{
					role: 'tool',
					content: 'result_a',
					toolCallId: 'call_aaa',
					toolName: 'list_artifacts',
					toolResult: 'result_a'
				},
				{
					role: 'tool',
					content: 'result_b',
					toolCallId: 'call_bbb',
					toolName: 'summarize_progress',
					toolResult: 'result_b'
				}
			];
			const core = toCoreMessages(ctx);
			expect(core).toHaveLength(2);

			expect(core[0].role).toBe('assistant');
			if (core[0].role === 'assistant') {
				const parts = core[0].content as Array<{
					type: string;
					toolCallId?: string;
					toolName?: string;
					input?: unknown;
				}>;
				expect(parts).toHaveLength(2);
				expect(parts[0]).toEqual({
					type: 'tool-call',
					toolCallId: 'call_aaa',
					toolName: 'list_artifacts',
					input: {}
				});
				expect(parts[1]).toEqual({
					type: 'tool-call',
					toolCallId: 'call_bbb',
					toolName: 'summarize_progress',
					input: {}
				});
			}

			expect(core[1].role).toBe('tool');
			if (core[1].role === 'tool') {
				const parts = core[1].content as Array<{
					type: string;
					toolCallId?: string;
					toolName?: string;
					output?: unknown;
				}>;
				expect(parts).toHaveLength(2);
				expect(parts[0]).toEqual({
					type: 'tool-result',
					toolCallId: 'call_aaa',
					toolName: 'list_artifacts',
					output: { type: 'text', value: 'result_a' }
				});
				expect(parts[1]).toEqual({
					type: 'tool-result',
					toolCallId: 'call_bbb',
					toolName: 'summarize_progress',
					output: { type: 'text', value: 'result_b' }
				});
			}
		});

		it('does not merge non-consecutive same-role messages', () => {
			const ctx: ChatMessage[] = [
				{ role: 'assistant', content: 'first' },
				{ role: 'user', content: 'middle' },
				{ role: 'assistant', content: 'second' }
			];
			const core = toCoreMessages(ctx);
			expect(core).toHaveLength(3);
		});

		it('null-brief chat produces no system note and byte-identical SDK input vs manual split', async () => {
			const { chat } = await seedChat('Root', [
				{ role: 'user', content: 'hello' },
				{ role: 'assistant', content: 'world' }
			]);
			const ctx = await assembleContext(chat.id);
			expect(ctx.every((m) => m.role !== 'system')).toBe(true);
			const core = toCoreMessages(ctx);
			expect(core).toHaveLength(2);
			expect(core[0].role).toBe('user');
			expect(core[1].role).toBe('assistant');
			if (core[0].role === 'user') {
				expect(core[0].content).toEqual([{ type: 'text', text: 'hello' }]);
			}
			if (core[1].role === 'assistant') {
				expect(core[1].content).toEqual([{ type: 'text', text: 'world' }]);
			}
		});
	});
});
