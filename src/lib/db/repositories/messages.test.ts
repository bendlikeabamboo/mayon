import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useFileTestDb } from '$lib/db/driver/pg-test';
import { repos } from '$lib/db';
import type { BranchArtifactMetadata } from '$lib/chat/kinds';

const testDb = useFileTestDb();
beforeAll(() => testDb.setup());
beforeEach(() => testDb.reset());
afterAll(() => testDb.teardown());

function artifactMeta(overrides?: Partial<BranchArtifactMetadata>): string {
	const meta: BranchArtifactMetadata = {
		mode: 'raw',
		sourceChatId: 'branch-1',
		sourceChatTitle: 'Branch',
		branchPointMessageId: null,
		anchor: 'recorded',
		summaryTraceId: null,
		regeneratedAt: null,
		...overrides
	};
	return JSON.stringify(meta);
}

/** Two-turn chat with ords 0 and 1; returns the anchor ("a") and next ("b") rows. */
async function seedChat(title = 'C') {
	const chat = await repos.chats.createRoot({ title });
	const a = await repos.messages.append(chat.id, 'user', 'a');
	const b = await repos.messages.append(chat.id, 'assistant', 'b');
	return { chat, a, b };
}

describe('insertAnchored — placement math', () => {
	it('midpoint between two rows: (afterOrd + beforeOrd) / 2', async () => {
		const { chat, a, b } = await seedChat();
		const art = await repos.messages.insertAnchored(
			chat.id,
			{ role: 'user', content: 'artifact', kind: 'branch_artifact', metadata: artifactMeta() },
			{ afterOrd: a.ord, beforeOrd: b.ord }
		);
		expect(art.ord).toBe(0.5);
		expect(art.kind).toBe('branch_artifact');
		expect(art.role).toBe('user');
		// Neighbors untouched.
		expect((await repos.messages.getById(a.id))?.ord).toBe(0);
		expect((await repos.messages.getById(b.id))?.ord).toBe(1);
	});

	it('beforeOrd: null places after the anchor row (afterOrd + 1)', async () => {
		const { chat, a, b } = await seedChat();
		const art = await repos.messages.insertAnchored(
			chat.id,
			{ role: 'user', content: 'artifact', kind: 'branch_artifact' },
			{ afterOrd: b.ord, beforeOrd: null }
		);
		expect(art.ord).toBe(2);
		expect((await repos.messages.getById(a.id))?.ord).toBe(0);
	});

	it("'start' places before the first row (minOrd − 1)", async () => {
		const { chat, a } = await seedChat();
		const art = await repos.messages.insertAnchored(
			chat.id,
			{ role: 'user', content: 'artifact', kind: 'branch_artifact' },
			'start'
		);
		expect(art.ord).toBe(-1);
		expect((await repos.messages.getById(a.id))?.ord).toBe(0);
	});

	it("'start' on an empty chat uses ord 0", async () => {
		const chat = await repos.chats.createRoot({ title: 'Empty' });
		const art = await repos.messages.insertAnchored(
			chat.id,
			{ role: 'user', content: 'artifact', kind: 'branch_artifact' },
			'start'
		);
		expect(art.ord).toBe(0);
	});
});

describe('anchored rows in listByChat / listUpToOrd', () => {
	it('fractional ord persists and rows order anchored: a, artifact, b', async () => {
		const { chat, a, b } = await seedChat();
		const art = await repos.messages.insertAnchored(
			chat.id,
			{ role: 'user', content: 'artifact', kind: 'branch_artifact' },
			{ afterOrd: a.ord, beforeOrd: b.ord }
		);

		const list = await repos.messages.listByChat(chat.id);
		expect(list.map((m) => m.id)).toEqual([a.id, art.id, b.id]);
		expect(list[1]!.ord).toBe(0.5);
		// Artifact sits exactly between its anchor and the next message.
		expect(list[1]!.ord).toBeGreaterThan(a.ord);
		expect(list[1]!.ord).toBeLessThan(b.ord);
	});

	it('listUpToOrd cutoffs include the anchored artifact at its position', async () => {
		const { chat, a, b } = await seedChat();
		const art = await repos.messages.insertAnchored(
			chat.id,
			{ role: 'user', content: 'artifact', kind: 'branch_artifact' },
			{ afterOrd: a.ord, beforeOrd: b.ord }
		);

		expect((await repos.messages.listUpToOrd(chat.id, 0)).map((m) => m.id)).toEqual([a.id]);
		expect((await repos.messages.listUpToOrd(chat.id, 0.5)).map((m) => m.id)).toEqual([
			a.id,
			art.id
		]);
		expect((await repos.messages.listUpToOrd(chat.id, 1)).map((m) => m.id)).toEqual([
			a.id,
			art.id,
			b.id
		]);
		expect(await repos.messages.listUpToOrd(chat.id, null)).toHaveLength(3);
	});
});

