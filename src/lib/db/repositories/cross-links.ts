import { eq, or } from 'drizzle-orm';
import { crossLinks, type CrossLink } from '$lib/db/schema';
import { getDb } from '$lib/db/driver/client';
import { now, uuid } from '$lib/db/ids';

async function insert(input: typeof crossLinks.$inferInsert): Promise<CrossLink> {
	const [row] = await getDb().insert(crossLinks).values(input).returning();
	return row!;
}

/** References between otherwise separate chats. */
export const crossLinksRepo = {
	async create(opts: { fromChatId: string; toChatId: string; note?: string }): Promise<CrossLink> {
		return insert({
			id: uuid(),
			fromChatId: opts.fromChatId,
			toChatId: opts.toChatId,
			note: opts.note ?? null,
			createdAt: now()
		});
	},

	async listForChat(chatId: string): Promise<CrossLink[]> {
		return getDb()
			.select()
			.from(crossLinks)
			.where(or(eq(crossLinks.fromChatId, chatId), eq(crossLinks.toChatId, chatId)))
			.all();
	},

	async delete(id: string): Promise<void> {
		await getDb().delete(crossLinks).where(eq(crossLinks.id, id)).run();
	}
};
