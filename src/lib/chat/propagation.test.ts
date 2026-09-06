import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useFileTestDb, type FileTestDb } from '$lib/db/driver/pg-test';
import { repos } from '$lib/db';
import {
	branchArtifactMetadata,
	buildRawDelta,
	renderRawTurns,
	resolveAnchor,
	resolveExcerpt
} from './propagation';

const testDb = useFileTestDb();
let handle: FileTestDb | null = null;
beforeAll(async () => {
	handle = await testDb.setup();
});
beforeEach(() => testDb.reset());
afterAll(() => testDb.teardown());

/** Tests control createdAt directly — derived anchors depend on it. */
async function setMessageCreatedAt(id: string, createdAt: number): Promise<void> {
	await handle!.driver.query('UPDATE messages SET created_at = $1 WHERE id = $2', [createdAt, id]);
}

async function setChatCreatedAt(id: string, createdAt: number): Promise<void> {
	await handle!.driver.query('UPDATE chats SET created_at = $1 WHERE id = $2', [createdAt, id]);
}

/** Branch child of `parentId`, optionally recorded at a branch-point message. */
async function seedBranch(parentId: string, branchPointMessageId: string | null) {
	return repos.chats.createChild({
		parentId,
		branchPointMessageId,
		title: 'Branch'
	});
}

describe('renderRawTurns — role prefixes and verbatim bodies', () => {
	it('prefixes user/assistant turns and tool results with their tool name', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		await repos.messages.append(parent.id, 'user', 'run the tests');
		await repos.messages.append(parent.id, 'assistant', '', {
			toolCallId: 'tc1',
			toolName: 'bash'
		});
		await repos.messages.appendToolResult(parent.id, {
			toolCallId: 'tc1',
			toolName: 'bash',
			summary: 'all green',
			detail: { exit: 0 }
		});
		await repos.messages.append(parent.id, 'assistant', 'All tests pass.');

		const rows = await repos.messages.listByChat(parent.id);
		expect(renderRawTurns(rows)).toBe(
			[
				'[user] run the tests',
				'[assistant] ',
				'[tool: bash] {"exit":0}',
				'[assistant] All tests pass.'
			].join('\n')
		);
	});

	it('tool result without metadata falls back to its content', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		await repos.messages.appendToolResult(parent.id, {
			toolCallId: 'tc2',
			toolName: 'web_search',
			summary: 'nothing found'
		});
		const rows = await repos.messages.listByChat(parent.id);
		expect(renderRawTurns(rows)).toBe('[tool: web_search] nothing found');
	});

	it('multi-line content is kept verbatim (no truncation, no re-wrapping)', () => {
		const long = 'x'.repeat(5000);
		const rendered = renderRawTurns([
			{
				id: 'm1',
				chatId: 'c',
				role: 'user',
				content: `line one\nline two\n${long}`,
				ord: 0,
				model: null,
				tokens: null,
				toolCallId: null,
				toolName: null,
				metadata: null,
				kind: 'user_message',
				parts: null,
				createdAt: 0
			}
		]);
		expect(rendered).toBe(`[user] line one\nline two\n${long}`);
	});
});

describe('buildRawDelta — excerpt resolution and full format', () => {
	it('includes the branch_sources excerpt section ahead of the turns', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const anchor = await repos.messages.append(parent.id, 'assistant', 'The anchor reply.');
		const child = await seedBranch(parent.id, anchor.id);
		await repos.branchSources.create({
			sourceMessageId: anchor.id,
			startChar: 0,
			endChar: 9,
			excerpt: 'The anchor',
			branchChatId: child.id
		});
		await repos.messages.append(child.id, 'user', 'branch question');
		await repos.messages.append(child.id, 'assistant', 'branch answer');

		expect(await buildRawDelta(child.id)).toBe(
			[
				'[excerpt]',
				'The anchor',
				'[/excerpt]',
				'',
				'[user] branch question',
				'[assistant] branch answer'
			].join('\n')
		);
	});

	it('falls back to the branch-point message content when no branch_source exists', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const anchor = await repos.messages.append(parent.id, 'assistant', 'The anchor reply.');
		const child = await seedBranch(parent.id, anchor.id);
		await repos.messages.append(child.id, 'user', 'go on');

		expect(await buildRawDelta(child.id)).toBe(
			['[excerpt]', 'The anchor reply.', '[/excerpt]', '', '[user] go on'].join('\n')
		);
	});

	it('omits the excerpt section entirely for a composer branch (no source, no anchor row)', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const child = await seedBranch(parent.id, null);
		await repos.messages.append(child.id, 'user', 'fresh direction');

		const delta = await buildRawDelta(child.id);
		expect(delta).toBe('[user] fresh direction');
		expect(delta).not.toContain('[excerpt]');
	});

	it('never truncates: many turns all render in ord order', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const anchor = await repos.messages.append(parent.id, 'user', 'start');
		const child = await seedBranch(parent.id, anchor.id);
		const count = 40;
		for (let i = 0; i < count; i++) {
			await repos.messages.append(child.id, i % 2 === 0 ? 'user' : 'assistant', `turn ${i}`);
		}

		const delta = await buildRawDelta(child.id);
		const lines = delta.split('\n');
		// excerpt section (4 lines incl. blank) + one line per turn
		expect(lines).toHaveLength(4 + count);
		expect(lines[4]).toBe('[user] turn 0');
		expect(lines[lines.length - 1]).toBe(`[assistant] turn ${count - 1}`);
	});
});