describe('append after anchored inserts', () => {
	it('still allocates max(ord) + 1 (integral), after the whole thread', async () => {
		const { chat, a, b } = await seedChat();
		await repos.messages.insertAnchored(
			chat.id,
			{ role: 'user', content: 'artifact', kind: 'branch_artifact' },
			{ afterOrd: a.ord, beforeOrd: b.ord }
		);
		const next = await repos.messages.append(chat.id, 'user', 'after artifact');
		expect(next.ord).toBe(2);

		const list = await repos.messages.listByChat(chat.id);
		expect(list.map((m) => m.content)).toEqual(['a', 'artifact', 'b', 'after artifact']);
	});

	it("max — not row count — wins when a 'start' artifact shifted the minimum", async () => {
		const { chat } = await seedChat();
		await repos.messages.insertAnchored(
			chat.id,
			{ role: 'user', content: 'artifact', kind: 'branch_artifact' },
			'start'
		);
		const next = await repos.messages.append(chat.id, 'user', 'tail');
		expect(next.ord).toBe(2);
		expect((await repos.messages.listByChat(chat.id)).map((m) => m.ord)).toEqual([-1, 0, 1, 2]);
	});
});

describe('updateArtifactContent', () => {
	it('updates content and merges the metadata patch on a branch_artifact row', async () => {
		const { chat } = await seedChat();
		const art = await repos.messages.insertAnchored(
			chat.id,
			{
				role: 'user',
				content: 'original',
				kind: 'branch_artifact',
				metadata: artifactMeta({ mode: 'summary', summaryTraceId: 'trace-1' })
			},
			{ afterOrd: 0, beforeOrd: 1 }
		);

		const updated = await repos.messages.updateArtifactContent(art.id, 'regenerated summary', {
			regeneratedAt: '2026-09-06T00:00:00.000Z',
			mode: 'summary'
		});
		expect(updated).not.toBeNull();
		expect(updated!.id).toBe(art.id);
		expect(updated!.content).toBe('regenerated summary');
		// ord and anchor are unchanged by a content update.
		expect(updated!.ord).toBe(art.ord);

		const meta = JSON.parse(updated!.metadata!) as BranchArtifactMetadata;
		expect(meta.mode).toBe('summary');
		expect(meta.summaryTraceId).toBe('trace-1');
		expect(meta.sourceChatTitle).toBe('Branch');
		expect(meta.regeneratedAt).toBe('2026-09-06T00:00:00.000Z');
	});

	it('refuses a non-artifact row: returns null and leaves the row unchanged', async () => {
		const { chat, a } = await seedChat();
		const updated = await repos.messages.updateArtifactContent(a.id, 'overwritten', {
			mode: 'summary'
		});
		expect(updated).toBeNull();

		const row = await repos.messages.getById(a.id);
		expect(row!.content).toBe('a');
		expect(row!.metadata).toBeNull();
		expect(row!.kind).toBe('user_message');
		expect(await repos.messages.listByChat(chat.id)).toHaveLength(2);
	});

	it('returns null for a missing id', async () => {
		const result = await repos.messages.updateArtifactContent('nonexistent', 'x', {});
		expect(result).toBeNull();
	});
});

describe('migration 0004 — double precision ord', () => {
	it('fresh test database applies the migration: ord is double precision', async () => {
		const handle = await testDb.setup();
		const res = await handle.driver.query(
			`SELECT data_type FROM information_schema.columns
			 WHERE table_name = 'messages' AND column_name = 'ord'`
		);
		expect((res.rows[0] as unknown[])[0]).toBe('double precision');
	});

	it('fractional ord round-trips exactly through insert and read', async () => {
		const { chat, a, b } = await seedChat();
		const art = await repos.messages.insertAnchored(
			chat.id,
			{ role: 'user', content: 'artifact', kind: 'branch_artifact' },
			{ afterOrd: a.ord, beforeOrd: b.ord }
		);
		const reread = await repos.messages.getById(art.id);
		expect(reread?.ord).toBe(0.5);

		const nested = await repos.messages.insertAnchored(
			chat.id,
			{ role: 'user', content: 'nested', kind: 'branch_artifact' },
			{ afterOrd: a.ord, beforeOrd: art.ord }
		);
		expect((await repos.messages.getById(nested.id))?.ord).toBe(0.25);
	});
});
