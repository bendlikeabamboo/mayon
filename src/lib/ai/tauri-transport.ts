/**
 * Desktop HTTP transport over the Rust reqwest event bridge.
 *
 * On desktop the plaintext API key never enters the webview: instead of
 * resolving the secret here, the transport forwards a `keyInjection`
 * descriptor (`{ header, scheme?, keyId }`) to the `llm_stream` Tauri command.
 * Rust reads the key from the OS keychain and injects it into the request
 * header itself (`src-tauri/src/transport.rs`). Progress flows back over the
 * `llm-stream` event channel (tagged by `streamId`); this bridge enqueues
 * `Chunk` text into a `ReadableStream<Uint8Array>` that the shared
 * `parseSseStream` / `parseNdjsonStream` parsers consume, maps `Error` to the
 * typed provider-error classes, closes exactly once on `End`, and cancels the
 * in-flight reqwest future on consumer abort via `llm_stream_cancel`.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { HttpStreamTransport } from './http-transport';
import { NetworkError, ProviderHttpError, RateLimitError } from './types';

/**
 * Event payload shapes emitted by the Rust `llm_stream` command. Field names are
 * snake_case and `type` is PascalCase to match the serde-tagged `StreamEvent`
 * in `src-tauri/src/transport.rs`.
 */
type LlmStreamEvent =
	| { type: 'Headers'; stream_id: string; status: number }
	| { type: 'Chunk'; stream_id: string; text: string }
	| { type: 'Error'; stream_id: string; status: number | null; message: string }
	| { type: 'End'; stream_id: string };

/** Build the desktop (Rust reqwest) transport. */
export function createTauriTransport(): HttpStreamTransport {
	return {
		async request(req, signal) {
			const streamId = globalThis.crypto.randomUUID();
			const encoder = new TextEncoder();

			return new ReadableStream<Uint8Array>({
				async start(controller) {
					let closed = false;
					let unlisten: UnlistenFn | undefined;

					/** Idempotent close: ignores a second terminal transition. */
					const close = () => {
						if (closed) return;
						closed = true;
						try {
							controller.close();
						} catch {
							/* already closed/errored */
						}
					};
					/** Idempotent error: ignores a second terminal transition. */
					const fail = (err: unknown) => {
						if (closed) return;
						closed = true;
						try {
							controller.error(err);
						} catch {
							/* already closed/errored */
						}
					};

					// Subscribe before invoking so an early event (a fast Headers/Chunk)
					// can't slip through before the listener is armed.
					try {
						unlisten = await listen<LlmStreamEvent>('llm-stream', (ev) => {
							const p = ev.payload;
							if (p.stream_id !== streamId) return;
							switch (p.type) {
								case 'Headers':
									// Stream began; nothing to enqueue.
									break;
								case 'Chunk':
									controller.enqueue(encoder.encode(p.text));
									break;
								case 'Error': {
									const err =
										p.status === 429
											? new RateLimitError()
											: typeof p.status === 'number'
												? new ProviderHttpError(
														`Provider returned HTTP ${p.status}`,
														p.status,
														p.message
													)
												: new NetworkError(p.message);
									fail(err);
									unlisten?.();
									break;
								}
								case 'End':
									close();
									unlisten?.();
									break;
							}
						});
					} catch (e) {
						unlisten?.();
						fail(new NetworkError(e instanceof Error ? e.message : String(e)));
						return;
					}

					// Abort: if already aborted, cancel + fail immediately (no Rust
					// stream is ever started). Otherwise arm a one-shot listener.
					if (signal) {
						if (signal.aborted) {
							void invoke('llm_stream_cancel', { streamId });
							unlisten?.();
							fail(new DOMException('Aborted', 'AbortError'));
							return;
						}
						signal.addEventListener(
							'abort',
							() => {
								void invoke('llm_stream_cancel', { streamId });
								unlisten?.();
								fail(new DOMException('Aborted', 'AbortError'));
							},
							{ once: true }
						);
					}

					// Kick off the Rust stream. Resolves as soon as the task is spawned;
					// a rejection (e.g. keychain read failure) maps to a NetworkError.
					try {
						await invoke('llm_stream', {
							url: req.url,
							method: req.method,
							headers: req.headers,
							body: req.body,
							keyInjection: req.auth
								? {
										header: req.auth.header,
										scheme: req.auth.scheme,
										keyId: req.auth.keyId
									}
								: null,
							streamId
						});
					} catch (e) {
						unlisten?.();
						fail(new NetworkError(e instanceof Error ? e.message : String(e)));
					}
				},

				cancel() {
					// Consumer cancelled the reader — best-effort stop the Rust task.
					void invoke('llm_stream_cancel', { streamId }).catch(() => {});
				}
			});
		}
	};
}
