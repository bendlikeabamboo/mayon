import { desc, eq } from 'drizzle-orm';
import { labs, type Lab } from '$lib/db/schema';
import { awaitDb } from '$lib/db/driver/client';
import { now, uuid } from '$lib/db/ids';
import { agentTracesRepo } from './agent-traces';

export interface LabChecklistItem {
	id: string;
	text: string;
	done: boolean;
}

function parseChecklist(raw: string): LabChecklistItem[] {
	try {
		const v = JSON.parse(raw);
		return Array.isArray(v) ? (v as LabChecklistItem[]) : [];
	} catch {
		return [];
	}
}

async function update(id: string, patch: Partial<typeof labs.$inferInsert>): Promise<void> {
	await (
		await awaitDb()
	)
		.update(labs)
		.set({ ...patch, updatedAt: now() })
		.where(eq(labs.id, id));
}

export const labsRepo = {
	async create(opts: {
		chatId: string;
		title: string;
		content: string;
		checklist?: LabChecklistItem[];
		model?: string;
	}): Promise<Lab> {
		const [row] = await (
			await awaitDb()
		)
			.insert(labs)
			.values({
				id: uuid(),
				chatId: opts.chatId,
				title: opts.title,
				content: opts.content,
				checklist: JSON.stringify(opts.checklist ?? []),
				model: opts.model ?? null,
				createdAt: now(),
				updatedAt: now()
			})
			.returning();
		return row!;
	},

	async getById(id: string): Promise<Lab | null> {
		const rows = await (await awaitDb()).select().from(labs).where(eq(labs.id, id));
		return rows[0] ?? null;
	},

	async listByChat(chatId: string): Promise<Lab[]> {
		return (await awaitDb()).select().from(labs).where(eq(labs.chatId, chatId));
	},

	async listAll(): Promise<Lab[]> {
		return (await awaitDb()).select().from(labs).orderBy(desc(labs.createdAt));
	},

	async updateContent(id: string, content: string): Promise<void> {
		await update(id, { content });
	},

	async setChecklist(id: string, checklist: LabChecklistItem[]): Promise<void> {
		await update(id, { checklist: JSON.stringify(checklist) });
	},

	async toggleChecklistItem(id: string, itemId: string): Promise<LabChecklistItem[] | null> {
		const lab = await this.getById(id);
		if (!lab) return null;
		const list = parseChecklist(lab.checklist).map((i) =>
			i.id === itemId ? { ...i, done: !i.done } : i
		);
		await this.setChecklist(id, list);
		return list;
	},

	async delete(id: string): Promise<void> {
		try {
			await agentTracesRepo.deleteByLab(id);
		} catch {
			/* best-effort cascade */
		}
		await (await awaitDb()).delete(labs).where(eq(labs.id, id));
	},

	parseChecklist
};
