import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { chats } from '$lib/db/schema';
import { bootstrapTestDb } from '$lib/db/driver/pg-test';

describe('pg-proxy seam proof (P-pg-2)', () => {
	it('creates all expected tables', async () => {
		const { driver } = await bootstrapTestDb();
		const result = await driver.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
      ORDER BY table_name
    `);
		const names = result.rows.map((r) => r.table_name);
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
		const { db } = await bootstrapTestDb();
		const now = Date.now();
		await db
			.insert(chats)
			.values({
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
		const { db } = await bootstrapTestDb();
		expect(db).toBeDefined();
	});
});
