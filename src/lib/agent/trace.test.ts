import { describe, expect, it } from 'vitest';
import { TraceBuilder } from './trace';
import type { TraceEvent } from './trace';

const request: TraceEvent = {
	kind: 'request',
	system: '',
	messages: [],
	tools: [],
	providerOptions: {}
};

function reasoningSegmentsFor(events: TraceEvent[]): string[] {
	const builder = new TraceBuilder();
	for (const event of events) builder.emit(event);
	const trace = JSON.parse(builder.toJSON()) as {
		iterations: Array<{ reasoningSegments: string[] }>;
	};
	return trace.iterations[0]!.reasoningSegments;
}

describe('TraceBuilder reasoning segment pruning (035 US5 T015)', () => {
	it('drops a whitespace-only segment closed by reasoning-end', () => {
		expect(
			reasoningSegmentsFor([
				request,
				{ kind: 'part', type: 'reasoning-start' },
				{ kind: 'part', type: 'reasoning-delta', payload: { text: '  ' } },
				{ kind: 'part', type: 'reasoning-end' },
				{ kind: 'part', type: 'finish', payload: { finishReason: 'stop' } }
			])
		).toEqual([]);
	});

	it('drops a whitespace-only segment still open at finish (no reasoning-end)', () => {
		expect(
			reasoningSegmentsFor([
				request,
				{ kind: 'part', type: 'reasoning-start' },
				{ kind: 'part', type: 'reasoning-delta', payload: { text: '  ' } },
				{ kind: 'part', type: 'finish', payload: { finishReason: 'stop' } }
			])
		).toEqual([]);
	});

	it('keeps a real trailing thought', () => {
		expect(
			reasoningSegmentsFor([
				request,
				{ kind: 'part', type: 'reasoning-start' },
				{ kind: 'part', type: 'reasoning-delta', payload: { text: ' done thinking.' } },
				{ kind: 'part', type: 'finish', payload: { finishReason: 'stop' } }
			])
		).toEqual([' done thinking.']);
	});
});
