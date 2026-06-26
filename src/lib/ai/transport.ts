/**
 * Shared streaming transport for all provider adapters. `streamSse` /
 * `streamNdjson` obtain the response body via the `HttpStreamTransport` seam
 * (`getHttpTransport()` picks `fetch` in the browser vs the Rust reqwest bridge
 * on desktop), then feed it to the pure parsers below. Adapters supply URL +
 * non-secret headers + body + an `auth` descriptor; the transport resolves the
 * secret into the header (never into JS on desktop).
 *
 * The parser is intentionally tolerant of:
 *   - chunks splitting a frame across multiple reads,
 *   - multiple frames coalesced in one read,
 *   - `\r\n`, `\n`, or `\r` line endings,
 *   - the OpenAI/Z.AI/Gemini `[DONE]` terminator.
 *
 * It yields the `data` field of each `data:` event (joined when an event spans
 * several `data:` lines, per the SSE spec). Adapters JSON-parse what they get.
 *
 * For providers that stream NDJSON instead of SSE (Ollama), use `streamNdjson`.
 */
import { getHttpTransport } from './http-transport';

export interface StreamInit {
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	/** Secret descriptor; the transport resolves it into `auth.header`. */
	auth?: { header: string; keyId: string; scheme?: string };
}

/**
 * Stream Server-Sent-Events from `url`. Yields the fully-joined `data` payload
 * of each event (the part after `data: `), minus the `[DONE]` sentinel which is
 * consumed (and stops the stream). Throws a typed provider error on non-2xx or
 * network failure (the transport owns the fetch handshake; see `errors.ts`).
 */
export async function* streamSse(
	url: string,
	init: StreamInit = {},
	signal?: AbortSignal
): AsyncIterable<string> {
	const body = await getHttpTransport().request(
		{ url, method: init.method, headers: init.headers, body: init.body, auth: init.auth },
		signal
	);
	yield* parseSseStream(body, signal);
}

/**
 * Pure SSE parser over a `ReadableStream<Uint8Array>`. Exported separately so it
 * can be unit-tested with canned byte streams (no `fetch` needed).
 *
 * Algorithm: decode incrementally into a text buffer; repeatedly cut complete
 * frames (delimited by a blank line); within each frame, collect `data:` lines
 * and yield their `\n`-joined payload. `[DONE]` stops the stream.
 */
export async function* parseSseStream(
	body: ReadableStream<Uint8Array>,
	signal?: AbortSignal
): AsyncIterable<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder('utf-8');
	let buffer = '';

	try {
		while (true) {
			if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			// Normalize line endings so the boundary scan only deals with `\n`.
			buffer = buffer.replace(/\r\n|\r/g, '\n');

			// Cut every complete frame (terminated by a blank line). `split` leaves
			// the trailing (not-yet-closed) segment as the last element, which we
			// keep as the new buffer for the next read.
			const segments = buffer.split('\n\n');
			buffer = segments.pop() ?? '';
			for (const frame of segments) {
				const payload = parseFrameData(frame);
				if (payload === null) continue; // frame carried no `data:` field
				if (payload === '[DONE]') return;
				yield payload;
			}
		}

		// Flush any trailing partial frame the stream closed without terminating.
		const tail = buffer.trim();
		if (tail.length > 0) {
			const payload = parseFrameData(tail);
			if (payload && payload !== '[DONE]') yield payload;
		}
	} finally {
		try {
			reader.releaseLock();
		} catch {
			/* already released */
		}
	}
}

/**
 * Extract the joined `data:` payload from one SSE frame. Returns `null` if the
 * frame carried no `data:` field. Per spec, multiple `data:` lines are joined
 * with `\n`; a single optional leading space after the colon is stripped.
 */
function parseFrameData(frame: string): string | null {
	const lines = frame.split('\n');
	const dataParts: string[] = [];
	for (const line of lines) {
		if (line === '' || line.startsWith(':')) continue; // blank / comment
		const colon = line.indexOf(':');
		const field = colon === -1 ? line : line.slice(0, colon);
		let value = colon === -1 ? '' : line.slice(colon + 1);
		if (value.startsWith(' ')) value = value.slice(1);
		if (field === 'data') dataParts.push(value);
	}
	if (dataParts.length === 0) return null;
	return dataParts.join('\n');
}

// ── NDJSON (Ollama) ──────────────────────────────────────────────────────────

/**
 * Stream newline-delimited JSON objects. Each non-empty line is yielded as the
 * raw JSON string; the adapter parses it. Same transport + error handling as
 * `streamSse` (the seam owns the fetch handshake).
 */
export async function* streamNdjson(
	url: string,
	init: StreamInit = {},
	signal?: AbortSignal
): AsyncIterable<string> {
	const body = await getHttpTransport().request(
		{ url, method: init.method, headers: init.headers, body: init.body, auth: init.auth },
		signal
	);
	yield* parseNdjsonStream(body, signal);
}

/** NDJSON line parser, exported for unit tests. */
export async function* parseNdjsonStream(
	body: ReadableStream<Uint8Array>,
	signal?: AbortSignal
): AsyncIterable<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder('utf-8');
	let buffer = '';
	try {
		while (true) {
			if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split(/\r\n|\n|\r/);
			// Keep the last (possibly partial) chunk in the buffer.
			buffer = lines.pop() ?? '';
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed) yield trimmed;
			}
		}
		const last = buffer.trim();
		if (last) yield last;
	} finally {
		try {
			reader.releaseLock();
		} catch {
			/* already released */
		}
	}
}
