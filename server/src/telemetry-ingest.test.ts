import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelemetryEventRecord } from '@mayon/shared';
import {
	configureTelemetryIngest,
	deliverBatch,
	enqueueTelemetry,
	getTelemetryPipelineStatus,
	probeLangfuse,
	resetTelemetryQueue,
	toLangfuseEvents
} from './telemetry-ingest';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function record(overrides?: Partial<TelemetryEventRecord>): TelemetryEventRecord {
	return {
		id: '11111111-1111-4111-8111-111111111111',
		kind: 'chat-turn',
		chatId: 'chat-1',
		model: 'mock-sink',
		provider: 'openai-compatible',
		startedAt: '2026-10-31T00:00:00.000Z',
		durationMs: 42,
		outcome: 'success',
		...overrides
	};
}

function enabledSource() {
	return {
		getConfig: vi.fn(
			async () =>
				({
					enabled: true,
					host: 'https://langfuse.example.com',
					publicKey: 'pk-lf-test',
					captureMode: 'content',
					updatedAt: '2026-10-31T00:00:00.000Z'
				}) as const
		),
		secret: vi.fn(() => 'sk-lf-secret')
	};
}

function okResponse(): Response {
	return new Response('{}', { status: 202 });
}

function fetchBodies(mock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
	return mock.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string));
}

