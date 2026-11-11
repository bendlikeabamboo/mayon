import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useFileTestDb, type FileTestDb } from '#lib/db/driver/pg-test.js';
import { repos } from '#lib/db/index.js';
import {
	artifactParts,
	branchArtifactMetadata,
	buildRawDelta,
	buildRawPayload,
	acquirePropagationLatch,
	collectPropagatedImages,
	releasePropagationLatch,
	renderRawTurns,
	resolveAnchor,
	resolveExcerpt
} from './propagation';
import type { ImagePart } from '#lib/chat/kinds.js';

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

describe('image markers + propagated parts (030 T021)', () => {
	function img(tag: string): ImagePart {
		return {
			type: 'image',
			data: `data:image/png;base64,${tag}`,
			mimeType: 'image/png',
			width: 4,
			height: 4,
			bytes: 8
		};
	}

	it("inserts [image] markers at the images' positions inside the turn payload", async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const child = await seedBranch(parent.id, null);
		await repos.messages.append(child.id, 'assistant', 'first  then', {
			parts: [{ type: 'text', text: 'first ' }, img('A'), { type: 'text', text: ' then' }, img('B')]
		});

		expect(await buildRawDelta(child.id)).toBe('[assistant] first [image] then[image]');
	});

	it('collects image parts in turn order, capped at the first 8', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const child = await seedBranch(parent.id, null);
		const images = Array.from({ length: 9 }, (_, i) => img(`I${i}`));
		await repos.messages.append(child.id, 'assistant', 'five', {
			parts: [{ type: 'text', text: 'five' }, ...images.slice(0, 5)]
		});
		await repos.messages.append(child.id, 'assistant', 'four', {
			parts: [{ type: 'text', text: 'four' }, ...images.slice(5)]
		});

		const payload = await buildRawPayload(child.id);
		expect(payload.imageParts).toHaveLength(8);
		expect(payload.imageParts[0]!.data).toContain('I0');
		expect(payload.imageParts[7]!.data).toContain('I7');
	});

	it('branches without images render byte-identically and collect no parts', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const child = await seedBranch(parent.id, null);
		await repos.messages.append(child.id, 'user', 'plain question');

		expect(await buildRawPayload(child.id)).toEqual({
			content: '[user] plain question',
			imageParts: []
		});
	});

	it('artifactParts prepends the content text part and is undefined for image-less branches', () => {
		const content = '[user] x';
		expect(artifactParts(content, [img('A')])).toEqual([{ type: 'text', text: content }, img('A')]);
		expect(artifactParts(content, [])).toBeUndefined();
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

describe('propagation latch (027 T002)', () => {
	afterEach(() => releasePropagationLatch());

	it('single slot: second acquire fails, release re-arms it', () => {
		expect(acquirePropagationLatch()).toBe(true);
		expect(acquirePropagationLatch()).toBe(false);
		releasePropagationLatch();
		expect(acquirePropagationLatch()).toBe(true);
	});

	it('release-on-throw: finally-release lets the next attempt acquire', () => {
		const attempt = () => {
			try {
				throw new Error('boom');
			} finally {
				releasePropagationLatch();
			}
		};
		expect(acquirePropagationLatch()).toBe(true);
		expect(attempt).toThrow('boom');
		expect(acquirePropagationLatch()).toBe(true);
	});
});

describe('propagation chrome exclusion (037 US1)', () => {
	function img(tag: string): ImagePart {
		return {
			type: 'image',
			data: `data:image/png;base64,${tag}`,
			mimeType: 'image/png',
			width: 4,
			height: 4,
			bytes: 8
		};
	}

	/**
	 * One declined propagation attempt's chrome rows, exactly as the loop and
	 * approval flow persist them: the pre-execution tool_call row
	 * (appendAssistantToolCall — role assistant, content ''), the approval ask
	 * (kind 'approval'), and the declined tool_result row. All three carry
	 * toolName 'propagate_to_parent'.
	 */
	async function seedDeclinedAttempt(chatId: string, callId: string): Promise<void> {
		await repos.messages.append(chatId, 'assistant', '', {
			toolCallId: callId,
			toolName: 'propagate_to_parent',
			metadata: JSON.stringify({ mode: 'raw' })
		});
		await repos.messages.append(
			chatId,
			'assistant',
			'propagate_to_parent — back-propagate this branch',
			{
				kind: 'approval',
				toolCallId: callId,
				toolName: 'propagate_to_parent',
				metadata: JSON.stringify({
					toolName: 'propagate_to_parent',
					description: 'back-propagate this branch',
					args: {},
					outcome: null
				})
			}
		);
		await repos.messages.appendToolResult(chatId, {
			toolCallId: callId,
			toolName: 'propagate_to_parent',
			summary: 'user declined',
			ok: false
		});
	}

	it('buildRawDelta omits every propagate_to_parent row (tool_call, approval, declined tool_result) while other tools render verbatim', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const child = await seedBranch(parent.id, null);
		await repos.messages.append(child.id, 'user', 'run it');
		await seedDeclinedAttempt(child.id, 'tc-p1');
		await repos.messages.append(child.id, 'assistant', '', {
			toolCallId: 'tc-b1',
			toolName: 'bash'
		});
		await repos.messages.appendToolResult(child.id, {
			toolCallId: 'tc-b1',
			toolName: 'bash',
			summary: 'all green',
			detail: { exit: 0 }
		});
		await repos.messages.append(child.id, 'assistant', 'Done.');

		expect(await buildRawDelta(child.id)).toBe(
			['[user] run it', '[assistant] ', '[tool: bash] {"exit":0}', '[assistant] Done.'].join('\n')
		);
	});

	it('buildRawPayload excludes chrome rows from content and images — byte-identical to the content-only twin', async () => {
		// Twin: identical content rows, no chrome.
		const twinParent = await repos.chats.createRoot({ title: 'Twin root' });
		const twinAnchor = await repos.messages.append(twinParent.id, 'assistant', 'The anchor reply.');
		const twin = await seedBranch(twinParent.id, twinAnchor.id);
		await repos.branchSources.create({
			sourceMessageId: twinAnchor.id,
			startChar: 0,
			endChar: 9,
			excerpt: 'The anchor',
			branchChatId: twin.id
		});
		await repos.messages.append(twin.id, 'user', 'branch question');
		await repos.messages.append(twin.id, 'assistant', 'see  pic', {
			parts: [{ type: 'text', text: 'see ' }, img('REAL'), { type: 'text', text: ' pic' }]
		});

		// Chrome-bearing branch: same content + a declined attempt whose
		// tool_result row carries an image part (must not be collected).
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
		await repos.messages.append(child.id, 'assistant', 'see  pic', {
			parts: [{ type: 'text', text: 'see ' }, img('REAL'), { type: 'text', text: ' pic' }]
		});
		await seedDeclinedAttempt(child.id, 'tc-p1');
		// An even earlier attempt whose result row carries an image part —
		// chrome rows must not feed the collected image set either.
		await repos.messages.append(child.id, 'tool', 'user declined', {
			toolCallId: 'tc-p0',
			toolName: 'propagate_to_parent',
			kind: 'tool_result',
			metadata: JSON.stringify({ ok: false }),
			parts: [{ type: 'text', text: 'user declined' }, img('CHROME')]
		});

		const payload = await buildRawPayload(child.id);
		expect(payload.content).toBe(await buildRawDelta(twin.id));
		expect(payload.content).toBe(
			[
				'[excerpt]',
				'The anchor',
				'[/excerpt]',
				'',
				'[user] branch question',
				'[assistant] see [image] pic'
			].join('\n')
		);
		expect(payload.imageParts.map((p) => p.data)).toEqual([img('REAL').data]);
		expect(await collectPropagatedImages(child.id)).toEqual([img('REAL')]);
	});

	it('a branch whose rows are all chrome yields the empty-turns payload (excerpt rules unchanged)', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const child = await seedBranch(parent.id, null);
		await seedDeclinedAttempt(child.id, 'tc-p1');

		expect(await buildRawPayload(child.id)).toEqual({ content: '', imageParts: [] });
	});
});

