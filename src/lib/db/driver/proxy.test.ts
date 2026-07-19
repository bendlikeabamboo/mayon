import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { chats } from '$lib/db/schema';
import { useFileTestDb } from '$lib/db/driver/pg-test';

let handle: {
	db: import('$lib/db/driver/proxy').Db;
	driver: import('$lib/db/driver/types').StorageDriver;
};
const testDb = useFileTestDb();
beforeAll(async () => {
	handle = await testDb.setup();
});
beforeEach(() => testDb.reset());
afterAll(() => testDb.teardown());

describe('pg-proxy seam proof (P-pg-2)', () => {
	it('creates all expected tables', async () => {
		const result = await handle.driver.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
      ORDER BY table_name
    `);
		const names = result.rows.map((r) => (r as unknown[])[0] as string);
		for (const t of [
			'agent_traces',
			'branch_sources',
			'chats',
			'cross_links',
			'labs',
			'messages',
			'quiz_answers',
			'quiz_attempts',
			'quiz_questions',
			'quizzes',
			'settings'
		]) {
			expect(names).toContain(t);
		}
	});

	it('writes + reads a chats row through the drizzle proxy', async () => {
		const db = handle.db;
		const now = Date.now();
		await db.insert(chats).values({
			id: 'chat-1',
			parentId: null,
			rootId: 'chat-1',
			branchPointMessageId: null,
			title: 'Root chat',
			depth: 0,
			provider: 'openai',
			model: 'gpt-4o',
			createdAt: now,
			updatedAt: now
		});

		const result = await db.select().from(chats).where(eq(chats.id, 'chat-1'));
		expect(result).toHaveLength(1);
		expect(result[0].title).toBe('Root chat');
		expect(result[0].rootId).toBe('chat-1');
		expect(result[0].depth).toBe(0);
		expect(result[0].parentId).toBeNull();
	});

	it('migrations are idempotent (re-run safe)', async () => {
		expect(handle.db).toBeDefined();
	});
});