describe('telemetry-ingest pipeline queue', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => okResponse())
		);
	});

	afterEach(() => {
		resetTelemetryQueue();
		configureTelemetryIngest({
			getConfig: async () => ({
				enabled: false,
				host: '',
				publicKey: '',
				captureMode: 'content',
				updatedAt: ''
			}),
			secret: () => undefined
		});
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('flushes within 5s of the first queued record, not sooner', async () => {
		const fetchMock = vi.fn(async () => okResponse());
		vi.stubGlobal('fetch', fetchMock);
		configureTelemetryIngest(enabledSource());
		enqueueTelemetry(record());
		await vi.advanceTimersByTimeAsync(4999);
		expect(fetchMock).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('flushes immediately once 20 records are queued', async () => {
		const fetchMock = vi.fn(async () => okResponse());
		vi.stubGlobal('fetch', fetchMock);
		configureTelemetryIngest(enabledSource());
		for (let i = 0; i < 19; i++) enqueueTelemetry(record({ id: `r-${i}` }));
		await vi.advanceTimersByTimeAsync(100);
		expect(fetchMock).not.toHaveBeenCalled();
		enqueueTelemetry(record({ id: 'r-19' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('bounds the queue at 500 with drop-oldest and flushes ≤20 records per batch', async () => {
		const fetchMock = vi.fn(async () => okResponse());
		vi.stubGlobal('fetch', fetchMock);
		configureTelemetryIngest(enabledSource());
		for (let i = 0; i < 505; i++) enqueueTelemetry(record({ id: `r-${i}` }));
		expect(getTelemetryPipelineStatus().queueDepth).toBe(500);

		await vi.advanceTimersByTimeAsync(0);
		const first = fetchBodies(fetchMock)[0] as { batch: Array<Record<string, unknown>> };
		const traceIds = first.batch
			.filter((e) => e.type === 'trace-create')
			.map((e) => (e.body as { id: string }).id);
		expect(traceIds).toEqual(Array.from({ length: 20 }, (_, i) => `r-${i + 5}`));

		await vi.advanceTimersByTimeAsync(5000);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(getTelemetryPipelineStatus().queueDepth).toBe(460);
	});

	it('reset() drops the queue instantly so nothing is delivered (FR-003)', async () => {
		const fetchMock = vi.fn(async () => okResponse());
		vi.stubGlobal('fetch', fetchMock);
		configureTelemetryIngest(enabledSource());
		for (let i = 0; i < 3; i++) enqueueTelemetry(record({ id: `r-${i}` }));
		resetTelemetryQueue();
		expect(getTelemetryPipelineStatus().queueDepth).toBe(0);
		await vi.advanceTimersByTimeAsync(20_000);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('never dials Langfuse while config is disabled or the secret is missing', async () => {
		const fetchMock = vi.fn(async () => okResponse());
		vi.stubGlobal('fetch', fetchMock);
		configureTelemetryIngest({
			getConfig: enabledSource().getConfig,
			secret: () => undefined
		});
		enqueueTelemetry(record());
		await vi.advanceTimersByTimeAsync(6000);
		expect(fetchMock).not.toHaveBeenCalled();

		configureTelemetryIngest({
			getConfig: async () => ({
				enabled: false,
				host: 'https://langfuse.example.com',
				publicKey: 'pk-lf-test',
				captureMode: 'content',
				updatedAt: '2026-10-31T00:00:00.000Z'
			}),
			secret: () => 'sk-lf-secret'
		});
		enqueueTelemetry(record({ id: 'r-2' }));
		await vi.advanceTimersByTimeAsync(6000);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(getTelemetryPipelineStatus().queueDepth).toBe(2);
	});

	it('backs off exponentially per failed flush, capped at 60s', async () => {
		const times: number[] = [];
		const fetchMock = vi.fn(async () => {
			times.push(Date.now());
			throw new Error('destination down');
		});
		vi.stubGlobal('fetch', fetchMock);
		configureTelemetryIngest(enabledSource());
		enqueueTelemetry(record());

		await vi.advanceTimersByTimeAsync(5000); // flush #1
		await vi.advanceTimersByTimeAsync(1000); // #2
		await vi.advanceTimersByTimeAsync(2000); // #3
		await vi.advanceTimersByTimeAsync(4000); // #4
		expect(fetchMock).toHaveBeenCalledTimes(4);
		const gaps = times.slice(1).map((t, i) => t - times[i]);
		expect(gaps).toEqual([1000, 2000, 4000]);

		await vi.advanceTimersByTimeAsync(8000); // #5
		await vi.advanceTimersByTimeAsync(16_000); // #6
		await vi.advanceTimersByTimeAsync(32_000); // #7
		expect(fetchMock).toHaveBeenCalledTimes(7);
		await vi.advanceTimersByTimeAsync(59_999);
		expect(fetchMock).toHaveBeenCalledTimes(7);
		await vi.advanceTimersByTimeAsync(1); // #8 after the capped 60s gap
		expect(fetchMock).toHaveBeenCalledTimes(8);
		expect(times[7] - times[6]).toBe(60_000);
	});

	it('a successful flush resets backoff and updates the status projection truthfully', async () => {
		const baseline = getTelemetryPipelineStatus();
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockRejectedValueOnce(new Error('down'))
				.mockRejectedValueOnce(new Error('down'))
				.mockResolvedValue(okResponse())
		);
		configureTelemetryIngest(enabledSource());
		enqueueTelemetry(record());

		await vi.advanceTimersByTimeAsync(5000); // #1 fails
		await vi.advanceTimersByTimeAsync(1000); // #2 fails
		let status = getTelemetryPipelineStatus();
		expect(status.lastError).toEqual({
			at: expect.any(String),
			summary: 'destination not reachable'
		});
		expect(status.lastDeliveredAt).toBe(baseline.lastDeliveredAt);

		await vi.advanceTimersByTimeAsync(4000); // #3 succeeds
		status = getTelemetryPipelineStatus();
		expect(status.lastError).toBeNull();
		expect(status.lastDeliveredAt).not.toBe(baseline.lastDeliveredAt);
		expect(status.queueDepth).toBe(0);

		enqueueTelemetry(record({ id: 'r-2' }));
		await vi.advanceTimersByTimeAsync(5000);
		expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(4);
	});
});

describe('probeLangfuse', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('classifies 2xx as ok and authenticates with Basic pk:sk', async () => {
		const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const result = await probeLangfuse('https://lf.example.com', 'pk-lf-a', 'sk-lf-b');
		expect(result).toBe('ok');
		const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
		expect(String(url)).toBe('https://lf.example.com/api/public/projects');
		expect(init.method).toBe('GET');
		expect(init.headers).toMatchObject({
			authorization: `Basic ${Buffer.from('pk-lf-a:sk-lf-b').toString('base64')}`
		});
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});

	it('classifies network errors as destination not reachable', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('fetch failed');
			})
		);
		expect(await probeLangfuse('https://lf.example.com', 'pk', 'sk')).toBe(
			'destination not reachable'
		);
	});

	it('classifies 401 and 403 as credentials rejected', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('no', { status: 401 }))
		);
		expect(await probeLangfuse('https://lf.example.com', 'pk', 'sk')).toBe('credentials rejected');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('no', { status: 403 }))
		);
		expect(await probeLangfuse('https://lf.example.com', 'pk', 'sk')).toBe('credentials rejected');
	});

	it('classifies other non-2xx statuses as destination not reachable', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('boom', { status: 500 }))
		);
		expect(await probeLangfuse('https://lf.example.com', 'pk', 'sk')).toBe(
			'destination not reachable'
		);
	});
});