describe('image dedupe (037 US5)', () => {
	function img(tag: string, name?: string): ImagePart {
		return {
			type: 'image',
			data: `data:image/png;base64,${tag}`,
			mimeType: 'image/png',
			width: 4,
			height: 4,
			bytes: 8,
			...(name === undefined ? {} : { name })
		};
	}

	/** Branch with `images` split across two rows (turn order preserved). */
	async function seedImages(images: ImagePart[]): Promise<string> {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const child = await seedBranch(parent.id, null);
		const mid = Math.ceil(images.length / 2);
		await repos.messages.append(child.id, 'assistant', 'first half', {
			parts: [{ type: 'text', text: 'first half' }, ...images.slice(0, mid)]
		});
		await repos.messages.append(child.id, 'assistant', 'second half', {
			parts: [{ type: 'text', text: 'second half' }, ...images.slice(mid)]
		});
		return child.id;
	}

	it('keeps one copy per distinct data — first occurrence wins, order preserved — in both collection paths', async () => {
		const chatId = await seedImages([
			img('A', 'first A'),
			img('B'),
			img('A', 'second A'),
			img('C'),
			img('B', 'second B')
		]);

		const collected = await collectPropagatedImages(chatId);
		expect(collected.map((p) => p.data)).toEqual([img('A').data, img('B').data, img('C').data]);
		expect(collected[0]).toEqual(img('A', 'first A'));

		expect((await buildRawPayload(chatId)).imageParts).toEqual(collected);
	});

	it('dedupe applies before the 8-image cap: duplicates within the first 8 do not crowd out the 9th distinct image', async () => {
		const chatId = await seedImages([
			img('A'),
			img('A'),
			img('B'),
			img('C'),
			img('D'),
			img('E'),
			img('F'),
			img('G'),
			img('H')
		]);

		const expected = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((t) => img(t).data);
		expect((await collectPropagatedImages(chatId)).map((p) => p.data)).toEqual(expected);
		expect((await buildRawPayload(chatId)).imageParts.map((p) => p.data)).toEqual(expected);
	});

	it('the cap still applies after dedupe: more than 8 distinct images keeps the first 8', async () => {
		const chatId = await seedImages(Array.from({ length: 10 }, (_, i) => img(`I${i}`)));

		const expected = Array.from({ length: 8 }, (_, i) => img(`I${i}`).data);
		expect((await collectPropagatedImages(chatId)).map((p) => p.data)).toEqual(expected);
		expect((await buildRawPayload(chatId)).imageParts.map((p) => p.data)).toEqual(expected);
	});
});
