import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { createTauriTransport } from './tauri-transport';
import { NetworkError, ProviderHttpError, RateLimitError } from './types';

// Mock the Tauri APIs (hoisted by Vitest). The bridge is exercised purely
// through these fakes — no real desktop shell is needed.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);
const mockedListen = vi.mocked(listen);

/**
 * Event payload shape (snake_case fields, PascalCase `type`) matching the
 * serde-tagged `StreamEvent` emitted from Rust.
 */
type CapturedEvent =
	| { type: 'Headers'; stream_id: string; status: number }
	| { type: 'Chunk'; stream_id: string; text: string }
	| { type: 'Error'; stream_id: string; status: number | null; message: string }
	| { type: 'End'; stream_id: string };

let capturedHandler: ((event: { payload: CapturedEvent }) => void) | undefined;
let capturedStreamId: string | undefined;
let unlistenMock: ReturnType<typeof vi.fn>;

describe('createTauriTransport', () => {
	beforeEach(() => {
		capturedHandler = undefined;
		capturedStreamId = undefined;
		unlistenMock = vi.fn();

		// Fake `listen`: capture the handler so tests can emit events, return a
		// spy `unlisten` (resolved synchronously after a microtask, like the real one).
		mockedListen.mockReset();
		mockedListen.mockImplementation(async (_channel, handler) => {
			capturedHandler = handler as (event: { payload: CapturedEvent }) => void;
			return unlistenMock as unknown as UnlistenFn;
		});

		// Fake `invoke`: `llm_stream` captures the streamId and resolves at once
		// (Rust returns after spawning the background task); `llm_stream_cancel`
		// just records the call.
		mockedInvoke.mockReset();
		mockedInvoke.mockImplementation(async (cmd, args) => {
			if (cmd === 'llm_stream') {
				capturedStreamId = (args as { streamId: string }).streamId;
			}
			return undefined;
		});
	});

	/** Drive an event into the captured bridge listener. */
	function emit(payload: CapturedEvent): void {
		capturedHandler?.({ payload });
	}

	/** Await until the listener is armed and the stream command captured. */
	async function ready(): Promise<void> {
		for (let i = 0; i < 50; i++) {
			if (capturedHandler && capturedStreamId) return;
			await Promise.resolve();
		}
	}

	/** Read the whole stream and decode to a string. */
	async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		let out = '';
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				out += decoder.decode(value, { stream: true });
			}
			out += decoder.decode();
		} finally {
			reader.releaseLock();
		}
		return out;
	}

	/** Read the stream, returning the rejection (or `undefined` if it closed). */
	async function readRejection(stream: ReadableStream<Uint8Array>): Promise<unknown> {
		try {
			await readAll(stream);
			return undefined;
		} catch (e) {
			return e;
		}
	}

	it('enqueues Chunk text in order and closes on End', async () => {
		const transport = createTauriTransport();
		const stream = await transport.request({
			url: 'https://example.test/v1/chat',
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		});

		await ready();
		emit({ type: 'Headers', stream_id: capturedStreamId!, status: 200 });
		emit({ type: 'Chunk', stream_id: capturedStreamId!, text: 'Hel' });
		emit({ type: 'Chunk', stream_id: capturedStreamId!, text: 'lo' });
		emit({ type: 'End', stream_id: capturedStreamId! });

		expect(await readAll(stream)).toBe('Hello');
		expect(unlistenMock).toHaveBeenCalledOnce();
	});

	it('maps an Error with status 429 to RateLimitError', async () => {
		const transport = createTauriTransport();
		const stream = await transport.request({ url: 'https://example.test' });

		await ready();
		emit({ type: 'Error', stream_id: capturedStreamId!, status: 429, message: 'slow down' });

		const err = await readRejection(stream);
		expect(err).toBeInstanceOf(RateLimitError);
		expect(unlistenMock).toHaveBeenCalledOnce();
	});

	it('maps an Error with a numeric status to ProviderHttpError', async () => {
		const transport = createTauriTransport();
		const stream = await transport.request({ url: 'https://example.test' });

		await ready();
		emit({ type: 'Error', stream_id: capturedStreamId!, status: 500, message: 'boom' });

		const err = await readRejection(stream);
		expect(err).toBeInstanceOf(ProviderHttpError);
		expect((err as ProviderHttpError).status).toBe(500);
	});

	it('maps an Error with a null status to NetworkError', async () => {
		const transport = createTauriTransport();
		const stream = await transport.request({ url: 'https://example.test' });

		await ready();
		emit({ type: 'Error', stream_id: capturedStreamId!, status: null, message: 'dns failed' });

		const err = await readRejection(stream);
		expect(err).toBeInstanceOf(NetworkError);
	});

	it('maps an llm_stream invoke rejection to NetworkError', async () => {
		mockedInvoke.mockImplementation(async (cmd) => {
			if (cmd === 'llm_stream') throw new Error('keychain read failed');
			return undefined;
		});

		const transport = createTauriTransport();
		const stream = await transport.request({ url: 'https://example.test' });

		const err = await readRejection(stream);
		expect(err).toBeInstanceOf(NetworkError);
		expect(unlistenMock).toHaveBeenCalledOnce();
	});

	it('cancels the stream and rejects with AbortError when the signal is pre-aborted', async () => {
		const transport = createTauriTransport();
		const controller = new AbortController();
		controller.abort();

		const stream = await transport.request({ url: 'https://example.test' }, controller.signal);

		const err = await readRejection(stream);
		expect(err).toBeInstanceOf(DOMException);
		expect((err as DOMException).name).toBe('AbortError');
		expect(mockedInvoke).toHaveBeenCalledWith('llm_stream_cancel', {
			streamId: expect.any(String)
		});
		// The stream is never started when the signal is already aborted.
		expect(mockedInvoke).not.toHaveBeenCalledWith('llm_stream', expect.anything());
	});

	it('forwards the auth descriptor as keyInjection (and null when absent)', async () => {
		const transport = createTauriTransport();

		// With auth → keyInjection mirrors { header, scheme, keyId }.
		const withAuth = await transport.request({
			url: 'https://example.test',
			method: 'POST',
			auth: { header: 'x-api-key', keyId: 'p1' }
		});
		await ready();
		const args = mockedInvoke.mock.calls.find((c) => c[0] === 'llm_stream')?.[1] as
			| Record<string, unknown>
			| undefined;
		expect(args?.keyInjection).toEqual({ header: 'x-api-key', scheme: undefined, keyId: 'p1' });
		emit({ type: 'End', stream_id: capturedStreamId! });
		await readAll(withAuth);

		// Without auth → null.
		mockedInvoke.mockClear();
		capturedStreamId = undefined;
		const noAuth = await transport.request({ url: 'https://example.test' });
		await ready();
		const args2 = mockedInvoke.mock.calls.find((c) => c[0] === 'llm_stream')?.[1] as
			| Record<string, unknown>
			| undefined;
		expect(args2?.keyInjection).toBeNull();
		emit({ type: 'End', stream_id: capturedStreamId! });
		await readAll(noAuth);
	});
});
