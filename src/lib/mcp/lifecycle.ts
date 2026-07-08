import { CorsBlockedError } from '$lib/ai/errors';
import type { McpServerConfig, McpServerInfo, McpTool, McpResource, McpPrompt } from './types';
import { createMcpTransport } from './client-factory';
import { McpClient } from './client';
import { mountMcpServer } from './mount';
import { isTrusted } from './trust';
import { getToolDefinitions } from '$lib/agent/registry';
import { listMountedResources, readResource } from './resources';
import { listMountedPrompts } from './prompts';
import { repos, isTauri } from '$lib/db';

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

export interface SessionConns {
	clients: Map<string, McpClient>;
	unmountAll: () => void;
}

export async function spawnAndMount(config: McpServerConfig): Promise<SpawnResult> {
	const trusted = await isTrusted(config);
	if (!trusted) {
		throw new Error('Server is not trusted. User must confirm trust before spawning.');
	}

	const transport = createMcpTransport(config);
	const client = new McpClient(transport, {
		allowSampling: config.allowSampling,
		allowElicitation: config.allowElicitation
	});
	await client.initialize();

	const unmount = await mountMcpServer(config.id, client, {
		callTimeoutMs: config.callTimeoutMs,
		resultCapBytes: config.resultCapBytes
	});

	return { client, unmount };
}

export async function connectSession(
	configs: McpServerConfig[],
	onTrace?: (e: import('$lib/agent/trace').TraceEvent) => void
): Promise<SessionConns> {
	const clients = new Map<string, McpClient>();
	const unmounts: Array<() => void> = [];
	const connectedServers: Array<{ id: string; name: string }> = [];

	for (const config of configs) {
		try {
			const trusted = await isTrusted(config);
			if (!trusted) {
				console.warn(`[mcp] skipping untrusted server: ${config.name} (${config.id})`);
				continue;
			}
			if (config.transport === 'stdio' && !isTauri()) {
				console.info(`[mcp] skipping stdio server in browser: ${config.name} (${config.id})`);
				continue;
			}
			const transport = createMcpTransport(config);
			const client = new McpClient(transport, {
				allowSampling: config.allowSampling,
				allowElicitation: config.allowElicitation
			});
			await client.initialize();
			const unmount = await mountMcpServer(config.id, client, {
				callTimeoutMs: config.callTimeoutMs,
				resultCapBytes: config.resultCapBytes
			});
			clients.set(config.id, client);
			unmounts.push(unmount);
			connectedServers.push({ id: config.id, name: config.name });
			onTrace?.({
				kind: 'mcp-lifecycle',
				serverId: config.id,
				serverName: config.name,
				action: 'connect'
			});
		} catch (err) {
			console.warn(
				`[mcp] failed to connect server: ${config.name} (${config.id}):`,
				err instanceof Error ? err.message : err
			);
			onTrace?.({
				kind: 'mcp-lifecycle',
				serverId: config.id,
				serverName: config.name,
				action: 'error',
				detail: err instanceof Error ? err.message : String(err)
			});
		}
	}

	return {
		clients,
		unmountAll: () => {
			for (const server of connectedServers) {
				onTrace?.({
					kind: 'mcp-lifecycle',
					serverId: server.id,
					serverName: server.name,
					action: 'disconnect'
				});
			}
			for (const fn of unmounts) fn();
			unmounts.length = 0;
		}
	};
}

export async function testConnection(config: McpServerConfig): Promise<
	| {
			tools: McpTool[];
			serverInfo: McpServerInfo;
			resources?: McpResource[];
			prompts?: McpPrompt[];
	  }
	| { error: string; corsBlocked?: boolean }
> {
	try {
		const transport = createMcpTransport(config);
		const client = new McpClient(transport, {
			allowSampling: config.allowSampling,
			allowElicitation: config.allowElicitation
		});
		const serverInfo = await client.initialize();
		const tools = await client.toolsList();
		let resources: McpResource[] | undefined;
		let prompts: McpPrompt[] | undefined;
		if (client.hasResources) {
			resources = await client.resourcesList();
		}
		if (client.hasPrompts) {
			prompts = await client.promptsList();
		}
		await client.close();
		return { tools, serverInfo, resources, prompts };
	} catch (err) {
		if (err instanceof CorsBlockedError) return { error: err.message, corsBlocked: true };
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

export interface MountedResourceInfo {
	serverId: string;
	serverName: string;
	resources: McpResource[];
}

export interface MountedPromptInfo {
	serverId: string;
	serverName: string;
	prompts: McpPrompt[];
}

export async function getMountedResources(): Promise<MountedResourceInfo[]> {
	const servers = await repos.mcp.listServers();
	const serverMap = new Map(servers.map((s) => [s.id, s]));
	return listMountedResources().map((entry) => ({
		serverId: entry.serverId,
		serverName: serverMap.get(entry.serverId)?.name ?? entry.serverId,
		resources: entry.resources
	}));
}

export async function getMountedPrompts(): Promise<MountedPromptInfo[]> {
	const servers = await repos.mcp.listServers();
	const serverMap = new Map(servers.map((s) => [s.id, s]));
	return listMountedPrompts().map((entry) => ({
		serverId: entry.serverId,
		serverName: serverMap.get(entry.serverId)?.name ?? entry.serverId,
		prompts: entry.prompts
	}));
}

export async function readResourceForAttach(
	serverId: string,
	uri: string
): Promise<{ content: string; name: string; mimeType?: string } | { error: string }> {
	const mounted = listMountedResources();
	const entry = mounted.find((e) => e.serverId === serverId);
	if (!entry) return { error: `unknown resource server: ${serverId}` };

	const resource = entry.resources.find((r) => r.uri === uri);
	const name = resource?.name ?? uri;
	const mimeType = resource?.mimeType;

	const result = await readResource(serverId, uri);
	if (!result.ok) return { error: result.summary };
	return { content: result.summary, name, mimeType };
}
