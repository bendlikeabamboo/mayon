import { describe, expect, it } from 'vitest';
import { parseNdjsonStream, parseSseStream } from './transport';

/** Build a ReadableStream from a list of byte chunks (simulating chunked fetch reads). */
function chunkedStream(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
	const enc = new TextEncoder();
	const bytes = chunks.map((c) => (typeof c === 'string' ? enc.encode(c) : c));
	return new ReadableStream({
		start(controller) {
			for (const b of bytes) controller.enqueue(b);
			controller.close();
		}
	});
}

/** Collect all values from an async iterable into an array. */
async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const v of iter) out.push(v);
	return out;
}

describe('parseSseStream', () => {
	it('yields each data payload and stops at [DONE]', async () => {
		const stream = chunkedStream([
			'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
			'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
			'data: [DONE]\n\n'
		]);
		const payloads = await collect(parseSseStream(stream));
		expect(payloads).toEqual([
			'{"choices":[{"delta":{"content":"Hel"}}]}',
			'{"choices":[{"delta":{"content":"lo"}}]}'
		]);
	});

	it('joins multi-line data: fields per the SSE spec', async () => {
		const stream = chunkedStream(['data: line1\ndata: line2\n\n', 'data: [DONE]\n\n']);
		const payloads = await collect(parseSseStream(stream));
		expect(payloads).toEqual(['line1\nline2']);
	});

	it('handles a frame split across multiple reads', async () => {
		// One logical frame broken across three chunks, none of which contains the
		// terminating blank line until the last.
		const stream = chunkedStream(['data: {"a":1', '}\n', '\ndata: [DONE]\n\n']);
		const payloads = await collect(parseSseStream(stream));
		expect(payloads).toEqual(['{"a":1}']);
	});

	it('handles multiple frames coalesced in a single read', async () => {
		const stream = chunkedStream(['data: one\n\ndata: two\n\ndata: three\n\ndata: [DONE]\n\n']);
		const payloads = await collect(parseSseStream(stream));
		expect(payloads).toEqual(['one', 'two', 'three']);
	});

	it('tolerates CRLF line endings', async () => {
		const stream = chunkedStream(['data: a\r\n\r\n', 'data: b\r\n\r\n', 'data: [DONE]\r\n\r\n']);
		const payloads = await collect(parseSseStream(stream));
		expect(payloads).toEqual(['a', 'b']);
	});

	it('strips a single leading space after the colon', async () => {
		const stream = chunkedStream(['data:   spaced\n\ndata: [DONE]\n\n']);
		const payloads = await collect(parseSseStream(stream));
		// Only one leading space is stripped per spec.
		expect(payloads).toEqual(['  spaced']);
	});

	it('ignores comment/heartbeat lines and frames without a data field', async () => {
		const stream = chunkedStream([': heartbeat\n\nevent: ping\ndata: real\n\ndata: [DONE]\n\n']);
		const payloads = await collect(parseSseStream(stream));
		expect(payloads).toEqual(['real']);
	});

	it('flushes a trailing partial frame with no closing blank line', async () => {
		const stream = chunkedStream(['data: tail-no-newline']);
		const payloads = await collect(parseSseStream(stream));
		expect(payloads).toEqual(['tail-no-newline']);
	});

	it('does not yield [DONE] as a payload', async () => {
		const stream = chunkedStream(['data: only\n\ndata: [DONE]\n\n']);
		const payloads = await collect(parseSseStream(stream));
		expect(payloads).toEqual(['only']);
	});

	it('aborts when the signal is already aborted', async () => {
		const stream = chunkedStream(['data: x\n\n']);
		const controller = new AbortController();
		controller.abort();
		await expect(collect(parseSseStream(stream, controller.signal))).rejects.toThrow('Aborted');
	});
});

describe('parseNdjsonStream', () => {
	it('yields each non-empty JSON line', async () => {
		const stream = chunkedStream([
			'{"message":{"content":"a"}}\n',
			'{"message":{"content":"b"}}\n',
			'{"done":true}\n'
		]);
		const lines = await collect(parseNdjsonStream(stream));
		expect(lines).toEqual([
			'{"message":{"content":"a"}}',
			'{"message":{"content":"b"}}',
			'{"done":true}'
		]);
	});

	it('handles a JSON object split across reads', async () => {
		const stream = chunkedStream(['{"a":', '1}\n']);
		const lines = await collect(parseNdjsonStream(stream));
		expect(lines).toEqual(['{"a":1}']);
	});

	it('skips blank lines', async () => {
		const stream = chunkedStream(['{"a":1}\n\n{"b":2}\n']);
		const lines = await collect(parseNdjsonStream(stream));
		expect(lines).toEqual(['{"a":1}', '{"b":2}']);
	});
});
