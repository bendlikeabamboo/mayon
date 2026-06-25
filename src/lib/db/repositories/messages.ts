import { and, asc, desc, eq, lte } from 'drizzle-orm';
import { messages, type Message, type MessageRole } from '$lib/db/schema';
import { awaitDb } from '$lib/db/driver/client';
import { now, uuid } from '$lib/db/ids';

async function insertMessage(input: typeof messages.$inferInsert): Promise<Message> {
	const [row] = await (await awaitDb()).insert(messages).values(input).returning();
	return row!;
}

/** Messages repository — content of a single chat, ordered by `ord`. */
export const messagesRepo = {
	/** Append a message with the next `ord` computed automatically. */
	async append(
		chatId: string,
		role: MessageRole,
		content: string,
		opts?: { model?: string; tokens?: number }
	): Promise<Message> {
		const db = await awaitDb();
		const last = await db
			.select({ ord: messages.ord })
			.from(messages)
			.where(eq(messages.chatId, chatId))
			.orderBy(desc(messages.ord))
			.limit(1)
			.all();
		const nextOrd = last.length ? last[0].ord + 1 : 0;
		return insertMessage({
			id: uuid(),
			chatId,
			role,
			content,
			ord: nextOrd,
			model: opts?.model ?? null,
			tokens: opts?.tokens ?? null,
			createdAt: now()
		});
	},

	/** All messages of a chat in display order. */
	async listByChat(chatId: string): Promise<Message[]> {
		return (await awaitDb())
			.select()
			.from(messages)
			.where(eq(messages.chatId, chatId))
			.orderBy(asc(messages.ord))
			.all();
	},

	/**
	 * Ancestor context primitive for reference-based branching (assembleContext, P2):
	 * a chat's own messages up to an `ord` cutoff (inclusive).
	 */
	async listUpToOrd(chatId: string, cutoffOrd: number | null): Promise<Message[]> {
		const db = await awaitDb();
		const cond =
			cutoffOrd == null
				? eq(messages.chatId, chatId)
				: and(eq(messages.chatId, chatId), lte(messages.ord, cutoffOrd));
		return db.select().from(messages).where(cond).orderBy(asc(messages.ord)).all();
	},

	async getById(id: string): Promise<Message | null> {
		const rows = await (await awaitDb()).select().from(messages).where(eq(messages.id, id)).all();
		return rows[0] ?? null;
	},

	async delete(id: string): Promise<void> {
		await (await awaitDb()).delete(messages).where(eq(messages.id, id)).run();
	},

	async deleteByChat(chatId: string): Promise<void> {
		await (await awaitDb()).delete(messages).where(eq(messages.chatId, chatId)).run();
	}
};
