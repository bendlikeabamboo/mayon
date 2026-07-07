import type { McpNotification, McpServerInfo, McpTool, McpToolCallResult } from './types';
import type { McpTransport } from './transport';

export interface FakeMcpTransportOpts {
	serverInfo?: McpServerInfo;
	tools?: McpTool[];
	callHandler?: (name: string, args: Record<string, unknown>) => McpToolCallResult;
	notifications?: McpNotification[];
}

export class FakeMcpTransport implements McpTransport {
	private _serverInfo: McpServerInfo;
	private _tools: McpTool[];
	private _callHandler?: (name: string, args: Record<string, unknown>) => McpToolCallResult;
	sentNotifications: Array<{ method: string; params?: unknown }> = [];
	private _notificationHandler: ((n: McpNotification) => void) | null = null;

	constructor(opts: FakeMcpTransportOpts = {}) {
		this._serverInfo = opts.serverInfo ?? { name: 'fake-server', version: '0.0.0' };
		this._tools = opts.tools ?? [];
		this._callHandler = opts.callHandler;
	}

	async start(): Promise<McpServerInfo> {
		return this._serverInfo;
	}

	async request(method: string, params?: unknown): Promise<unknown> {
		if (method === 'initialize') {
			return {
				protocolVersion: '2025-06-18',
				capabilities: {},
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
}
