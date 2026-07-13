import { eq } from 'drizzle-orm';
import { branchSources, type BranchSource } from '$lib/db/schema';
import { awaitDb } from '$lib/db/driver/client';
import { now, uuid } from '$lib/db/ids';

async function insert(input: typeof branchSources.$inferInsert): Promise<BranchSource> {
	const [row] = await (await awaitDb()).insert(branchSources).values(input).returning();
	return row!;
}

/** Records the exact span a branch originated from (traceability). */
export const branchSourcesRepo = {
	async create(opts: {
		sourceMessageId: string;
		startChar: number;
		endChar: number;
		excerpt: string;
		branchChatId: string;
		customInstructions?: string;
		addFormats?: string;
	}): Promise<BranchSource> {
		return insert({
			id: uuid(),
			sourceMessageId: opts.sourceMessageId,
			startChar: opts.startChar,
			endChar: opts.endChar,
			excerpt: opts.excerpt,
			branchChatId: opts.branchChatId,
			customInstructions: opts.customInstructions ?? null,
			addFormats: opts.addFormats ?? null,
			createdAt: now()
		});
	},

	async getByBranchChat(branchChatId: string): Promise<BranchSource | null> {
		const rows = await (await awaitDb())
			.select()
			.from(branchSources)
			.where(eq(branchSources.branchChatId, branchChatId));
		return rows[0] ?? null;
	},

	async listBySourceMessage(sourceMessageId: string): Promise<BranchSource[]> {
		return (await awaitDb())
			.select()
			.from(branchSources)
			.where(eq(branchSources.sourceMessageId, sourceMessageId));
	}
};
