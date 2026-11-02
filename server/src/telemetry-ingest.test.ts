import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelemetryEventRecord } from '@mayon/shared';
import {
	configureTelemetryIngest,
	deliverBatch,
	enqueueTelemetry,
	getTelemetryPipelineStatus,
	probeLangfuse,
	resetTelemetryQueue,
	toOtlpSpans,
	type OtlpSpan
} from './telemetry-ingest';

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

function spanAttributes(
	span: OtlpSpan
): Record<string, { stringValue?: string; intValue?: string }> {
	return Object.fromEntries(span.attributes.map((a) => [a.key, a.value]));
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

function bodySpans(body: Record<string, unknown>): Array<{ traceId: string }> {
	return (
		body as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ traceId: string }> }> }> }
	).resourceSpans[0].scopeSpans[0].spans;
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
		const first = bodySpans(fetchBodies(fetchMock)[0]);
		const traceIds = first.map((span) => span.traceId);
		expect(traceIds).toEqual(Array.from({ length: 20 }, (_, i) => `r-${i + 5}`.replace(/-/g, '')));

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
				.mockImplementation(async () => okResponse())
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

describe('OTLP span mapping', () => {
	it('maps one record to a generation span exactly per the contract', () => {
		const rec = record({
			input: { system: 'sys', messages: [{ role: 'user', content: 'q' }] },
			output: 'answer',
			usage: { input: 10, output: 5, total: 15 }
		});
		const spans = toOtlpSpans([rec], 'content');
		expect(spans).toHaveLength(1);
		const span = spans[0];
		expect(span.traceId).toBe(rec.id.replace(/-/g, ''));
		expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
		expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
		expect(span.name).toBe('chat-turn');
		expect(span.kind).toBe(1);
		const startNanos = BigInt(Date.parse(rec.startedAt)) * 1_000_000n;
		expect(span.startTimeUnixNano).toBe(String(startNanos));
		expect(span.endTimeUnixNano).toBe(String((startNanos / 1_000_000n + 42n) * 1_000_000n));
		const attrs = spanAttributes(span);
		expect(attrs['langfuse.observation.type']).toEqual({ stringValue: 'generation' });
		expect(attrs['langfuse.session.id']).toEqual({ stringValue: 'chat-1' });
		expect(attrs['gen_ai.request.model']).toEqual({ stringValue: 'mock-sink' });
		expect(attrs['mayon.provider']).toEqual({ stringValue: 'openai-compatible' });
		expect(attrs['mayon.outcome']).toEqual({ stringValue: 'success' });
		expect(attrs['mayon.capture_mode']).toEqual({ stringValue: 'content' });
		expect(attrs['gen_ai.usage.input_tokens']).toEqual({ intValue: '10' });
		expect(attrs['gen_ai.usage.output_tokens']).toEqual({ intValue: '5' });
		expect(attrs['gen_ai.usage.total_tokens']).toEqual({ intValue: '15' });
		expect(attrs['gen_ai.prompt']).toEqual({ stringValue: JSON.stringify(rec.input) });
		expect(attrs['gen_ai.completion']).toEqual({ stringValue: 'answer' });
		expect('error.type' in attrs).toBe(false);
	});

	it('omits content/usage attributes when absent and flags errors via error.type in metadata mode', () => {
		const rec = record({ outcome: 'error', errorDetail: 'provider 429' });
		const [span] = toOtlpSpans([rec], 'metadata');
		const attrs = spanAttributes(span);
		expect(attrs['mayon.capture_mode']).toEqual({ stringValue: 'metadata' });
		expect(attrs['mayon.outcome']).toEqual({ stringValue: 'error' });
		expect(attrs['error.type']).toEqual({ stringValue: 'provider 429' });
		expect('gen_ai.prompt' in attrs).toBe(false);
		expect('gen_ai.completion' in attrs).toBe(false);
		expect('gen_ai.usage.input_tokens' in attrs).toBe(false);
		expect('gen_ai.usage.output_tokens' in attrs).toBe(false);
		expect('gen_ai.usage.total_tokens' in attrs).toBe(false);
	});

	it('generates a fresh random spanId per span', () => {
		const spans = toOtlpSpans(
			[record(), record({ id: '22222222-2222-4222-8222-222222222222' })],
			'content'
		);
		expect(spans[0].spanId).not.toBe(spans[1].spanId);
	});

	it('never maps record content into spans in metadata mode even if a record slipped through', () => {
		const rec = record({ input: { system: 'leak' }, output: 'leak' });
		const [span] = toOtlpSpans([rec], 'metadata');
		const attrs = spanAttributes(span);
		expect('gen_ai.prompt' in attrs).toBe(false);
		expect('gen_ai.completion' in attrs).toBe(false);
	});
});

