import { asc, desc, eq, isNull } from 'drizzle-orm';
import { chats, type Chat, type NewChat } from '$lib/db/schema';
import { getDb } from '$lib/db/driver/client';
import { now, uuid } from '$lib/db/ids';

async function insertChat(input: NewChat): Promise<Chat> {
	const [row] = await getDb().insert(chats).values(input).returning();
	return row!;
}

/** Chats repository — nodes in the conversation tree. */
export const chatsRepo = {
	async create(input: NewChat): Promise<Chat> {
		return insertChat(input);
	},

	/** Root chat: no parent, root = self, depth 0. */
	async createRoot(opts: { title: string; provider?: string; model?: string }): Promise<Chat> {
		const id = uuid();
		return insertChat({
			id,
			parentId: null,
			rootId: id,
			branchPointMessageId: null,
			title: opts.title,
			depth: 0,
			provider: opts.provider ?? null,
			model: opts.model ?? null,
			createdAt: now(),
			updatedAt: now()
		});
	},

	/** Branch a child off `parentId`, optionally at a fork-point message. */
	async createChild(opts: {
		parentId: string;
		branchPointMessageId?: string | null;
		title: string;
		provider?: string;
		model?: string;
	}): Promise<Chat> {
		const db = getDb();
		const parents = await db.select().from(chats).where(eq(chats.id, opts.parentId)).all();
		const parent = parents[0];
		if (!parent) throw new Error(`Parent chat ${opts.parentId} not found`);
		const id = uuid();
		return insertChat({
			id,
			parentId: opts.parentId,
			rootId: parent.rootId,
			branchPointMessageId: opts.branchPointMessageId ?? null,
			title: opts.title,
			depth: parent.depth + 1,
			provider: opts.provider ?? parent.provider ?? null,
			model: opts.model ?? parent.model ?? null,
			createdAt: now(),
			updatedAt: now()
		});
	},

	async getById(id: string): Promise<Chat | null> {
		const rows = await getDb().select().from(chats).where(eq(chats.id, id)).all();
		return rows[0] ?? null;
	},

	/** Top-level chats, most recently touched first. */
	async listRoots(): Promise<Chat[]> {
		return getDb()
			.select()
			.from(chats)
			.where(isNull(chats.parentId))
			.orderBy(desc(chats.updatedAt))
			.all();
	},

	/** Direct children of a chat (tree expansion). */
	async listChildren(parentId: string): Promise<Chat[]> {
		return getDb()
			.select()
			.from(chats)
			.where(eq(chats.parentId, parentId))
			.orderBy(asc(chats.createdAt))
			.all();
	},

	/** All descendants of a root (fast via root_id). Tree-walk primitive for P2. */
	async listSubtree(rootId: string): Promise<Chat[]> {
		return getDb()
			.select()
			.from(chats)
			.where(eq(chats.rootId, rootId))
			.orderBy(asc(chats.depth), asc(chats.createdAt))
			.all();
	},

	async updateTitle(id: string, title: string): Promise<void> {
		await getDb().update(chats).set({ title, updatedAt: now() }).where(eq(chats.id, id)).run();
	},

	async touch(id: string): Promise<void> {
		await getDb().update(chats).set({ updatedAt: now() }).where(eq(chats.id, id)).run();
	},

	async delete(id: string): Promise<void> {
		await getDb().delete(chats).where(eq(chats.id, id)).run();
	}
};
