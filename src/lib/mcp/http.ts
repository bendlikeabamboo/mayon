import { classifyFetchError, httpStatusToError } from '$lib/ai/errors';
import { MissingKeyError } from '$lib/ai/types';
import { parseSseFrames } from './sse';
import type { McpNotification } from './types';
import type { McpServerConfig, McpServerInfo } from './types';
import type { McpServerRequest, McpTransport } from './transport';

export class HttpMcpTransport implements McpTransport {
	#nextId = 1;
	#sessionId: string | null = null;
	#notificationHandler: ((n: McpNotification) => void) | null = null;
	#requestHandler: ((req: McpServerRequest) => void) | null = null;
	#activeAc: AbortController | null = null;

	private serverId: string;
	private url: string;
	private headers?: McpServerConfig['headers'];
	private callTimeoutMs: number;
	private secretResolver: (keyId: string) => Promise<string | null>;

	constructor(opts: {
		serverId: string;
		url: string;
		headers?: McpServerConfig['headers'];
		callTimeoutMs?: number;
		secretResolver: (keyId: string) => Promise<string | null>;
	}) {
		this.serverId = opts.serverId;
		this.url = opts.url;
		this.headers = opts.headers;
		this.callTimeoutMs = opts.callTimeoutMs ?? 30000;
		this.secretResolver = opts.secretResolver;
	}

	async start(): Promise<McpServerInfo> {
		if (!this.url || !/^https?:\/\//i.test(this.url)) {
			throw new Error('MCP server URL is required');
		}
		return { name: 'http-server', version: '0.0.0' };
	}

	async request(method: string, params?: unknown): Promise<unknown> {
		const expectedId = this.#nextId++;
		const envelope = { jsonrpc: '2.0' as const, id: expectedId, method, params: params ?? {} };
		const ac = new AbortController();
		this.#activeAc = ac;
		const t = setTimeout(() => ac.abort(), this.callTimeoutMs);

		let res: Response;
		try {
			res = await fetch(this.url, {
				method: 'POST',
				headers: await this.#buildHeaders(),
				body: JSON.stringify(envelope),
				signal: ac.signal,
				cache: 'no-store'
			});
		} catch (err) {
			throw classifyFetchError(err, this.url);
		} finally {
			clearTimeout(t);
			this.#activeAc = null;
		}

		if (!this.#sessionId) {
			const sid = res.headers.get('mcp-session-id');
			if (sid) this.#sessionId = sid;
		}

		if (!res.ok) {
			throw await httpStatusToError(res);
		}

		const ct = (res.headers.get('content-type') ?? '').toLowerCase();
		const isSse = ct.includes('text/event-stream');

		if (!isSse) {
			const json = await res.json();
			if (json.error) {
				throw new Error(json.error.message || JSON.stringify(json.error));
			}
			return json.result;
		}

		return this.#readSseResponse(res, expectedId);
	}

	async #readSseResponse(res: Response, expectedId: number): Promise<unknown> {
		const reader = res.body!.getReader();
		const decoder = new TextDecoder();
		let result: unknown = undefined;
		let found = false;
		let buffer = '';

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				const frames = parseSseFrames(buffer);
				buffer = '';

				for (const frame of frames) {
					if (!frame.data) continue;
					let parsed: unknown;
					try {
						parsed = JSON.parse(frame.data);
					} catch {
						continue;
					}

					const obj = parsed as Record<string, unknown>;

					if ('method' in obj && 'id' in obj && obj.id !== expectedId) {
						this.#requestHandler?.({
							id: obj.id as string | number,
							method: obj.method as string,
							params: obj.params
						});
						continue;
					}

					if ('method' in obj && !('id' in obj)) {
						this.#notificationHandler?.({
							method: obj.method as string,
							params: obj.params
						});
						continue;
					}

					if (obj.id === expectedId && 'error' in obj) {
						throw new Error(
							((obj.error as Record<string, unknown>).message as string) ||
								JSON.stringify(obj.error)
						);
					}

					if (obj.id === expectedId && 'result' in obj) {
						result = obj.result;
						found = true;
						continue;
					}
				}

				if (found) {
					let trailing = '';
					try {
						while (true) {
							const { done: d, value: v } = await reader.read();
							if (d) break;
							trailing += decoder.decode(v, { stream: true });
							for (const frame of parseSseFrames(trailing)) {
								if (!frame.data) continue;
								try {
									const obj = JSON.parse(frame.data) as Record<string, unknown>;
									if ('method' in obj && 'id' in obj && obj.id !== expectedId) {
										this.#requestHandler?.({
											id: obj.id as string | number,
											method: obj.method as string,
											params: obj.params
										});
									} else if ('method' in obj && !('id' in obj)) {
										this.#notificationHandler?.({
											method: obj.method as string,
											params: obj.params
										});
									}
								} catch {
									/* skip unparseable trailing frames */
								}
							}
							trailing = '';
						}
						trailing += decoder.decode();
						for (const frame of parseSseFrames(trailing)) {
							if (!frame.data) continue;
							try {
								const obj = JSON.parse(frame.data) as Record<string, unknown>;
								if ('method' in obj && 'id' in obj && obj.id !== expectedId) {
									this.#requestHandler?.({
										id: obj.id as string | number,
										method: obj.method as string,
										params: obj.params
									});
								} else if ('method' in obj && !('id' in obj)) {
									this.#notificationHandler?.({
										method: obj.method as string,
										params: obj.params
									});
								}
							} catch {
								/* skip */
							}
						}
					} catch {
						/* trailing read interrupted */
					}
					break;
				}
			}
		} finally {
			reader.releaseLock();
		}

		return result;
	}

	async #buildHeaders(): Promise<Record<string, string>> {
		const h: Record<string, string> = {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream'
		};

		if (this.#sessionId) {
			h['mcp-session-id'] = this.#sessionId;
		}

		if (this.headers) {
			for (const [key, entry] of Object.entries(this.headers)) {
				if (entry.value !== undefined) {
					h[key] = entry.value;
				} else if (entry.secretRef) {
					const v = await this.secretResolver(entry.secretRef);
					if (v == null) throw new MissingKeyError(undefined, entry.secretRef);
					h[key] = v;
				}
			}
		}

		return h;
	}

	notify(method: string, params?: unknown): void {
		const envelope = { jsonrpc: '2.0' as const, method, params: params ?? {} };
		fetch(this.url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(envelope),
			cache: 'no-store'
		}).catch(() => {});
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
		try {
			await fetch(this.url, {
				method: 'POST',
				headers: await this.#buildHeaders(),
				body: JSON.stringify(response),
				cache: 'no-store'
			});
		} catch {
			// best-effort
		}
	}

	async close(): Promise<void> {
		if (this.#activeAc) {
			this.#activeAc.abort();
			this.#activeAc = null;
		}
		this.#notificationHandler = null;
		this.#requestHandler = null;
	}
}
