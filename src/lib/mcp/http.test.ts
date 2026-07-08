import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpMcpTransport } from './http';
import { classifyFetchError, httpStatusToError } from '$lib/ai/errors';
import { MissingKeyError, CorsBlockedError, NetworkError } from '$lib/ai/types';

vi.mock('$lib/ai/errors', () => ({
	classifyFetchError: vi.fn((err: unknown) => err),
	httpStatusToError: vi.fn(async (res: Response) => new Error(`HTTP ${res.status}`))
}));

const mockedClassify = vi.mocked(classifyFetchError);
const _mockedHttpStatus = vi.mocked(httpStatusToError);

type LocationLike = { href: string; origin: string };
const g = globalThis as unknown as { location?: LocationLike };

function cannedResponse(
	body: string,
	init?: { status?: number; headers?: Record<string, string> }
): Response {
	return new Response(body, { status: init?.status ?? 200, headers: init?.headers ?? {} });
}

function sseStream(text: string, headers?: Record<string, string>): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(text));
			controller.close();
		}
	});
	return new Response(stream, {
		status: 200,
		headers: { 'content-type': 'text/event-stream', ...(headers ?? {}) }
	});
}

function fakeResolver(map: Record<string, string>): (id: string) => Promise<string | null> {
	return async (id) => map[id] ?? null;
}

