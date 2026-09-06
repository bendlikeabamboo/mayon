import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { modelMessageSchema } from 'ai';
import { useFileTestDb } from '$lib/db/driver/pg-test';
import { repos } from '$lib/db';
import type { Message } from '$lib/db/schema';
import { assembleContext } from './context';
import { projectEntries, type ProjectableRow } from './projection';
import type { LearningBrief } from './brief';

const testDb = useFileTestDb();
beforeAll(() => testDb.setup());
beforeEach(() => testDb.reset());
afterAll(() => testDb.teardown());

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
		const root = await seedChat('Root', [
			{ role: 'user', content: 'u0' },
			{ role: 'assistant', content: 'a1' },
			{ role: 'user', content: 'u2' },
			{ role: 'assistant', content: 'a3' },
			{ role: 'user', content: 'u4' }
		]);
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
		const root = await seedChat('Root', [
			{ role: 'user', content: 'u0' },
			{ role: 'assistant', content: 'a1' },
			{ role: 'user', content: 'u2' },
			{ role: 'assistant', content: 'a3' }
		]);
		const child = await repos.chats.createChild({
			parentId: root.chat.id,
			branchPointMessageId: root.messages[3].id,
			title: 'Child'
		});
		await repos.messages.append(child.id, 'user', 'c0');
		await repos.messages.append(child.id, 'assistant', 'c1');
		await repos.messages.append(child.id, 'user', 'c2');

		const grand = await repos.chats.createChild({
			parentId: child.id,
			branchPointMessageId: (await repos.messages.listByChat(child.id))[1].id,
			title: 'Grand'
		});
		await repos.messages.append(grand.id, 'user', 'g0');

		const ctx = await assembleContext(grand.id);
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
			await repos.chats.updateBrief(root.id, { goal: 'g' });
			await repos.chats.updateBrief(root.id, null);
			await repos.messages.append(root.id, 'user', 'u0');
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

	describe('projectEntries (was toCoreMessages)', () => {
		it('converts plain user/assistant messages to ModelMessage with TextPart', () => {
			const rows: ProjectableRow[] = [
				{ role: 'user', content: 'hello' },
				{ role: 'assistant', content: 'hi there' }
			];
			const core = projectEntries(rows);
			expect(core).toHaveLength(2);
			expect(core[0].role).toBe('user');
			expect(core[1].role).toBe('assistant');
			if (core[1].role === 'assistant') {
				expect(core[1].content).toEqual([{ type: 'text', text: 'hi there' }]);
			}
		});

		it('emits a text-typed output when the tool result is a plain summary string', () => {
			const rows: ProjectableRow[] = [
				{ role: 'assistant', content: '', toolCallId: 'tc', toolName: 'read_checklist' },
				{
					role: 'tool',
					content: '3/5 steps done',
					toolCallId: 'tc',
					toolName: 'read_checklist',
					metadata: '3/5 steps done'
				}
			];
			const core = projectEntries(rows);
			expect(core[1].role).toBe('tool');
			const part = (core[1].content as Array<{ type: string; output?: unknown }>)[0];
			expect(part.output).toEqual({ type: 'text', value: '3/5 steps done' });
		});

		it('emits a json-typed output when the tool result is a JSON object (structured detail)', () => {
			const detail = { labs: [], quizCount: 0 };
			const rows: ProjectableRow[] = [
				{ role: 'assistant', content: '', toolCallId: 'tc', toolName: 'summarize_progress' },
				{
					role: 'tool',
					content: '0 labs, 0 quizzes',
					toolCallId: 'tc',
					toolName: 'summarize_progress',
					metadata: JSON.stringify(detail)
				}
			];
			const core = projectEntries(rows);
			expect(core[1].role).toBe('tool');
			const part = (core[1].content as Array<{ type: string; output?: unknown }>)[0];
			expect(part.output).toEqual({ type: 'json', value: detail });
		});

		it('produces a ModelMessage[] that passes the ai SDK schema (regression for the crash)', () => {
			const detail = { labs: [], quizCount: 0 };
			const rows: ProjectableRow[] = [
				{ role: 'user', content: 'I want to learn about quadratic equations' },
				{ role: 'assistant', content: 'Quadratic equations curriculum...' },
				{ role: 'user', content: 'continue' },
				{ role: 'assistant', content: 'Unit 1 — The Anatomy of a Quadratic Equation...' },
				{ role: 'user', content: 'expound more on roots' },
				{
					role: 'assistant',
					content: '',
					toolCallId: 'call_232488c0a44d49e7a2fe80af',
					toolName: 'summarize_progress'
				},
				{
					role: 'tool',
					content: '0 labs, 0 quizzes',
					toolCallId: 'call_232488c0a44d49e7a2fe80af',
					toolName: 'summarize_progress',
					metadata: JSON.stringify(detail)
				}
			];
			const core = projectEntries(rows);
			const parsed = modelMessageSchema.array().safeParse(core);
			if (!parsed.success) {
				expect.fail(
					`projectEntries produced an invalid ModelMessage[]: ${JSON.stringify(parsed.error.issues[0])}`
				);
			}
			expect(parsed.success).toBe(true);
		});

		it('validates every message shape produced by projectEntries against the SDK schema', () => {
			const rows: ProjectableRow[] = [
				{ role: 'user', content: 'hello' },
				{ role: 'assistant', content: 'working on it' },
				{ role: 'assistant', content: '', toolCallId: 'tc_a', toolName: 'list_artifacts' },
				{ role: 'assistant', content: '', toolCallId: 'tc_b', toolName: 'read_checklist' },
				{
					role: 'tool',
					content: '3/5 steps done',
					toolCallId: 'tc_a',
					toolName: 'list_artifacts',
					metadata: JSON.stringify({ items: [], count: 0 })
				},
				{
					role: 'tool',
					content: 'done',
					toolCallId: 'tc_b',
					toolName: 'read_checklist',
					metadata: 'done'
				}
			];
			const core = projectEntries(rows);
			const parsed = modelMessageSchema.array().safeParse(core);
			if (!parsed.success) {
				expect.fail(
					`projectEntries produced an invalid ModelMessage[]: ${JSON.stringify(parsed.error.issues[0])}`
				);
			}
			expect(parsed.success).toBe(true);
		});

		it('documents the contract: the SDK schema rejects the old bare-string tool output', () => {
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
			const rows: ProjectableRow[] = [
				{ role: 'assistant', content: '', toolCallId: 'tc_1', toolName: 'read_checklist' },
				{
					role: 'tool',
					content: '3/5 steps done',
					toolCallId: 'tc_1',
					toolName: 'read_checklist',
					metadata: '3/5 steps done'
				}
			];
			const core = projectEntries(rows);
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
				expect(parts[0].input).toEqual({});
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
			const rows: ProjectableRow[] = [
				{
					role: 'assistant',
					content: 'Let me check that.',
					toolCallId: 'tc_2',
					toolName: 'list_artifacts'
				}
			];
			const core = projectEntries(rows);
			// The unpaired tool call gets a synthesized placeholder result so no
			// dangling tool call is ever sent to the provider.
			expect(core).toHaveLength(2);
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
			expect(core[1].role).toBe('tool');
		});

		it('filters out system messages from the output', () => {
			const rows: ProjectableRow[] = [
				{ role: 'system', content: 'You are helpful.' },
				{ role: 'user', content: 'hello' }
			];
			const core = projectEntries(rows);
			expect(core).toHaveLength(1);
			expect(core[0].role).toBe('user');
		});

		it('merges consecutive assistant tool-call messages into a single message', () => {
			const rows: ProjectableRow[] = [
				{ role: 'assistant', content: '', toolCallId: 'call_aaa', toolName: 'list_artifacts' },
				{ role: 'assistant', content: '', toolCallId: 'call_bbb', toolName: 'summarize_progress' },
				{
					role: 'tool',
					content: 'result_a',
					toolCallId: 'call_aaa',
					toolName: 'list_artifacts',
					metadata: 'result_a'
				},
				{
					role: 'tool',
					content: 'result_b',
					toolCallId: 'call_bbb',
					toolName: 'summarize_progress',
					metadata: 'result_b'
				}
			];
			const core = projectEntries(rows);
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
			const rows: ProjectableRow[] = [
				{ role: 'assistant', content: 'first' },
				{ role: 'user', content: 'middle' },
				{ role: 'assistant', content: 'second' }
			];
			const core = projectEntries(rows);
			expect(core).toHaveLength(3);
		});

		it('null-brief chat produces no system note and byte-identical SDK input vs manual split', async () => {
			const { chat } = await seedChat('Root', [
				{ role: 'user', content: 'hello' },
				{ role: 'assistant', content: 'world' }
			]);
			const ctx = await assembleContext(chat.id);
			expect(ctx.every((m) => m.role !== 'system')).toBe(true);
			const core = projectEntries(ctx);
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

describe('assembleContext excludes internal kinds from provider context', () => {
	it('reasoning-kind rows are excluded from assembled context', async () => {
		const chat = await repos.chats.createRoot({ title: 'Root' });
		await repos.messages.append(chat.id, 'user', 'hello');
		await repos.messages.append(chat.id, 'assistant', 'visible reply');
		await repos.messages.append(chat.id, 'assistant', 'thinking hard', {
			kind: 'reasoning',
			metadata: JSON.stringify({ iteration: 0 })
		});
		await repos.messages.append(chat.id, 'assistant', 'more visible');

		const ctx = await assembleContext(chat.id);
		expect(ctx.map((m) => m.content)).toEqual(['hello', 'visible reply', 'more visible']);
	});

	it('approval-kind rows are excluded from assembled context', async () => {
		const chat = await repos.chats.createRoot({ title: 'Root' });
		await repos.messages.append(chat.id, 'user', 'hello');
		await repos.messages.append(chat.id, 'assistant', 'before approval');
		await repos.messages.append(chat.id, 'assistant', 'branch_chat — Branch a chat', {
			toolCallId: 'tc1',
			toolName: 'branch_chat',
			kind: 'approval',
			metadata: JSON.stringify({
				toolName: 'branch_chat',
				description: 'Branch a chat',
				args: {},
				outcome: null
			})
		});
		await repos.messages.append(chat.id, 'assistant', 'after approval');

		const ctx = await assembleContext(chat.id);
		expect(ctx.map((m) => m.content)).toEqual(['hello', 'before approval', 'after approval']);
	});
});

describe('branch_artifact steering (020 US2 / T016)', () => {
	const ARTIFACT = 'ARTIFACT-PAYLOAD: the fix was applied on the branch';

	async function seedParentWithExchange() {
		const parent = await repos.chats.createRoot({ title: 'Parent' });
		const u0 = await repos.messages.append(parent.id, 'user', 'u0');
		const a1 = await repos.messages.append(parent.id, 'assistant', 'a1');
		const u2 = await repos.messages.append(parent.id, 'user', 'u2');
		const a3 = await repos.messages.append(parent.id, 'assistant', 'a3');
		return { parent, u0, a1, u2, a3 };
	}

	async function insertArtifact(
		parentId: string,
		after: Message,
		before: Message | null
	): Promise<Message> {
		return repos.messages.insertAnchored(
			parentId,
			{
				role: 'user',
				content: ARTIFACT,
				kind: 'branch_artifact',
				metadata: JSON.stringify({
					mode: 'raw',
					sourceChatId: 'chat-src',
					sourceChatTitle: 'Fix branch',
					branchPointMessageId: after.id,
					anchor: 'recorded',
					summaryTraceId: null,
					regeneratedAt: null
				})
			},
			{ afterOrd: after.ord, beforeOrd: before ? before.ord : null }
		);
	}

	it('emits branch_artifact rows with their stored user role (not in PROVIDER_EXCLUDED_KINDS)', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		await repos.messages.append(parent.id, 'user', 'u0');
		const a1 = await repos.messages.append(parent.id, 'assistant', 'a1');
		const artifact = await insertArtifact(parent.id, a1, null);

		expect(artifact.role).toBe('user');
		const ctx = await assembleContext(parent.id);
		// Emitted verbatim with its stored role — framing happens at projection.
		expect(ctx.map((m) => m.content)).toEqual(['u0', 'a1', ARTIFACT]);
		const artifactMsgs = ctx.filter((m) => m.content === ARTIFACT);
		expect(artifactMsgs).toHaveLength(1);
		expect(artifactMsgs[0].role).toBe('user');
	});

	it('parent composition includes the artifact anchored mid-thread after propagation', async () => {
		const { parent, a1, u2 } = await seedParentWithExchange();
		const child = await repos.chats.createChild({
			parentId: parent.id,
			branchPointMessageId: a1.id,
			title: 'Fix branch'
		});
		await repos.messages.append(child.id, 'user', 'fix it');
		await repos.messages.append(child.id, 'assistant', 'fixed');

		const artifact = await insertArtifact(parent.id, a1, u2);
		// Midpoint placement between the branch point and the next parent row.
		expect(artifact.ord).toBe((a1.ord + u2.ord) / 2);

		const ctx = await assembleContext(parent.id);
		expect(ctx.map((m) => m.content)).toEqual(['u0', 'a1', ARTIFACT, 'u2', 'a3']);
	});

	it("a pre-existing sibling branch's composition excludes the artifact (FR-009)", async () => {
		const { parent, a1, u2 } = await seedParentWithExchange();
		// The sibling forks at a1 BEFORE the artifact lands; its cutoff
		// (ord <= a1.ord) sits below the artifact's midpoint ord.
		const sibling = await repos.chats.createChild({
			parentId: parent.id,
			branchPointMessageId: a1.id,
			title: 'Pre-existing sibling'
		});
		await repos.messages.append(sibling.id, 'user', 's0');

		await insertArtifact(parent.id, a1, u2);

		const ctx = await assembleContext(sibling.id);
		expect(ctx.map((m) => m.content)).toEqual(['u0', 'a1', 's0']);
		expect(ctx.some((m) => m.content === ARTIFACT)).toBe(false);
	});

	it('a branch created afterward whose branch point is at/after the artifact includes it', async () => {
		const { parent, a1, u2 } = await seedParentWithExchange();
		const artifact = await insertArtifact(parent.id, a1, u2);

		// Fork exactly AT the artifact: the inclusive ord <= cutoff walk (1.5)
		// picks it up.
		const late = await repos.chats.createChild({
			parentId: parent.id,
			branchPointMessageId: artifact.id,
			title: 'Late branch'
		});
		await repos.messages.append(late.id, 'user', 'l0');

		const ctx = await assembleContext(late.id);
		expect(ctx.map((m) => m.content)).toEqual(['u0', 'a1', ARTIFACT, 'l0']);
	});
});
