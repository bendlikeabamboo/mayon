import { and, asc, desc, eq, lte } from 'drizzle-orm';
import { messages, type Message, type MessageRole } from '$lib/db/schema';
import { awaitDb } from '$lib/db/driver/client';
import { now, uuid } from '$lib/db/ids';
import {
	deriveKindFromColumns,
	type EntryKind,
	type MessagePart,
	type TextPart
} from '$lib/chat/kinds';

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
		opts?: {
			model?: string;
			tokens?: number;
			toolCallId?: string;
			toolName?: string;
			metadata?: string;
			kind?: EntryKind;
			parts?: MessagePart[];
		}
	): Promise<Message> {
		if (opts?.parts) {
			if (opts.parts.length === 0) {
				throw new Error('parts must contain at least one part');
			}
			const imageCount = opts.parts.filter((p) => p.type === 'image').length;
			if (imageCount > 8) {
				throw new Error('parts must contain at most 8 image parts');
			}
			const text = opts.parts
				.filter((p): p is TextPart => p.type === 'text')
				.map((p) => p.text)
				.join('');
			if (text !== content) {
				throw new Error('parts text parts must concatenate to content');
			}
		}
		const db = await awaitDb();
		const last = await db
			.select({ ord: messages.ord })
			.from(messages)
			.where(eq(messages.chatId, chatId))
			.orderBy(desc(messages.ord))
			.limit(1);
		const nextOrd = last.length ? last[0].ord + 1 : 0;
		const kind =
			opts?.kind ??
			deriveKindFromColumns({
				role,
				toolCallId: opts?.toolCallId ?? null,
				toolName: opts?.toolName ?? null
			});
		const input: typeof messages.$inferInsert = {
			id: uuid(),
			chatId,
			role,
			content,
			ord: nextOrd,
			kind,
			model: opts?.model ?? null,
			tokens: opts?.tokens ?? null,
			toolCallId: opts?.toolCallId ?? null,
			toolName: opts?.toolName ?? null,
			metadata: opts?.metadata ?? null,
			createdAt: now()
		};
		if (opts?.parts) input.parts = JSON.stringify(opts.parts);
		return insertMessage(input);
	},

	async appendToolResult(
		chatId: string,
		opts: { toolCallId: string; toolName: string; summary: string; detail?: unknown; ok?: boolean }
	): Promise<Message> {
		const hasDetail = opts.detail != null;
		const hasOk = opts.ok !== undefined;
		const metadata =
			hasDetail || hasOk
				? JSON.stringify({ ...(opts.detail ?? {}), ...(hasOk ? { ok: opts.ok } : {}) })
				: undefined;
		return this.append(chatId, 'tool', opts.summary, {
			toolCallId: opts.toolCallId,
			toolName: opts.toolName,
			metadata,
			kind: 'tool_result'
		});
	},

	/** All messages of a chat in display order. */
	async listByChat(chatId: string): Promise<Message[]> {
		return (await awaitDb())
			.select()
			.from(messages)
			.where(eq(messages.chatId, chatId))
			.orderBy(asc(messages.ord));
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
		return db.select().from(messages).where(cond).orderBy(asc(messages.ord));
	},

	async getById(id: string): Promise<Message | null> {
		const rows = await (await awaitDb()).select().from(messages).where(eq(messages.id, id));
		return rows[0] ?? null;
	},

	async updateOutcome(id: string, outcome: Record<string, unknown>): Promise<Message | null> {
		const db = await awaitDb();
		const [existing] = await db.select().from(messages).where(eq(messages.id, id));
		if (!existing) return null;
		let meta: Record<string, unknown> = {};
		if (existing.metadata) {
			try {
				meta = JSON.parse(existing.metadata);
			} catch {
				/* corrupt → default empty */
			}
		}
		meta.outcome = outcome;
		const [updated] = await db
			.update(messages)
			.set({ metadata: JSON.stringify(meta) })
			.where(eq(messages.id, id))
			.returning();
		return updated ?? null;
	},

	async delete(id: string): Promise<void> {
		await (await awaitDb()).delete(messages).where(eq(messages.id, id));
	},

	async deleteByChat(chatId: string): Promise<void> {
		await (await awaitDb()).delete(messages).where(eq(messages.chatId, chatId));
	}
};
