import type { McpServerConfig, McpServerInfo, McpTool } from './types';
import { createMcpTransport } from './client-factory';
import { McpClient } from './client';
import { mountMcpServer } from './mount';
import { isTrusted } from './trust';
import { getToolDefinitions } from '$lib/agent/registry';

export interface McpServerStatus {
	connected: boolean;
	toolIds: string[];
	error?: string;
}

export interface McpRuntimeState {
	[serverId: string]: McpServerStatus;
}

export interface SpawnResult {
	client: McpClient;
	unmount: () => void;
}

export async function spawnAndMount(config: McpServerConfig): Promise<SpawnResult> {
	const trusted = await isTrusted(config);
	if (!trusted) {
		throw new Error('Server is not trusted. User must confirm trust before spawning.');
	}

	const transport = createMcpTransport(config);
	const client = new McpClient(transport);
	await client.initialize();

	const unmount = await mountMcpServer(config.id, client, {
		callTimeoutMs: config.callTimeoutMs,
		resultCapBytes: config.resultCapBytes
	});

	return { client, unmount };
}

export async function testConnection(
	config: McpServerConfig
): Promise<{ tools: McpTool[]; serverInfo: McpServerInfo } | { error: string }> {
	try {
		const transport = createMcpTransport(config);
		const client = new McpClient(transport);
		const serverInfo = await client.initialize();
		const tools = await client.toolsList();
		await client.close();
		return { tools, serverInfo };
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) };
	}
}

export function buildMcpRuntimeState(): McpRuntimeState {
	const defs = getToolDefinitions();
	const state: McpRuntimeState = {};
	for (const def of defs) {
		if (!def.id.startsWith('mcp.')) continue;
		const parts = def.id.split('.');
		if (parts.length < 3) continue;
		const serverId = parts.slice(1, -1).join('.');
		if (!state[serverId]) {
			state[serverId] = { connected: true, toolIds: [] };
		}
		state[serverId].toolIds.push(def.id);
	}
	return state;
}
