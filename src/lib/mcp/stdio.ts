import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauri } from '$lib/db';
import type { McpServerRequest, McpTransport } from './transport';
import type { McpNotification, McpServerInfo } from './types';

export class StdioMcpTransport implements McpTransport {
	private _serverId: string;
	private _unlisten: UnlistenFn | null = null;
	private _requestUnlisten: UnlistenFn | null = null;
	private _notificationHandler: ((n: McpNotification) => void) | null = null;
	private _requestHandler: ((req: McpServerRequest) => void) | null = null;

	constructor(
		private config: {
			serverId: string;
			command: string;
			args: string[];
			envKeyIds: Array<{ name: string; keyId: string }>;
			cwd?: string;
		}
	) {
		if (!isTauri()) {
			throw new Error('StdioMcpTransport is desktop-only');
		}
		this._serverId = config.serverId;
	}

	async start(): Promise<McpServerInfo> {
		await invoke('mcp_spawn', {
			serverId: this._serverId,
			command: this.config.command,
			args: this.config.args,
			envKeyIds: this.config.envKeyIds,
			cwd: this.config.cwd ?? null
		});
		return { name: 'stdio-server', version: '0.0.0' };
	}

	async request(method: string, params?: unknown): Promise<unknown> {
		const envelope = { method, params };
		const responseJson = await invoke<string>('mcp_call', {
			serverId: this._serverId,
			requestJson: JSON.stringify(envelope)
		});
		const parsed = JSON.parse(responseJson);
		if (parsed.error) {
			throw new Error(parsed.error.message || JSON.stringify(parsed.error));
		}
		return parsed.result ?? parsed;
	}

	notify(method: string, params?: unknown): void {
		const envelope = { method, params };
		invoke('mcp_notify', {
			serverId: this._serverId,
			notificationJson: JSON.stringify(envelope)
		}).catch(() => {
			/* one-way */
		});
	}

	async close(): Promise<void> {
		if (this._unlisten) {
			this._unlisten();
			this._unlisten = null;
		}
		if (this._requestUnlisten) {
			this._requestUnlisten();
			this._requestUnlisten = null;
		}
		await invoke('mcp_close', { serverId: this._serverId });
	}

	onNotification(handler: (n: McpNotification) => void): void {
		this._notificationHandler = handler;
		if (this._unlisten) return;
		listen<{ type: string; server_id: string; method: string; params: unknown }>(
			`mcp-notification:${this._serverId}`,
			(event) => {
				if (event.payload.type === 'Notification') {
					this._notificationHandler?.({
						method: event.payload.method,
						params: event.payload.params
					});
				}
			}
		).then((unlisten) => {
			this._unlisten = unlisten;
		});
	}

	removeNotification(_handler: (n: McpNotification) => void): void {
		this._notificationHandler = null;
	}

	onRequest(handler: (req: McpServerRequest) => void): void {
		this._requestHandler = handler;
		if (this._requestUnlisten) return;
		listen<{
			type: string;
			server_id: string;
			id: string | number;
			method: string;
			params: unknown;
		}>(`mcp-request:${this._serverId}`, (event) => {
			if (event.payload.type === 'Request') {
				this._requestHandler?.({
					id: event.payload.id,
					method: event.payload.method,
					params: event.payload.params
				});
			}
		}).then((unlisten) => {
			this._requestUnlisten = unlisten;
		});
	}

	removeRequest(_handler: (req: McpServerRequest) => void): void {
		this._requestHandler = null;
	}

	async respond(
		id: string | number,
		result: unknown,
		error?: { code: number; message: string }
	): Promise<void> {
		const response: Record<string, unknown> = { jsonrpc: '2.0', id };
		if (error) {
			response.error = error;
		} else {
			response.result = result;
		}
		await invoke('mcp_respond', {
			serverId: this._serverId,
			responseJson: JSON.stringify(response)
		});
	}
}