describe('Langfuse ingestion mapping', () => {
	it('maps one record to trace-create + observation-create exactly per the contract', () => {
		const rec = record({
			input: { system: 'sys', messages: [{ role: 'user', content: 'q' }] },
			output: 'answer',
			usage: { input: 10, output: 5, total: 15 }
		});
		const events = toLangfuseEvents([rec], 'content') as Array<{
			id: string;
			type: string;
			timestamp: string;
			body: Record<string, unknown>;
		}>;
		expect(events).toHaveLength(2);

		const [trace, obs] = events;
		expect(trace.type).toBe('trace-create');
		expect(trace.id).toMatch(UUID_RE);
		expect(trace.timestamp).toBe(rec.startedAt);
		expect(trace.body).toEqual({
			id: rec.id,
			name: 'chat-turn',
			sessionId: 'chat-1',
			tags: ['chat-turn', 'openai-compatible', 'content'],
			metadata: { app: 'mayon', model: 'mock-sink', outcome: 'success' }
		});

		expect(obs.type).toBe('observation-create');
		expect(obs.id).toMatch(UUID_RE);
		expect(obs.id).not.toBe(trace.id);
		expect(obs.timestamp).toBe(rec.startedAt);
		expect(obs.body.traceId).toBe(rec.id);
		expect(obs.body.id).toMatch(UUID_RE);
		expect(obs.body.type).toBe('generation');
		expect(obs.body.name).toBe('chat-turn');
		expect(obs.body.startTime).toBe(rec.startedAt);
		expect(obs.body.endTime).toBe('2026-10-31T00:00:00.042Z');
		expect(obs.body.model).toBe('mock-sink');
		expect(obs.body.input).toEqual(rec.input);
		expect(obs.body.output).toBe('answer');
		expect(obs.body.usage).toEqual({ input: 10, output: 5, total: 15, unit: 'TOKENS' });
		expect(obs.body.level).toBe('DEFAULT');
		expect('statusMessage' in obs.body).toBe(false);
	});

	it('omits absent input/output/usage keys and marks error records ERROR with a statusMessage', () => {
		const rec = record({ outcome: 'error', errorDetail: 'provider 429' });
		const events = toLangfuseEvents([rec], 'metadata') as Array<{
			body: Record<string, unknown>;
		}>;
		const obs = events[1].body;
		expect('input' in obs).toBe(false);
		expect('output' in obs).toBe(false);
		expect('usage' in obs).toBe(false);
		expect(obs.level).toBe('ERROR');
		expect(obs.statusMessage).toBe('provider 429');
		expect(events[0].body.tags).toEqual(['chat-turn', 'openai-compatible', 'metadata']);
	});

	it('POSTs the batch to {host}/api/public/ingestion with Basic auth', async () => {
		const fetchMock = vi.fn(async () => okResponse());
		vi.stubGlobal('fetch', fetchMock);
		const result = await deliverBatch(
			{ host: 'https://lf.example.com', publicKey: 'pk-lf-p', captureMode: 'metadata' },
			'sk-lf-s',
			[record(), record({ id: '22222222-2222-4222-8222-222222222222' })]
		);
		expect(result).toEqual({ ok: true });
		const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
		expect(String(url)).toBe('https://lf.example.com/api/public/ingestion');
		expect(init.method).toBe('POST');
		expect(init.headers).toMatchObject({
			authorization: `Basic ${Buffer.from('pk-lf-p:sk-lf-s').toString('base64')}`,
			'content-type': 'application/json'
		});
		const body = JSON.parse(init.body as string) as { batch: unknown[] };
		expect(body.batch).toHaveLength(4);
	});

	it('classifies delivery failures and never logs the secret', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => {
					throw new TypeError('fetch failed');
				})
			);
			expect(
				await deliverBatch(
					{ host: 'https://lf.example.com', publicKey: 'pk', captureMode: 'content' },
					'sk-super-secret',
					[record()]
				)
			).toEqual({ ok: false, summary: 'destination not reachable' });

			vi.stubGlobal(
				'fetch',
				vi.fn(async () => new Response('no', { status: 401 }))
			);
			expect(
				await deliverBatch(
					{ host: 'https://lf.example.com', publicKey: 'pk', captureMode: 'content' },
					'sk-super-secret',
					[record()]
				)
			).toEqual({ ok: false, summary: 'credentials rejected' });

			vi.stubGlobal(
				'fetch',
				vi.fn(async () => new Response('boom', { status: 500 }))
			);
			const other = await deliverBatch(
				{ host: 'https://lf.example.com', publicKey: 'pk', captureMode: 'content' },
				'sk-super-secret',
				[record()]
			);
			expect(other).toEqual({ ok: false, summary: 'ingestion failed (HTTP 500)' });

			for (const spy of [logSpy, warnSpy, errorSpy]) {
				for (const call of spy.mock.calls) {
					expect(JSON.stringify(call)).not.toContain('sk-super-secret');
				}
			}
		} finally {
			logSpy.mockRestore();
			warnSpy.mockRestore();
			errorSpy.mockRestore();
			vi.unstubAllGlobals();
		}
	});
});