describe('deliverBatch (OTLP)', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('POSTs spans to {host}/api/public/otel/v1/traces with Basic auth and the v4 ingestion header', async () => {
		const fetchMock = vi.fn(async () => okResponse());
		vi.stubGlobal('fetch', fetchMock);
		const result = await deliverBatch(
			{ host: 'https://lf.example.com', publicKey: 'pk-lf-p', captureMode: 'metadata' },
			'sk-lf-s',
			[record(), record({ id: '22222222-2222-4222-8222-222222222222' })]
		);
		expect(result).toEqual({ ok: true });
		const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
		expect(String(url)).toBe('https://lf.example.com/api/public/otel/v1/traces');
		expect(init.method).toBe('POST');
		expect(init.headers).toMatchObject({
			authorization: `Basic ${Buffer.from('pk-lf-p:sk-lf-s').toString('base64')}`,
			'content-type': 'application/json',
			'x-langfuse-ingestion-version': '4'
		});
		const body = JSON.parse(init.body as string) as {
			resourceSpans: Array<{
				resource: { attributes: Array<{ key: string; value: unknown }> };
				scopeSpans: Array<{ spans: unknown[] }>;
			}>;
		};
		expect(body.resourceSpans).toHaveLength(1);
		expect(body.resourceSpans[0].resource.attributes).toEqual([
			{ key: 'service.name', value: { stringValue: 'mayon' } }
		]);
		expect(body.resourceSpans[0].scopeSpans[0].spans).toHaveLength(2);
	});

	it('treats HTTP 207 with legacy per-event errors as failure carrying the first message', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							successes: [],
							errors: [
								{ id: 'event-1', status: 400, message: 'Event type "trace-create" is not accepted' }
							]
						}),
						{ status: 207 }
					)
			)
		);
		expect(
			await deliverBatch(
				{ host: 'https://lf.example.com', publicKey: 'pk', captureMode: 'content' },
				'sk',
				[record()]
			)
		).toEqual({ ok: false, summary: 'Event type "trace-create" is not accepted' });
	});

	it('treats a populated OTLP partialSuccess.errorMessage as failure, and an empty one as success', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							partialSuccess: { rejectedSpans: 2, errorMessage: 'invalid trace id' }
						}),
						{ status: 200 }
					)
			)
		);
		expect(
			await deliverBatch(
				{ host: 'https://lf.example.com', publicKey: 'pk', captureMode: 'content' },
				'sk',
				[record()]
			)
		).toEqual({ ok: false, summary: 'invalid trace id' });

		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ partialSuccess: { errorMessage: '' } }), { status: 200 })
			)
		);
		expect(
			await deliverBatch(
				{ host: 'https://lf.example.com', publicKey: 'pk', captureMode: 'content' },
				'sk',
				[record()]
			)
		).toEqual({ ok: true });
	});

	it('truncates long rejection messages to a sane length', async () => {
		const long = 'x'.repeat(500);
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ partialSuccess: { errorMessage: long } }), { status: 200 })
			)
		);
		const result = await deliverBatch(
			{ host: 'https://lf.example.com', publicKey: 'pk', captureMode: 'content' },
			'sk',
			[record()]
		);
		expect(result).toEqual({ ok: false, summary: `${'x'.repeat(297)}...` });
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