describe('HttpMcpTransport', () => {
	const originalFetch = globalThis.fetch;
	const originalLocation = g.location;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
		vi.clearAllMocks();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		g.location = originalLocation;
		vi.restoreAllMocks();
	});

	function makeTransport(overrides?: {
		url?: string;
		headers?: Record<string, { secretRef?: string; value?: string }>;
		callTimeoutMs?: number;
		secrets?: Record<string, string>;
		resolverError?: boolean;
	}) {
		const secrets = overrides?.secrets ?? {};
		const resolverError = overrides?.resolverError ?? false;
		return new HttpMcpTransport({
			serverId: 'srv-1',
			url: overrides?.url ?? 'http://localhost:9000/mcp',
			headers: overrides?.headers,
			callTimeoutMs: overrides?.callTimeoutMs,
			secretResolver: resolverError
				? async () => {
						throw new Error('resolver boom');
					}
				: fakeResolver(secrets)
		});
	}

	describe('start()', () => {
		it('rejects empty URL', async () => {
			const t = makeTransport({ url: '' });
			await expect(t.start()).rejects.toThrow('MCP server URL is required');
		});

		it('rejects non-absolute URL', async () => {
			const t = makeTransport({ url: 'localhost:9000/mcp' });
			await expect(t.start()).rejects.toThrow('MCP server URL is required');
		});

		it('returns placeholder without calling fetch', async () => {
			const t = makeTransport();
			const info = await t.start();
			expect(info).toEqual({ name: 'http-server', version: '0.0.0' });
			expect(globalThis.fetch).not.toHaveBeenCalled();
		});
	});

	describe('request()', () => {
		it('POSTs full JSON-RPC envelope and returns result with session capture', async () => {
			const t = makeTransport();
			await t.start();

			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
				cannedResponse(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }), {
					headers: { 'mcp-session-id': 'sess-abc' }
				})
			);

			const result = await t.request('initialize', {
				protocolVersion: '2025-06-18',
				capabilities: {},
				clientInfo: { name: 'mayon', version: '0.0.0' }
			});

			expect(result).toEqual({ tools: [] });
			expect(globalThis.fetch).toHaveBeenCalledTimes(1);

			const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
			const body = JSON.parse((init as RequestInit).body as string);
			expect(body.jsonrpc).toBe('2.0');
			expect(body.id).toBe(1);
			expect(body.method).toBe('initialize');
			expect(body.params).toEqual({
				protocolVersion: '2025-06-18',
				capabilities: {},
				clientInfo: { name: 'mayon', version: '0.0.0' }
			});
		});

		it('echoes mcp-session-id header after session capture', async () => {
			const t = makeTransport();
			await t.start();

			(globalThis.fetch as ReturnType<typeof vi.fn>)
				.mockResolvedValueOnce(
					cannedResponse(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
						headers: { 'mcp-session-id': 'sess-123' }
					})
				)
				.mockResolvedValueOnce(
					cannedResponse(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [] } }))
				);

			await t.request('initialize', {});
			await t.request('tools/list', {});

			const [, init2] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
			const headers = (init2 as RequestInit).headers as Record<string, string>;
			expect(headers['mcp-session-id']).toBe('sess-123');
		});

		it('throws on JSON error response', async () => {
			const t = makeTransport();
			await t.start();

			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
				cannedResponse(
					JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'bad request', code: -32600 } })
				)
			);

			await expect(t.request('bad')).rejects.toThrow('bad request');
		});

		it('SSE: notification then result — fires handler and returns result', async () => {
			const t = makeTransport();
			await t.start();

			const sseText =
				'data: {"method":"notifications/message","params":{"level":"info","data":"hi"}}\n\n' +
				'data: {"jsonrpc":"2.0","id":1,"result":{"status":"ok"}}\n\n';

			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(sseStream(sseText));

			const notifications: unknown[] = [];
			t.onNotification((n) => notifications.push(n));

			const result = await t.request('ping');
			expect(result).toEqual({ status: 'ok' });
			expect(notifications).toHaveLength(1);
			expect((notifications[0] as { method: string }).method).toBe('notifications/message');
		});

		it('SSE: result then notification — order independence', async () => {
			const t = makeTransport();
			await t.start();

			const sseText =
				'data: {"jsonrpc":"2.0","id":1,"result":{"data":42}}\n\n' +
				'data: {"method":"notifications/message","params":{"level":"info"}}\n\n';

			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(sseStream(sseText));

			const notifications: unknown[] = [];
			t.onNotification((n) => notifications.push(n));

			const result = await t.request('ping');
			expect(result).toEqual({ data: 42 });
			expect(notifications).toHaveLength(1);
		});

		it('round-trips tools/call args in params', async () => {
			const t = makeTransport();
			await t.start();

			const args = { name: 'add', arguments: { a: 1, b: 2 } };
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
				cannedResponse(
					JSON.stringify({
						jsonrpc: '2.0',
						id: 1,
						result: { content: [{ type: 'text', text: '3' }] }
					})
				)
			);

			const result = await t.request('tools/call', args);
			expect(result).toEqual({ content: [{ type: 'text', text: '3' }] });

			const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
			const body = JSON.parse((init as RequestInit).body as string);
			expect(body.method).toBe('tools/call');
			expect(body.params).toEqual(args);
		});
	});

	describe('headers', () => {
		it('resolves secretRef header and passes literal value header', async () => {
			const t = makeTransport({
				headers: {
					Authorization: { secretRef: 'key:provider:123' },
					'X-Custom': { value: 'fixed' }
				},
				secrets: { 'key:provider:123': 'bearer-token' }
			});
			await t.start();

			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
				cannedResponse(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }))
			);

			await t.request('ping');

			const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
			const headers = (init as RequestInit).headers as Record<string, string>;
			expect(headers['Authorization']).toBe('bearer-token');
			expect(headers['X-Custom']).toBe('fixed');
		});

		it('resolver returning null throws MissingKeyError without fetch', async () => {
			const t = makeTransport({
				headers: { Authorization: { secretRef: 'key:missing' } },
				secrets: {}
			});
			await t.start();

			await expect(t.request('ping')).rejects.toBeInstanceOf(MissingKeyError);
			expect(globalThis.fetch).not.toHaveBeenCalled();
		});

		it('resolver that throws propagates error without fetch', async () => {
			const t = makeTransport({
				headers: { Authorization: { secretRef: 'key:boom' } },
				resolverError: true
			});
			await t.start();

			await expect(t.request('ping')).rejects.toThrow('resolver boom');
			expect(globalThis.fetch).not.toHaveBeenCalled();
		});
	});

	describe('error classification', () => {
		it('CORS: cross-origin TypeError → CorsBlockedError', async () => {
			g.location = { href: 'http://localhost:5173/', origin: 'http://localhost:5173' };
			mockedClassify.mockImplementation((err: unknown) => {
				if (err instanceof TypeError) return new CorsBlockedError(undefined, undefined);
				return err as Error;
			});

			const t = makeTransport({ url: 'https://remote-mcp.example.com/mcp' });
			await t.start();

			(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
				new TypeError('Failed to fetch')
			);

			await expect(t.request('ping')).rejects.toBeInstanceOf(CorsBlockedError);
		});

		it('same-origin TypeError → NetworkError', async () => {
			mockedClassify.mockImplementation((err: unknown) => {
				if (err instanceof TypeError)
					return new NetworkError('Network request failed (offline or unreachable).', err);
				return err as Error;
			});

			const t = makeTransport({ url: 'http://localhost:9000/mcp' });
			await t.start();

			(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
				new TypeError('Failed to fetch')
			);

			await expect(t.request('ping')).rejects.toBeInstanceOf(NetworkError);
		});

		it('timeout: callTimeoutMs fires and rejects', async () => {
			const t = makeTransport({ callTimeoutMs: 50 });
			await t.start();

			(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((_input, init) => {
				const signal = (init as RequestInit).signal!;
				return new Promise((_, reject) => {
					signal.addEventListener(
						'abort',
						() => reject(new DOMException('Aborted', 'AbortError')),
						{
							once: true
						}
					);
				});
			});

			await expect(t.request('ping')).rejects.toBeInstanceOf(DOMException);
		}, 10000);
	});

	describe('notify()', () => {
		it('issues POST with no id', async () => {
			const t = makeTransport();
			await t.start();

			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(cannedResponse(''));

			t.notify('notifications/cancelled', { reason: 'abort' });

			await vi.waitFor(() => {
				expect(globalThis.fetch).toHaveBeenCalledTimes(1);
			});

			const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
			const body = JSON.parse((init as RequestInit).body as string);
			expect(body.id).toBeUndefined();
			expect(body.method).toBe('notifications/cancelled');
			expect(body.params).toEqual({ reason: 'abort' });
		});
	});

	describe('close()', () => {
		it('aborts in-flight request and clears notification handler', async () => {
			const t = makeTransport();
			await t.start();

			(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((_input, init) => {
				const signal = (init as RequestInit).signal!;
				return new Promise((_, reject) => {
					signal.addEventListener(
						'abort',
						() => reject(new DOMException('Aborted', 'AbortError')),
						{
							once: true
						}
					);
				});
			});

			let handlerCalled = false;
			t.onNotification(() => {
				handlerCalled = true;
			});

			const req = t.request('slow');
			await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));

			await t.close();

			await expect(req).rejects.toBeInstanceOf(DOMException);
			expect(handlerCalled).toBe(false);
		});
	});
});
