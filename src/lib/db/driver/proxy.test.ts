import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { chats } from '$lib/db/schema';
import { createDb } from '$lib/db/driver/proxy';
import { runMigrations } from '$lib/db/driver/migrator';
import { createMemoryDriver } from '$lib/db/driver/memory';
import migrations from '$lib/db/driver/migrations';

// This is the prototype verification the handover demanded: prove the proxy +
// fs-free migrator + bundled migration work together against the pinned drizzle
// version before any repository is built on top.
describe('storage seam (proxy + migrator + bundled migration)', () => {
	it('runs migrations clean on an empty DB', async () => {
		const driver = await createMemoryDriver();
		await expect(runMigrations(driver, migrations)).resolves.toBeUndefined();
	});

	it('creates all expected tables', async () => {
		const driver = await createMemoryDriver();
		await runMigrations(driver, migrations);
		const { rows } = await driver.query<string[]>(
			"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
		);
		const names = rows.map((r) => r[0]);
		for (const t of [
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
		const driver = await createMemoryDriver();
		await runMigrations(driver, migrations);
		const db = createDb(driver);

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
			})
			.run();

		const result = await db.select().from(chats).where(eq(chats.id, 'chat-1')).all();
		expect(result).toHaveLength(1);
		expect(result[0].title).toBe('Root chat');
		expect(result[0].rootId).toBe('chat-1');
		expect(result[0].depth).toBe(0);
		expect(result[0].parentId).toBeNull();
	});

	it('records applied migrations and is idempotent on re-run', async () => {
		const driver = await createMemoryDriver();
		await runMigrations(driver, migrations);
		const before = await driver.query<number[]>('SELECT count(*) FROM __drizzle_migrations');
		expect(Number(before.rows[0]?.[0] ?? 0)).toBe(1);

		// Re-running must not re-apply (already at the latest folderMillis).
		await runMigrations(driver, migrations);
		const after = await driver.query<number[]>('SELECT count(*) FROM __drizzle_migrations');
		expect(Number(after.rows[0]?.[0] ?? 0)).toBe(1);
	});
});
