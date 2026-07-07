import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapWithDriver } from '$lib/db/driver/client';
import { createMemoryDriver } from '$lib/db/driver/memory';
import { repos } from '$lib/db';
import type { McpServerConfig, ChatMcpConfig } from '$lib/mcp/types';

beforeEach(async () => {
	await bootstrapWithDriver(await createMemoryDriver());
});

function makeServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
	return {
		id: overrides.id ?? 'srv-1',
		name: overrides.name ?? 'Test Server',
		transport: 'stdio',
		command: 'node',
		args: ['server.js'],
		enabled: true,
		createdAt: overrides.createdAt ?? 1000,
		...overrides
	};
}

describe('mcpRepo — server configs (settings KV)', () => {
	it('round-trips a server through saveServers → listServers → getServer', async () => {
		const server = makeServer();
		await repos.mcp.saveServers({ [server.id]: server });

		const list = await repos.mcp.listServers();
		expect(list).toHaveLength(1);
		expect(list[0]).toEqual(server);

		const fetched = await repos.mcp.getServer(server.id);
		expect(fetched).toEqual(server);
	});

	it('listServers returns empty array when no servers are stored', async () => {
		expect(await repos.mcp.listServers()).toEqual([]);
	});

	it('getServer returns null for unknown id', async () => {
		expect(await repos.mcp.getServer('nope')).toBeNull();
	});

	it('upsertServer adds a new server and updates an existing one', async () => {
		const s1 = makeServer({ id: 'a', name: 'Alpha' });
		await repos.mcp.upsertServer(s1);
		expect((await repos.mcp.listServers()).map((s) => s.name)).toEqual(['Alpha']);

		const s1Updated = makeServer({ id: 'a', name: 'Alpha v2' });
		await repos.mcp.upsertServer(s1Updated);
		expect(await repos.mcp.listServers()).toHaveLength(1);
		expect((await repos.mcp.getServer('a'))!.name).toBe('Alpha v2');
	});

	it('deleteServer removes a server', async () => {
		const a = makeServer({ id: 'a' });
		const b = makeServer({ id: 'b' });
		await repos.mcp.saveServers({ a: a, b: b });

		await repos.mcp.deleteServer('a');
		expect(await repos.mcp.getServer('a')).toBeNull();
		expect(await repos.mcp.listServers()).toHaveLength(1);
		expect((await repos.mcp.listServers())[0]!.id).toBe('b');
	});

	it('listServers sorts by createdAt ascending', async () => {
		await repos.mcp.saveServers({
			beta: makeServer({ id: 'beta', createdAt: 3000 }),
			alpha: makeServer({ id: 'alpha', createdAt: 1000 }),
			gamma: makeServer({ id: 'gamma', createdAt: 2000 })
		});

		const ids = (await repos.mcp.listServers()).map((s) => s.id);
		expect(ids).toEqual(['alpha', 'gamma', 'beta']);
	});
});

describe('mcpRepo — per-chat MCP config', () => {
	it('returns null on a fresh chat', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		expect(await repos.mcp.getChatMcpConfig(chat.id)).toBeNull();
	});

	it('setChatMcpConfig persists and re-reads', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		const cfg: ChatMcpConfig = {
			'srv-1': { enabled: true, tools: ['read_file'] },
			'srv-2': { enabled: false }
		};
		await repos.mcp.setChatMcpConfig(chat.id, cfg);

		const loaded = await repos.mcp.getChatMcpConfig(chat.id);
		expect(loaded).toEqual(cfg);
	});

	it('passing null clears back to inherit-all', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		await repos.mcp.setChatMcpConfig(chat.id, {
			'srv-1': { enabled: true }
		});
		expect(await repos.mcp.getChatMcpConfig(chat.id)).not.toBeNull();

		await repos.mcp.setChatMcpConfig(chat.id, null);
		expect(await repos.mcp.getChatMcpConfig(chat.id)).toBeNull();
	});
});
