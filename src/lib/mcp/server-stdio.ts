import { createBrowserKeyStore } from '$lib/ai/keystore/browser';
import { MissingKeyError } from '$lib/ai/types';
import { serverClient } from '$lib/server/client';
import { serverStatus } from '$lib/server/status.svelte';
import type { McpNotification } from './types';
import type { McpServerConfig, McpServerInfo } from './types';
import type { McpServerRequest, McpTransport } from './transport';

export class ServerStdioMcpTransport implements McpTransport {
	#pending = new Map<
		number,
		{
			resolve: (v: unknown) => void;
			reject: (e: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	#nextId = 1;
	#notificationHandler: ((n: McpNotification) => void) | null = null;
	#requestHandler: ((req: McpServerRequest) => void) | null = null;
	#closed = false;
	#ws: WebSocket | null = null;

	private serverId: string;
	private config: McpServerConfig;
	private wsFactory: () => WebSocket;

	constructor(opts: { config: McpServerConfig; wsFactory?: () => WebSocket }) {
		this.config = opts.config;
		this.serverId = opts.config.id;
		this.wsFactory = opts.wsFactory ?? (() => serverClient.ws());
	}

	async start(): Promise<McpServerInfo> {
		if (!serverStatus.has('stdio-mcp')) {
			throw new Error('stdio MCP servers require the Mayon server (run: docker compose up)');
		}

		const env: Record<string, string> = {};
		if (this.config.env) {
			const store = createBrowserKeyStore();
			for (const [name, entry] of Object.entries(this.config.env)) {
				const v = await store.get(entry.secretRef);
				if (v == null) throw new MissingKeyError(undefined, entry.secretRef);
				env[name] = v;
			}
		}

		const ws = this.wsFactory();
		this.#ws = ws;

		ws.addEventListener('message', (ev: MessageEvent) => {
			let frame: Record<string, unknown>;
			try {
				frame = JSON.parse(ev.data as string) as Record<string, unknown>;
			} catch {
				return;
			}

			if (frame.kind === 'stdout' && frame.data) {
				let parsed: Record<string, unknown>;
				try {
					parsed = JSON.parse(frame.data as string) as Record<string, unknown>;
				} catch {
					return;
				}

				if ('id' in parsed) {
					const id = parsed.id as number;
					const pending = this.#pending.get(id);
					if (pending) {
						clearTimeout(pending.timer);
						this.#pending.delete(id);
						if ('error' in parsed) {
							const err = parsed.error as { message?: string };
							pending.reject(new Error(err.message ?? JSON.stringify(err)));
						} else {
							pending.resolve(parsed.result);
						}
						return;
					}

					if ('method' in parsed && 'id' in parsed) {
						this.#requestHandler?.({
							id: parsed.id as string | number,
							method: parsed.method as string,
							params: parsed.params
						});
					}
					return;
				}

				if ('method' in parsed && !('id' in parsed)) {
					this.#notificationHandler?.({
						method: parsed.method as string,
						params: parsed.params
					});
				}
				return;
			}

			if (frame.kind === 'stderr' && frame.data) {
				console.warn(`[mcp:${this.serverId}] stderr:`, frame.data);
			}
		});

		const spawned = await new Promise<McpServerInfo>((resolve, reject) => {
			const timer = setTimeout(() => {
				ws.close();
				reject(new Error('spawn timed out'));
			}, this.config.callTimeoutMs ?? 30000);

			function onMessage(ev: MessageEvent) {
				let frame: Record<string, unknown>;
				try {
					frame = JSON.parse(ev.data as string) as Record<string, unknown>;
				} catch {
					return;
				}
				if (frame.kind === 'spawned') {
					clearTimeout(timer);
					ws.removeEventListener('message', onMessage);
					resolve({ name: 'stdio-server', version: '0.0.0' });
				} else if (frame.kind === 'exit') {
					clearTimeout(timer);
					ws.removeEventListener('message', onMessage);
					reject(new Error((frame.data as string) || 'spawn failed'));
				}
			}

			ws.addEventListener('message', onMessage);

			ws.addEventListener('error', () => {
				clearTimeout(timer);
				ws.removeEventListener('message', onMessage);
				reject(new Error('websocket error during spawn'));
			});

			ws.addEventListener('close', () => {
				clearTimeout(timer);
				ws.removeEventListener('message', onMessage);
				reject(new Error('websocket closed during spawn'));
			});

			ws.send(
				JSON.stringify({
					kind: 'spawn',
					serverId: this.serverId,
					spawn: {
						serverId: this.serverId,
						command: this.config.command,
						args: this.config.args ?? [],
						env,
						cwd: this.config.cwd
					}
				})
			);
		});

		return spawned;
	}

	request(method: string, params?: unknown): Promise<unknown> {
		if (this.#closed) return Promise.reject(new Error('transport closed'));
		const id = this.#nextId++;
		const envelope = { jsonrpc: '2.0' as const, id, method, params: params ?? {} };

		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				reject(new Error(`request timeout: ${method}`));
			}, this.config.callTimeoutMs ?? 30000);

			this.#pending.set(id, {
				resolve,
				reject,
				timer
			});

			this.#sendStdin(JSON.stringify(envelope));
		});
	}

	notify(method: string, params?: unknown): void {
		if (this.#closed) return;
		const envelope = { jsonrpc: '2.0' as const, method, params: params ?? {} };
		this.#sendStdin(JSON.stringify(envelope));
	}

	respond(id: string | number, result: unknown, error?: { code: number; message: string }): void {
		if (this.#closed) return;
		const response: Record<string, unknown> = { jsonrpc: '2.0', id };
		if (error) {
			response.error = error;
		} else {
			response.result = result;
		}
		this.#sendStdin(JSON.stringify(response));
	}

	onNotification(handler: (n: McpNotification) => void): void {
		this.#notificationHandler = handler;
	}

	removeNotification(_handler: (n: McpNotification) => void): void {
		this.#notificationHandler = null;
	}

	onRequest(handler: (req: McpServerRequest) => void): void {
		this.#requestHandler = handler;
	}

	removeRequest(_handler: (req: McpServerRequest) => void): void {
		this.#requestHandler = null;
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;

		if (this.#ws) {
			try {
				this.#ws.send(JSON.stringify({ kind: 'kill', serverId: this.serverId }));
			} catch {
				/* best-effort */
			}
			this.#ws.close();
			this.#ws = null;
		}

		for (const [, pending] of this.#pending) {
			clearTimeout(pending.timer);
			pending.reject(new Error('transport closed'));
		}
		this.#pending.clear();
		this.#notificationHandler = null;
		this.#requestHandler = null;
	}

	#sendStdin(data: string) {
		this.#ws?.send(
			JSON.stringify({
				kind: 'stdin',
				serverId: this.serverId,
				data
			})
		);
	}
}
