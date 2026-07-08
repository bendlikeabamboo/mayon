import type { McpClient } from './client';
import type { McpResource } from './types';
import { registerTool, deregisterTool, getToolDefinition } from '$lib/agent/registry';
import type { ToolDefinition, ToolResult, ToolContext } from '$lib/agent/registry';
import { truncateResult, withTimeout } from './caps';

interface ResourceServerEntry {
	client: McpClient;
	resources: McpResource[];
	callTimeoutMs: number;
	resultCapBytes: number;
	subs: Set<() => void>;
}

export const RESOURCE_SERVERS = new Map<string, ResourceServerEntry>();

export async function mountResources(
	serverId: string,
	client: McpClient,
	opts?: { callTimeoutMs?: number; resultCapBytes?: number }
): Promise<void> {
	if (!client.hasResources) return;

	const resources = await client.resourcesList();
	const timeoutMs = opts?.callTimeoutMs ?? 30000;
	const capBytes = opts?.resultCapBytes ?? 8192;

	const subs = new Set<() => void>();
	const unsub = client.subscribeResourcesListChanged(async () => {
		try {
			const updated = await client.resourcesList();
			const entry = RESOURCE_SERVERS.get(serverId);
			if (entry) {
				entry.resources = updated;
			}
		} catch {
			// ignore refresh errors
		}
	});
	subs.add(unsub);

	RESOURCE_SERVERS.set(serverId, {
		client,
		resources,
		callTimeoutMs: timeoutMs,
		resultCapBytes: capBytes,
		subs
	});

	registerReadResourceTool();
}

export function unmountResources(serverId: string): void {
	const entry = RESOURCE_SERVERS.get(serverId);
	if (!entry) return;
	for (const unsub of entry.subs) {
		unsub();
	}
	RESOURCE_SERVERS.delete(serverId);
	if (RESOURCE_SERVERS.size === 0) {
		deregisterTool('mcp_read_resource');
	}
}

export function readResource(
	serverId: string,
	uri: string,
	signal?: AbortSignal
): Promise<ToolResult> {
	const entry = RESOURCE_SERVERS.get(serverId);
	if (!entry) {
		return Promise.resolve({ ok: false, summary: 'unknown resource server' });
	}

	return withTimeout(entry.client.resourcesRead(uri), entry.callTimeoutMs, signal)
		.then((result) => {
			const parts: string[] = [];
			for (const c of result.contents) {
				if (c.type === 'text') {
					parts.push(c.text ?? '');
				} else {
					parts.push(`[unsupported content type: ${c.type}]`);
				}
			}
			const text = parts.join('');
			const truncated = truncateResult(text, entry.resultCapBytes);
			const mimeTypes = result.contents.map((c) => c.mimeType).filter((m): m is string => !!m);
			return {
				ok: true,
				summary: truncated,
				detail: { serverId, uri, mimeType: mimeTypes[0] }
			};
		})
		.catch((err) => {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('timed out') || msg.includes('Abort')) {
				return { ok: false, summary: 'resource read timed out' };
			}
			return { ok: false, summary: `resource read error: ${msg}` };
		});
}

function registerReadResourceTool(): void {
	if (getToolDefinition('mcp_read_resource')) return;

	const def: ToolDefinition = {
		id: 'mcp_read_resource',
		description:
			'Read the contents of an MCP resource by server id and URI. Use only URIs listed in the Resources context.',
		parameters: {
			type: 'object',
			properties: {
				serverId: { type: 'string' },
				uri: { type: 'string' }
			},
			required: ['serverId', 'uri']
		},
		risk: 'readonly',
		generative: false
	};

	registerTool({
		def,
		async run(args: unknown, ctx: ToolContext): Promise<ToolResult> {
			if (!args || typeof args !== 'object') {
				return { ok: false, summary: 'rejected: invalid args' };
			}
			const a = args as Record<string, unknown>;
			if (typeof a.serverId !== 'string' || typeof a.uri !== 'string') {
				return { ok: false, summary: 'rejected: invalid args' };
			}
			return readResource(a.serverId, a.uri, ctx.signal);
		}
	});
}

export function listMountedResources(): Array<{ serverId: string; resources: McpResource[] }> {
	const result: Array<{ serverId: string; resources: McpResource[] }> = [];
	for (const [serverId, entry] of RESOURCE_SERVERS) {
		result.push({ serverId, resources: [...entry.resources] });
	}
	return result;
}

export function resourceServerIds(): Set<string> {
	return new Set(RESOURCE_SERVERS.keys());
}
