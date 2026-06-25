import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapWithDriver } from '$lib/db/driver/client';
import { createMemoryDriver } from '$lib/db/driver/memory';
import { runSelfCheck } from '$lib/db/self-check';
import { dbStatus } from '$lib/stores/db.svelte';

beforeEach(async () => {
	await bootstrapWithDriver(await createMemoryDriver());
});

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
