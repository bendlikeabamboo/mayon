import type { McpClient } from './client';
import { registerTool, deregisterTool, getToolDefinition } from '$lib/agent/registry';
import type { ToolDefinition, ToolResult, ToolContext } from '$lib/agent/registry';
import { annotationsToRisk } from './risk';
import { truncateResult, withTimeout } from './caps';

export type UnmountFn = () => void;

export interface MountOpts {
	callTimeoutMs?: number;
	resultCapBytes?: number;
}

export async function mountMcpServer(
	serverId: string,
	client: McpClient,
	opts?: MountOpts
): Promise<UnmountFn> {
	const timeoutMs = opts?.callTimeoutMs ?? 30000;
	const capBytes = opts?.resultCapBytes ?? 8192;
	const registeredIds = new Set<string>();
	let unsubToolsChanged: (() => void) | undefined;

	async function doMount(): Promise<void> {
		const tools = await client.toolsList();
		for (const tool of tools) {
			const id = `mcp.${serverId}.${tool.name}`;
			if (getToolDefinition(id)) {
				continue;
			}
			const schema = tool.inputSchema;
			if (!schema || typeof schema !== 'object' || schema.type !== 'object') {
				continue;
			}
			const def: ToolDefinition = {
				id,
				description: tool.description ?? tool.name,
				parameters: schema,
				risk: annotationsToRisk(tool.annotations),
				generative: false
			};
			registerTool({
				def,
				async run(args: unknown, ctx: ToolContext): Promise<ToolResult> {
					try {
						if (!args || typeof args !== 'object') {
							return { ok: false, summary: 'rejected: invalid args' };
						}
						const result = await withTimeout(
							client.toolsCall(tool.name, args as Record<string, unknown>),
							timeoutMs,
							ctx.signal
						);
						if (result.isError) {
							return { ok: false, summary: 'tool returned error', detail: result };
						}
						const text = result.content.map((c) => c.text ?? '').join('');
						const truncated = truncateResult(text, capBytes);
						return {
							ok: true,
							summary: truncated,
							detail: { serverId, toolName: tool.name, content: result.content }
						};
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						if (msg.includes('timed out') || msg.includes('Abort')) {
							return { ok: false, summary: 'tool timed out' };
						}
						return { ok: false, summary: `tool error: ${msg}` };
					}
				}
			});
			registeredIds.add(id);
		}
	}

	await doMount();

	unsubToolsChanged = client.subscribeToolsListChanged(() => {
		for (const id of registeredIds) {
			deregisterTool(id);
		}
		registeredIds.clear();
		doMount();
	});

	return () => {
		if (unsubToolsChanged) {
			unsubToolsChanged();
			unsubToolsChanged = undefined;
		}
		for (const id of registeredIds) {
			deregisterTool(id);
		}
		registeredIds.clear();
	};
}
