import { MCP_PROTOCOL_VERSION } from './types';
import type { McpNotification, McpServerInfo, McpTool, McpToolCallResult } from './types';
import type { McpTransport } from './transport';

const CLIENT_INFO = { name: 'mayon', version: '0.1.0' };

export class McpClient {
	#state: 'idle' | 'connected' | 'closed' = 'idle';

	#serverInfo: McpServerInfo | null = null;
	#serverCapabilities: Record<string, unknown> = {};

	constructor(private transport: McpTransport) {}

	get state(): 'idle' | 'connected' | 'closed' {
		return this.#state;
	}

	get serverInfo(): McpServerInfo | null {
		return this.#serverInfo;
	}

	get serverCapabilities(): Record<string, unknown> {
		return this.#serverCapabilities;
	}

	async initialize(): Promise<McpServerInfo> {
		this.#serverInfo = await this.transport.start();
		const result = (await this.transport.request('initialize', {
			protocolVersion: MCP_PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: CLIENT_INFO
		})) as Record<string, unknown>;

		if (result.serverInfo) {
			this.#serverInfo = result.serverInfo as McpServerInfo;
		}
		if (result.capabilities) {
			this.#serverCapabilities = result.capabilities as Record<string, unknown>;
		}

		this.#state = 'connected';
		return this.#serverInfo;
	}

	async toolsList(): Promise<McpTool[]> {
		const result = (await this.transport.request('tools/list')) as { tools: McpTool[] };
		return result.tools;
	}

	async toolsCall(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
		return (await this.transport.request('tools/call', {
			name,
			arguments: args
		})) as McpToolCallResult;
	}

	subscribeToolsListChanged(cb: () => void): () => void {
		const handler = (n: McpNotification) => {
			if (n.method === 'notifications/tools/list_changed') {
				cb();
			}
		};
		this.transport.onNotification?.(handler);
		return () => {
			this.transport.removeNotification?.(handler);
		};
	}

	async close(): Promise<void> {
		this.#state = 'closed';
		await this.transport.close();
	}
}
