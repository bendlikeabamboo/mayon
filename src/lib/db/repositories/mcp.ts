import { eq } from 'drizzle-orm';
import { chats } from '$lib/db/schema';
import { awaitDb } from '$lib/db/driver/client';
import { settingsRepo } from './settings';
import { now } from '$lib/db/ids';
import type { McpServerConfig, ChatMcpConfig } from '$lib/mcp/types';

const KEY = 'mcpServers';

export const mcpRepo = {
	async listServers(): Promise<McpServerConfig[]> {
		const map = (await settingsRepo.get<Record<string, McpServerConfig>>(KEY)) ?? {};
		return Object.values(map).sort((a, b) => a.createdAt - b.createdAt);
	},

	async getServer(id: string): Promise<McpServerConfig | null> {
		const map = (await settingsRepo.get<Record<string, McpServerConfig>>(KEY)) ?? {};
		return map[id] ?? null;
	},

	async saveServers(map: Record<string, McpServerConfig>): Promise<void> {
		await settingsRepo.set(KEY, map);
	},

	async upsertServer(config: McpServerConfig): Promise<void> {
		const map = (await settingsRepo.get<Record<string, McpServerConfig>>(KEY)) ?? {};
		map[config.id] = config;
		await settingsRepo.set(KEY, map);
	},

	async deleteServer(id: string): Promise<void> {
		const map = (await settingsRepo.get<Record<string, McpServerConfig>>(KEY)) ?? {};
		delete map[id];
		await settingsRepo.set(KEY, map);
	},

	async getChatMcpConfig(chatId: string): Promise<ChatMcpConfig | null> {
		const rows = await (await awaitDb())
			.select({ mcpConfig: chats.mcpConfig })
			.from(chats)
			.where(eq(chats.id, chatId))
			.all();
		const raw = rows[0]?.mcpConfig;
		if (!raw) return null;
		try {
			return JSON.parse(raw) as ChatMcpConfig;
		} catch {
			return null;
		}
	},

	async setChatMcpConfig(chatId: string, cfg: ChatMcpConfig | null): Promise<void> {
		await (
			await awaitDb()
		)
			.update(chats)
			.set({ mcpConfig: cfg ? JSON.stringify(cfg) : null, updatedAt: now() })
			.where(eq(chats.id, chatId))
			.run();
	}
};
