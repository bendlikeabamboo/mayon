import { asc, desc, eq, isNull } from 'drizzle-orm';
import { chats, type Chat, type NewChat } from '$lib/db/schema';
import { awaitDb, getDriver } from '$lib/db/driver/client';
import { now, uuid } from '$lib/db/ids';
import type { LearningBrief } from '$lib/chat/brief';

async function insertChat(input: NewChat): Promise<Chat> {
	const [row] = await (await awaitDb()).insert(chats).values(input).returning();
	return row!;
}

/** Chats repository — nodes in the conversation tree. */
export const chatsRepo = {
	async create(input: NewChat): Promise<Chat> {
		return insertChat(input);
	},

	/** Root chat: no parent, root = self, depth 0. */
	async createRoot(opts: {
		title: string;
		provider?: string;
		model?: string;
		/** Learning brief authored on the root (null/omit = brief-less chat). */
		brief?: LearningBrief | null;
	}): Promise<Chat> {
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
			brief: opts.brief ? JSON.stringify(opts.brief) : null,
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
		const db = await awaitDb();
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
		const rows = await (await awaitDb()).select().from(chats).where(eq(chats.id, id)).all();
		return rows[0] ?? null;
	},

	/** Top-level chats, most recently touched first. */
	async listRoots(): Promise<Chat[]> {
		return (await awaitDb())
			.select()
			.from(chats)
			.where(isNull(chats.parentId))
			.orderBy(desc(chats.updatedAt))
			.all();
	},

	/** Direct children of a chat (tree expansion). */
	async listChildren(parentId: string): Promise<Chat[]> {
		return (await awaitDb())
			.select()
			.from(chats)
			.where(eq(chats.parentId, parentId))
			.orderBy(asc(chats.createdAt))
			.all();
	},

	/** All descendants of a root (fast via root_id). Tree-walk primitive for P2. */
	async listSubtree(rootId: string): Promise<Chat[]> {
		return (await awaitDb())
			.select()
			.from(chats)
			.where(eq(chats.rootId, rootId))
			.orderBy(asc(chats.depth), asc(chats.createdAt))
			.all();
	},

	async updateTitle(id: string, title: string): Promise<void> {
		await (await awaitDb())
			.update(chats)
			.set({ title, updatedAt: now() })
			.where(eq(chats.id, id))
			.run();
	},

	/**
	 * Set (or clear) a root's Learning Brief. Pass `null` to clear. Storing a
	 * brief JSON-serializes it; `parseBrief` is the safe inverse. Branches never
	 * have their own brief (they inherit the root's), so this is root-only.
	 */
	async updateBrief(id: string, brief: LearningBrief | null): Promise<void> {
		const json = brief ? JSON.stringify(brief) : null;
		await (await awaitDb())
			.update(chats)
			.set({ brief: json, updatedAt: now() })
			.where(eq(chats.id, id))
			.run();
	},

	async touch(id: string): Promise<void> {
		await (await awaitDb()).update(chats).set({ updatedAt: now() }).where(eq(chats.id, id)).run();
	},

	async delete(id: string): Promise<void> {
		await (await awaitDb()).delete(chats).where(eq(chats.id, id)).run();
	},

	/**
	 * Delete an entire conversation tree (root + all descendants) and every
	 * artifact attached to it: messages, branch_sources, labs, quizzes (+ their
	 * questions/attempts/answers), and cross_links. Run as one batched
	 * transaction in leaf→root dependency order so the `ON DELETE NO ACTION` FKs
	 * never trip. `rootId` is the conversation root (for a root chat, its own id).
	 */
	async deleteSubtree(rootId: string): Promise<void> {
		const driver = getDriver();
		await driver.batch([
			// Quizzes: answers → attempts → questions → quizzes.
			{
				sql: 'DELETE FROM quiz_answers WHERE question_id IN (SELECT qq.id FROM quiz_questions qq JOIN quizzes qz ON qz.id = qq.quiz_id JOIN chats c ON c.id = qz.chat_id WHERE c.root_id = ?)',
				params: [rootId]
			},
			{
				sql: 'DELETE FROM quiz_attempts WHERE quiz_id IN (SELECT qz.id FROM quizzes qz JOIN chats c ON c.id = qz.chat_id WHERE c.root_id = ?)',
				params: [rootId]
			},
			{
				sql: 'DELETE FROM quiz_questions WHERE quiz_id IN (SELECT qz.id FROM quizzes qz JOIN chats c ON c.id = qz.chat_id WHERE c.root_id = ?)',
				params: [rootId]
			},
			{
				sql: 'DELETE FROM quizzes WHERE chat_id IN (SELECT id FROM chats WHERE root_id = ?)',
				params: [rootId]
			},
			{
				sql: 'DELETE FROM labs WHERE chat_id IN (SELECT id FROM chats WHERE root_id = ?)',
				params: [rootId]
			},
			// branch_sources reference both a message and a chat in the subtree.
			{
				sql: 'DELETE FROM branch_sources WHERE branch_chat_id IN (SELECT id FROM chats WHERE root_id = ?)',
				params: [rootId]
			},
			{
				sql: 'DELETE FROM branch_sources WHERE source_message_id IN (SELECT m.id FROM messages m JOIN chats c ON c.id = m.chat_id WHERE c.root_id = ?)',
				params: [rootId]
			},
			// chats.branch_point_message_id → messages forms a cycle with
			// messages.chat_id → chats. Clear the (nullable) branch-point
			// reference on subtree chats before deleting messages, so removing
			// a branched message can't trip a chats→messages FK. (A child's
			// branch point always lives within its own subtree.)
			{
				sql: 'UPDATE chats SET branch_point_message_id = NULL WHERE root_id = ?',
				params: [rootId]
			},
			{
				sql: 'DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE root_id = ?)',
				params: [rootId]
			},
			{
				sql: 'DELETE FROM cross_links WHERE from_chat_id IN (SELECT id FROM chats WHERE root_id = ?) OR to_chat_id IN (SELECT id FROM chats WHERE root_id = ?)',
				params: [rootId, rootId]
			},
			// Chats last (after every FK that points at them is gone).
			{
				sql: 'DELETE FROM chats WHERE root_id = ?',
				params: [rootId]
			}
		]);
	}
};
