import { eq, or } from 'drizzle-orm';
import { crossLinks, type CrossLink } from '#lib/db/schema.js';
import { awaitDb } from '#lib/db/driver/client.js';
import { now, uuid } from '#lib/db/ids.js';

async function insert(input: typeof crossLinks.$inferInsert): Promise<CrossLink> {
	const [row] = await (await awaitDb()).insert(crossLinks).values(input).returning();
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
		return (await awaitDb())
			.select()
			.from(crossLinks)
			.where(or(eq(crossLinks.fromChatId, chatId), eq(crossLinks.toChatId, chatId)));
	},

	async delete(id: string): Promise<void> {
		await (await awaitDb()).delete(crossLinks).where(eq(crossLinks.id, id));
	}
};
