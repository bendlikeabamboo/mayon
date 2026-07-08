import { describe, expect, it } from 'vitest';
import { parseSseFrames } from './sse';

describe('parseSseFrames', () => {
	it('parses multiple frames separated by \\n\\n with \\n line endings', () => {
		const chunk = 'data: hello\n\ndata: world\n\n';
		const frames = parseSseFrames(chunk);
		expect(frames).toEqual([{ data: 'hello' }, { data: 'world' }]);
	});

	it('handles \\r\\n line endings', () => {
		const chunk = 'data: hello\r\n\r\ndata: world\r\n\r\n';
		const frames = parseSseFrames(chunk);
		expect(frames).toEqual([{ data: 'hello' }, { data: 'world' }]);
	});

	it('joins multi-line data: fields with \\n per SSE spec', () => {
		const chunk = 'data: line1\ndata: line2\n\ndata: other\n\n';
		const frames = parseSseFrames(chunk);
		expect(frames).toEqual([{ data: 'line1\nline2' }, { data: 'other' }]);
	});

	it('handles frames with no data field', () => {
		const chunk = 'event: ping\n\n';
		const frames = parseSseFrames(chunk);
		expect(frames).toEqual([{}]);
	});

	it('returns empty array for empty string input', () => {
		const frames = parseSseFrames('');
		expect(frames).toEqual([]);
	});

	it('handles trailing whitespace and newlines', () => {
		const chunk = 'data: hello\n\n\n\n  \n';
		const frames = parseSseFrames(chunk);
		expect(frames).toEqual([{ data: 'hello' }]);
	});
});
