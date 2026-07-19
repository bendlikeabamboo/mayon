import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useFileTestDb } from '$lib/db/driver/pg-test';
import { repos } from '$lib/db';
import type { McpServerConfig, ChatMcpConfig, McpAttachedResource } from '$lib/mcp/types';

const testDb = useFileTestDb();
beforeAll(() => testDb.setup());
beforeEach(() => testDb.reset());
afterAll(() => testDb.teardown());

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

describe('mcpRepo — per-chat attachments', () => {
	it('returns empty array when no attachments', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		expect(await repos.mcp.listAttachments(chat.id)).toEqual([]);
	});

	it('round-trips addAttachment → listAttachments', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		const att: McpAttachedResource = {
			serverId: 'srv-1',
			serverName: 'My Server',
			uri: 'file:///readme.md',
			name: 'readme.md',
			content: 'Hello world',
			attachedAt: 1000
		};
		await repos.mcp.addAttachment(chat.id, att);

		const list = await repos.mcp.listAttachments(chat.id);
		expect(list).toHaveLength(1);
		expect(list[0]).toEqual(att);
	});

	it('re-attach overwrites existing entry with same serverId+uri', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		const att1: McpAttachedResource = {
			serverId: 'srv-1',
			serverName: 'S1',
			uri: 'file:///a.txt',
			name: 'a.txt',
			content: 'old content',
			attachedAt: 1000
		};
		const att2: McpAttachedResource = {
			serverId: 'srv-1',
			serverName: 'S1',
			uri: 'file:///a.txt',
			name: 'a.txt',
			content: 'new content',
			attachedAt: 2000
		};
		await repos.mcp.addAttachment(chat.id, att1);
		await repos.mcp.addAttachment(chat.id, att2);

		const list = await repos.mcp.listAttachments(chat.id);
		expect(list).toHaveLength(1);
		expect(list[0].content).toBe('new content');
		expect(list[0].attachedAt).toBe(2000);
	});

	it('removeAttachment removes by serverId+uri', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		await repos.mcp.addAttachment(chat.id, {
			serverId: 'srv-1',
			serverName: 'S1',
			uri: 'file:///a.txt',
			name: 'a.txt',
			content: 'content a',
			attachedAt: 1000
		});
		await repos.mcp.addAttachment(chat.id, {
			serverId: 'srv-1',
			serverName: 'S1',
			uri: 'file:///b.txt',
			name: 'b.txt',
			content: 'content b',
			attachedAt: 1000
		});

		await repos.mcp.removeAttachment(chat.id, 'srv-1', 'file:///a.txt');
		const list = await repos.mcp.listAttachments(chat.id);
		expect(list).toHaveLength(1);
		expect(list[0].uri).toBe('file:///b.txt');
	});

	it('clearAttachments empties all', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		await repos.mcp.addAttachment(chat.id, {
			serverId: 'srv-1',
			serverName: 'S1',
			uri: 'file:///a.txt',
			name: 'a.txt',
			content: 'content',
			attachedAt: 1000
		});

		await repos.mcp.clearAttachments(chat.id);
		expect(await repos.mcp.listAttachments(chat.id)).toEqual([]);
	});

	it('attachments are per-chat isolated', async () => {
		const chat1 = await repos.chats.createRoot({ title: 'C1' });
		const chat2 = await repos.chats.createRoot({ title: 'C2' });
		await repos.mcp.addAttachment(chat1.id, {
			serverId: 'srv-1',
			serverName: 'S1',
			uri: 'file:///a.txt',
			name: 'a.txt',
			content: 'content',
			attachedAt: 1000
		});

		expect(await repos.mcp.listAttachments(chat1.id)).toHaveLength(1);
		expect(await repos.mcp.listAttachments(chat2.id)).toHaveLength(0);
	});
});
