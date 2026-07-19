import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useFileTestDb } from '$lib/db/driver/pg-test';
import { runSelfCheck } from '$lib/db/self-check';
import { dbStatus } from '$lib/stores/db.svelte';

const testDb = useFileTestDb();
beforeAll(() => testDb.setup());
beforeEach(() => testDb.reset());
afterAll(() => testDb.teardown());

describe('boot-time self-check', () => {
	it('passes and leaves no stray row', async () => {
		await runSelfCheck();
		expect(dbStatus.selfCheck).toBe('pass');

		// The self-check row is created and deleted; none should remain.
		const keys = await import('$lib/db').then((m) =>
			m.getDriver().query("SELECT title FROM chats WHERE title = '__self_check__'")
		);
		expect(keys.rows).toHaveLength(0);
	});
});
