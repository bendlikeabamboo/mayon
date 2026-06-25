import { chatsRepo } from './repositories';
import { dbStatus } from '$lib/stores/db.svelte';

/**
 * Boot-time DB self-check (the "persists across restart" demonstration vehicle).
 * Writes a `chats` row via the repository, reads it back, deletes it, and records
 * pass/fail on the global `dbStatus.selfCheck` state (consumed by the DbStatus badge).
 *
 * Gated to dev at the call site; safe to call in any runtime once bootstrapped.
 */
export async function runSelfCheck(): Promise<void> {
	dbStatus.selfCheck = 'pending';
	try {
		const chat = await chatsRepo.createRoot({ title: '__self_check__' });
		const got = await chatsRepo.getById(chat.id);
		if (!got || got.id !== chat.id) throw new Error('self-check read-back failed');
		await chatsRepo.delete(chat.id);
		dbStatus.selfCheck = 'pass';
		console.info('[mayon] DB self-check passed (chats write/read/delete)');
	} catch (err) {
		dbStatus.selfCheck = 'fail';
		console.error('[mayon] DB self-check failed', err);
	}
}
