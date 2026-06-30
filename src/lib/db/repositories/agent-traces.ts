import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { agentTraces, type AgentTrace } from '$lib/db/schema';
import { awaitDb, getDriver } from '$lib/db/driver/client';
import { now, uuid } from '$lib/db/ids';

export const agentTracesRepo = {
	async listByChat(chatId: string, kinds?: string[] | null): Promise<AgentTrace[]> {
		const conditions: SQL[] = [eq(agentTraces.chatId, chatId)];
		if (kinds?.length) {
			conditions.push(
				kinds.length === 1 ? eq(agentTraces.kind, kinds[0]!) : inArray(agentTraces.kind, kinds)
			);
		}
		return (await awaitDb())
			.select()
			.from(agentTraces)
			.where(and(...conditions))
			.orderBy(desc(agentTraces.createdAt))
			.all();
	},

	async listByLab(labId: string): Promise<AgentTrace[]> {
		return (await awaitDb())
			.select()
			.from(agentTraces)
			.where(eq(agentTraces.labId, labId))
			.orderBy(desc(agentTraces.createdAt))
			.all();
	},

	async listByQuiz(quizId: string): Promise<AgentTrace[]> {
		return (await awaitDb())
			.select()
			.from(agentTraces)
			.where(eq(agentTraces.quizId, quizId))
			.orderBy(desc(agentTraces.createdAt))
			.all();
	},

	async create(input: typeof agentTraces.$inferInsert): Promise<AgentTrace> {
		const [row] = await (
			await awaitDb()
		)
			.insert(agentTraces)
			.values({ ...input, id: uuid(), createdAt: now() })
			.returning();
		return row!;
	},

	async getById(id: string): Promise<AgentTrace | null> {
		const rows = await (await awaitDb())
			.select()
			.from(agentTraces)
			.where(eq(agentTraces.id, id))
			.all();
		return rows[0] ?? null;
	},

	async deleteByChat(chatId: string): Promise<void> {
		await (await awaitDb()).delete(agentTraces).where(eq(agentTraces.chatId, chatId)).run();
	},

	async deleteByLab(labId: string): Promise<void> {
		await (await awaitDb()).delete(agentTraces).where(eq(agentTraces.labId, labId)).run();
	},

	async deleteByQuiz(quizId: string): Promise<void> {
		await (await awaitDb()).delete(agentTraces).where(eq(agentTraces.quizId, quizId)).run();
	},

	async deleteByRoot(rootId: string): Promise<void> {
		await getDriver().batch([
			{
				sql: 'DELETE FROM agent_traces WHERE chat_id IN (SELECT id FROM chats WHERE root_id = ?)',
				params: [rootId]
			}
		]);
	}
};