describe('resolveExcerpt', () => {
	it('prefers branch_sources over the anchor message content', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const anchor = await repos.messages.append(parent.id, 'assistant', 'whole message');
		const child = await seedBranch(parent.id, anchor.id);
		await repos.branchSources.create({
			sourceMessageId: anchor.id,
			startChar: 0,
			endChar: 5,
			excerpt: 'whole',
			branchChatId: child.id
		});
		expect(await resolveExcerpt((await repos.chats.getById(child.id))!)).toBe('whole');
	});
});

describe('resolveAnchor — recorded', () => {
	it('recorded with a next row: midpoint placement between anchor and next ord', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const a = await repos.messages.append(parent.id, 'user', 'a');
		await repos.messages.append(parent.id, 'assistant', 'b');
		const child = await seedBranch(parent.id, a.id);

		const { placement, anchor } = await resolveAnchor(child);
		expect(anchor).toBe('recorded');
		expect(placement).toEqual({ afterOrd: 0, beforeOrd: 1 });
	});

	it('recorded at the end of the parent: beforeOrd is null', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		await repos.messages.append(parent.id, 'user', 'a');
		const b = await repos.messages.append(parent.id, 'assistant', 'b');
		const child = await seedBranch(parent.id, b.id);

		const { placement, anchor } = await resolveAnchor(child);
		expect(anchor).toBe('recorded');
		expect(placement).toEqual({ afterOrd: 1, beforeOrd: null });
	});
});

describe('resolveAnchor — derived', () => {
	it('derives the last parent row with createdAt <= branch.createdAt', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const m0 = await repos.messages.append(parent.id, 'user', 'm0');
		const m1 = await repos.messages.append(parent.id, 'assistant', 'm1');
		const m2 = await repos.messages.append(parent.id, 'user', 'm2');
		await setMessageCreatedAt(m0.id, 1000);
		await setMessageCreatedAt(m1.id, 2000);
		await setMessageCreatedAt(m2.id, 3000);
		const child = await seedBranch(parent.id, null);
		await setChatCreatedAt(child.id, 2500);

		// Re-read: the createChild row carries the pre-update in-memory timestamp.
		const { placement, anchor } = await resolveAnchor((await repos.chats.getById(child.id))!);
		expect(anchor).toBe('derived');
		expect(placement).toEqual({ afterOrd: m1.ord, beforeOrd: m2.ord });
	});

	it('start-of-thread when no parent row is eligible (all newer than the branch)', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const m0 = await repos.messages.append(parent.id, 'user', 'm0');
		await setMessageCreatedAt(m0.id, 3000);
		const child = await seedBranch(parent.id, null);
		await setChatCreatedAt(child.id, 1000);

		const { placement, anchor } = await resolveAnchor((await repos.chats.getById(child.id))!);
		expect(anchor).toBe('derived');
		expect(placement).toBe('start');
	});
});

describe('placement derivation through insertAnchored', () => {
	it('recorded mid-thread insert lands on the midpoint', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const a = await repos.messages.append(parent.id, 'user', 'a');
		const b = await repos.messages.append(parent.id, 'assistant', 'b');
		const child = await seedBranch(parent.id, a.id);

		const { placement } = await resolveAnchor(child);
		const art = await repos.messages.insertAnchored(
			parent.id,
			{ role: 'user', content: 'artifact', kind: 'branch_artifact' },
			placement
		);
		expect(art.ord).toBe((a.ord + b.ord) / 2);
	});

	it('recorded-at-end insert lands on afterOrd + 1', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		await repos.messages.append(parent.id, 'user', 'a');
		const b = await repos.messages.append(parent.id, 'assistant', 'b');
		const child = await seedBranch(parent.id, b.id);

		const { placement } = await resolveAnchor(child);
		const art = await repos.messages.insertAnchored(
			parent.id,
			{ role: 'user', content: 'artifact', kind: 'branch_artifact' },
			placement
		);
		expect(art.ord).toBe(2);
	});
});

describe('branchArtifactMetadata', () => {
	it('raw mode snapshot with null trace/regeneration fields', () => {
		const branch = {
			id: 'branch-1',
			title: 'Branch of Root',
			branchPointMessageId: 'msg-1'
		} as never;
		expect(branchArtifactMetadata(branch, 'recorded')).toEqual({
			mode: 'raw',
			sourceChatId: 'branch-1',
			sourceChatTitle: 'Branch of Root',
			branchPointMessageId: 'msg-1',
			anchor: 'recorded',
			summaryTraceId: null,
			regeneratedAt: null
		});
	});

	it('summary mode carries the trace id', () => {
		const branch = { id: 'branch-1', title: 'B', branchPointMessageId: null } as never;
		expect(
			branchArtifactMetadata(branch, 'derived', { mode: 'summary', summaryTraceId: 'trace-9' })
		).toMatchObject({ mode: 'summary', anchor: 'derived', summaryTraceId: 'trace-9' });
	});
});
