import { MCP_PROTOCOL_VERSION } from './types';
import type {
	McpNotification,
	McpPrompt,
	McpPromptGetResult,
	McpResource,
	McpResourceReadResult,
	McpServerConfig,
	McpServerInfo,
	McpTool,
	McpToolCallResult
} from './types';
import type { McpServerRequest, McpTransport } from './transport';
import { ProviderHttpError } from '$lib/ai/types';
import type { ToolContext } from '$lib/agent/registry';

const CLIENT_INFO = { name: 'mayon', version: '0.1.0' };

function buildClientCapabilities(
	config?: Pick<McpServerConfig, 'allowSampling' | 'allowElicitation'>
): Record<string, unknown> {
	const caps: Record<string, unknown> = {};
	if (config?.allowSampling) {
		caps.sampling = {};
	}
	if (config?.allowElicitation) {
		caps.elicitation = {};
	}
	return caps;
}

export class McpClient {
	#state: 'idle' | 'connected' | 'closed' = 'idle';
	#reinitializing = false;

	#serverInfo: McpServerInfo | null = null;
	#serverCapabilities: Record<string, unknown> = {};
	#requestHandlers = new Map<
		string,
		(
			id: string | number,
			params: unknown
		) => Promise<{ result?: unknown; error?: { code: number; message: string } }>
	>();

	constructor(
		private transport: McpTransport,
		private config?: Pick<McpServerConfig, 'allowSampling' | 'allowElicitation'>
	) {}

	turnContext?: ToolContext;

	get state(): 'idle' | 'connected' | 'closed' {
		return this.#state;
	}

	get serverInfo(): McpServerInfo | null {
		return this.#serverInfo;
	}

	get serverCapabilities(): Record<string, unknown> {
		return this.#serverCapabilities;
	}

	get hasResources(): boolean {
		return !!this.#serverCapabilities.resources;
	}

	get hasPrompts(): boolean {
		return !!this.#serverCapabilities.prompts;
	}

	async initialize(): Promise<McpServerInfo> {
		this.#serverInfo = await this.transport.start();
		const result = (await this.transport.request('initialize', {
			protocolVersion: MCP_PROTOCOL_VERSION,
			capabilities: buildClientCapabilities(this.config),
			clientInfo: CLIENT_INFO
		})) as Record<string, unknown>;

		if (result.serverInfo) {
			this.#serverInfo = result.serverInfo as McpServerInfo;
		}
		if (result.capabilities) {
			this.#serverCapabilities = result.capabilities as Record<string, unknown>;
		}

		this.transport.notify?.('notifications/initialized', {});
		this.#state = 'connected';
		this.startRequestListening();
		return this.#serverInfo;
	}

	async toolsList(): Promise<McpTool[]> {
		const result = (await this.#request('tools/list')) as { tools: McpTool[] };
		return result.tools;
	}

	async toolsCall(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
		return (await this.#request('tools/call', {
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

	async #request(method: string, params?: unknown): Promise<unknown> {
		try {
			return await this.transport.request(method, params);
		} catch (err) {
			if (!this.#reinitializing && err instanceof ProviderHttpError && err.status === 404) {
				this.#reinitializing = true;
				try {
					this.#state = 'idle';
					await this.initialize();
				} finally {
					this.#reinitializing = false;
				}
				return this.transport.request(method, params);
			}
			throw err;
		}
	}

	async resourcesList(): Promise<McpResource[]> {
		const result = (await this.#request('resources/list')) as { resources: McpResource[] };
		return result.resources ?? [];
	}

	async resourcesRead(uri: string): Promise<McpResourceReadResult> {
		const result = (await this.#request('resources/read', {
			uri
		})) as McpResourceReadResult;
		return result?.contents ? result : { contents: [] };
	}

	async promptsList(): Promise<McpPrompt[]> {
		const result = (await this.#request('prompts/list')) as { prompts: McpPrompt[] };
		return result.prompts ?? [];
	}

	async promptsGet(name: string, args?: Record<string, unknown>): Promise<McpPromptGetResult> {
		return (await this.#request('prompts/get', {
			name,
			arguments: args ?? {}
		})) as McpPromptGetResult;
	}

	subscribeResourcesListChanged(cb: () => void): () => void {
		const handler = (n: McpNotification) => {
			if (n.method === 'notifications/resources/list_changed') {
				cb();
			}
		};
		this.transport.onNotification?.(handler);
		return () => {
			this.transport.removeNotification?.(handler);
		};
	}

	subscribePromptsListChanged(cb: () => void): () => void {
		const handler = (n: McpNotification) => {
			if (n.method === 'notifications/prompts/list_changed') {
				cb();
			}
		};
		this.transport.onNotification?.(handler);
		return () => {
			this.transport.removeNotification?.(handler);
		};
	}

	registerRequestHandler(
		method: string,
		handler: (
			id: string | number,
			params: unknown
		) => Promise<{ result?: unknown; error?: { code: number; message: string } }>
	): void {
		this.#requestHandlers.set(method, handler);
	}

	startRequestListening(): void {
		this.transport.onRequest?.(async (req: McpServerRequest) => {
			const handler = this.#requestHandlers.get(req.method);
			if (!handler) {
				this.transport.respond?.(req.id, undefined, {
					code: -32601,
					message: `Method not found: ${req.method}`
				});
				return;
			}
			try {
				const response = await handler(req.id, req.params);
				this.transport.respond?.(req.id, response.result, response.error);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				this.transport.respond?.(req.id, undefined, {
					code: -32603,
					message: msg
				});
			}
		});
	}

	async close(): Promise<void> {
		this.#state = 'closed';
		await this.transport.close();
	}
}
