import type {
	McpNotification,
	McpPrompt,
	McpPromptGetResult,
	McpResource,
	McpResourceReadResult,
	McpServerInfo,
	McpTool,
	McpToolCallResult
} from './types';
import type { McpServerRequest, McpTransport } from './transport';

export interface FakeMcpTransportOpts {
	serverInfo?: McpServerInfo;
	tools?: McpTool[];
	callHandler?: (name: string, args: Record<string, unknown>) => McpToolCallResult;
	notifications?: McpNotification[];
	resources?: McpResource[];
	resourceReadHandler?: (uri: string) => McpResourceReadResult;
	prompts?: McpPrompt[];
	promptGetHandler?: (name: string, args: Record<string, unknown>) => McpPromptGetResult;
	capabilities?: Record<string, unknown>;
}

export class FakeMcpTransport implements McpTransport {
	private _serverInfo: McpServerInfo;
	private _tools: McpTool[];
	private _callHandler?: (name: string, args: Record<string, unknown>) => McpToolCallResult;
	private _resources: McpResource[];
	private _resourceReadHandler?: (uri: string) => McpResourceReadResult;
	private _prompts: McpPrompt[];
	private _promptGetHandler?: (name: string, args: Record<string, unknown>) => McpPromptGetResult;
	private _capabilities: Record<string, unknown>;
	sentNotifications: Array<{ method: string; params?: unknown }> = [];
	sentResponses: Array<{
		id: string | number;
		result?: unknown;
		error?: { code: number; message: string };
	}> = [];
	private _notificationHandler: ((n: McpNotification) => void) | null = null;
	private _requestHandler: ((req: McpServerRequest) => void) | null = null;

	constructor(opts: FakeMcpTransportOpts = {}) {
		this._serverInfo = opts.serverInfo ?? { name: 'fake-server', version: '0.0.0' };
		this._tools = opts.tools ?? [];
		this._callHandler = opts.callHandler;
		this._resources = opts.resources ?? [];
		this._resourceReadHandler = opts.resourceReadHandler;
		this._prompts = opts.prompts ?? [];
		this._promptGetHandler = opts.promptGetHandler;
		this._capabilities = opts.capabilities ?? {};
	}

	async start(): Promise<McpServerInfo> {
		return this._serverInfo;
	}

	async request(method: string, params?: unknown): Promise<unknown> {
		if (method === 'initialize') {
			return {
				protocolVersion: '2025-06-18',
				capabilities: this._capabilities,
				serverInfo: this._serverInfo
			};
		}
		if (method === 'tools/list') {
			return { tools: this._tools };
		}
		if (method === 'tools/call') {
			const p = params as { name?: string; arguments?: Record<string, unknown> } | undefined;
			const name = p?.name ?? '';
			const args = p?.arguments ?? {};
			if (this._callHandler) {
				return this._callHandler(name, args);
			}
			return {
				content: [{ type: 'text', text: `fake result for ${name}` }]
			};
		}
		if (method === 'resources/list') {
			return { resources: this._resources };
		}
		if (method === 'resources/read') {
			const p = params as { uri?: string } | undefined;
			if (this._resourceReadHandler) {
				return this._resourceReadHandler(p?.uri ?? '');
			}
			return {
				contents: [
					{ uri: p?.uri ?? '', type: 'text' as const, text: `fake resource for ${p?.uri}` }
				]
			};
		}
		if (method === 'prompts/list') {
			return { prompts: this._prompts };
		}
		if (method === 'prompts/get') {
			const p = params as { name?: string; arguments?: Record<string, unknown> } | undefined;
			if (this._promptGetHandler) {
				return this._promptGetHandler(p?.name ?? '', p?.arguments ?? {});
			}
			return {
				description: 'fake prompt',
				messages: [
					{ role: 'user' as const, content: { type: 'text', text: `fake prompt for ${p?.name}` } }
				]
			};
		}
		return { result: method };
	}

	notify(method: string, params?: unknown): void {
		this.sentNotifications.push({ method, params });
	}

	async close(): Promise<void> {
		// no-op
	}

	onNotification(handler: (n: McpNotification) => void): void {
		this._notificationHandler = handler;
	}

	removeNotification(_handler: (n: McpNotification) => void): void {
		this._notificationHandler = null;
	}

	emitNotification(n: McpNotification): void {
		this._notificationHandler?.(n);
	}

	onRequest(handler: (req: McpServerRequest) => void): void {
		this._requestHandler = handler;
	}

	removeRequest(_handler: (req: McpServerRequest) => void): void {
		this._requestHandler = null;
	}

	emitRequest(req: McpServerRequest): void {
		this._requestHandler?.(req);
	}

	respond(id: string | number, result: unknown, error?: { code: number; message: string }): void {
		this.sentResponses.push({ id, result, error });
	}
}
