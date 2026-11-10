import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useFileTestDb } from '#lib/db/driver/pg-test.js';
import { repos } from '#lib/db/index.js';
import type { TelemetryConfig, TelemetryEventRecord } from '@mayon/shared';
import { telemetryState } from './state.svelte';
import { buildChatTurnRecord, captureChatTurn, captureGenerator, emitTelemetry } from './capture';
import { relayTelemetry } from './relay';

const testDb = useFileTestDb();
beforeAll(() => testDb.setup());
beforeEach(() => testDb.reset());
afterAll(() => testDb.teardown());

function config(overrides?: Partial<TelemetryConfig>): TelemetryConfig {
	return {
		enabled: false,
		host: '',
		publicKey: '',
		captureMode: 'content',
		updatedAt: '2026-10-31T00:00:00.000Z',
		...overrides
	};
}

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

describe('telemetryState boot init', () => {
	it('defaults to disabled when the settings row is absent', async () => {
		await telemetryState.init();
		expect(telemetryState.enabled).toBe(false);
		expect(telemetryState.host).toBe('');
		expect(telemetryState.publicKey).toBe('');
		expect(telemetryState.captureMode).toBe('content');
	});

	it('reflects a stored telemetry settings row', async () => {
		await repos.settings.set('telemetry', config({ enabled: true, captureMode: 'metadata' }));
		await telemetryState.init();
		expect(telemetryState.enabled).toBe(true);
		expect(telemetryState.captureMode).toBe('metadata');
	});

	it('falls back to disabled on a corrupt settings row', async () => {
		await repos.settings.set('telemetry', { enabled: 'yes' });
		await telemetryState.init();
		expect(telemetryState.enabled).toBe(false);
		expect(telemetryState.captureMode).toBe('content');
	});

	it('applyConfig applies an accepted config without re-reading the db', async () => {
		await telemetryState.init();
		telemetryState.applyConfig(
			config({
				enabled: true,
				host: 'https://lf.example.com',
				publicKey: 'pk-lf-x'
			})
		);
		expect(telemetryState.enabled).toBe(true);
		expect(telemetryState.host).toBe('https://lf.example.com');
		expect(telemetryState.publicKey).toBe('pk-lf-x');
	});
});

describe('emitTelemetry (FR-002)', () => {
	it('no-ops synchronously when disabled: returns immediately, buffers nothing, makes no network calls', async () => {
		await telemetryState.init();
		expect(telemetryState.enabled).toBe(false);
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		try {
			expect(emitTelemetry(record({ input: { prompt: 'secret' }, output: 'reply' }))).toBe(
				undefined
			);
			expect(fetchMock).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FIELD_CAP = 128 * 1024;

describe('buildChatTurnRecord (chat-turn assembly from the trace seam)', () => {
	it('assembles kind, chatId, model, provider, duration, outcome, usage, input, and output', () => {
		const rec = buildChatTurnRecord({
			chatId: 'chat-9',
			model: 'mock-sink',
			provider: 'openai-compatible',
			startedAt: '2026-10-31T00:00:00.000Z',
			durationMs: 1234,
			outcome: 'success',
			input: {
				system: 'sys',
				messages: [
					{ role: 'user', content: 'q' },
					{ role: 'assistant', content: 'a' }
				]
			},
			output: 'final text',
			usage: { input: 10, output: 5, total: 15 }
		});
		expect(rec.id).toMatch(UUID_RE);
		expect(rec.kind).toBe('chat-turn');
		expect(rec.chatId).toBe('chat-9');
		expect(rec.model).toBe('mock-sink');
		expect(rec.provider).toBe('openai-compatible');
		expect(rec.startedAt).toBe('2026-10-31T00:00:00.000Z');
		expect(rec.durationMs).toBe(1234);
		expect(rec.outcome).toBe('success');
		expect(rec.usage).toEqual({ input: 10, output: 5, total: 15 });
		expect(rec.input).toEqual({
			system: 'sys',
			messages: [
				{ role: 'user', content: 'q' },
				{ role: 'assistant', content: 'a' }
			]
		});
		expect(rec.output).toBe('final text');
		expect(rec.truncated).toBeUndefined();
	});

	it('caps each content field at ~128KiB and marks the record truncated', () => {
		const big = 'x'.repeat(FIELD_CAP + 10);
		const rec = buildChatTurnRecord({
			chatId: 'chat-9',
			model: 'm',
			provider: 'p',
			startedAt: '2026-10-31T00:00:00.000Z',
			durationMs: 1,
			outcome: 'success',
			input: { system: big, messages: [{ role: 'user', content: big }] },
			output: big
		});
		expect(rec.output).toHaveLength(FIELD_CAP);
		const input = rec.input as { system: string; messages: Array<{ content: string }> };
		expect(input.system).toHaveLength(FIELD_CAP);
		expect(input.messages[0]!.content).toHaveLength(FIELD_CAP);
		expect(rec.truncated).toBe(true);
	});

	it('carries error detail and aborted outcome without content loss', () => {
		const rec = buildChatTurnRecord({
			chatId: 'chat-9',
			model: 'm',
			provider: 'p',
			startedAt: '2026-10-31T00:00:00.000Z',
			durationMs: 5,
			outcome: 'aborted',
			errorDetail: 'stopped by user',
			output: 'partial'
		});
		expect(rec.outcome).toBe('aborted');
		expect(rec.errorDetail).toBe('stopped by user');
		expect(rec.output).toBe('partial');
	});
});

describe('metadata capture mode strips content at assembly (FR-008/FR-009)', () => {
	const capture = {
		chatId: 'chat-9',
		model: 'mock-sink',
		provider: 'openai-compatible',
		startedAt: '2026-10-31T00:00:00.000Z',
		durationMs: 9,
		outcome: 'success' as const,
		input: {
			system: 'secret system',
			messages: [{ role: 'user', content: 'PASSPHRASE-IN' }]
		},
		output: 'PASSPHRASE-OUT',
		usage: { input: 3, output: 4, total: 7 }
	};

	afterEach(() => {
		telemetryState.applyConfig(config({ enabled: true, captureMode: 'content' }));
	});

	it('omits input and output keys entirely (absent, not empty) from chat-turn records', () => {
		telemetryState.applyConfig(config({ enabled: true, captureMode: 'metadata' }));
		const rec = buildChatTurnRecord(capture);
		expect('input' in rec).toBe(false);
		expect('output' in rec).toBe(false);
		expect(rec.input).toBeUndefined();
		expect(rec.output).toBeUndefined();
		// Structure stays intact: kind/chatId/model/provider/timing/outcome/usage.
		expect(rec.kind).toBe('chat-turn');
		expect(rec.chatId).toBe('chat-9');
		expect(rec.model).toBe('mock-sink');
		expect(rec.provider).toBe('openai-compatible');
		expect(rec.startedAt).toBe('2026-10-31T00:00:00.000Z');
		expect(rec.durationMs).toBe(9);
		expect(rec.outcome).toBe('success');
		expect(rec.usage).toEqual({ input: 3, output: 4, total: 7 });
	});

	it('reads the mode per record: metadata→content switch restores content on the next record', () => {
		telemetryState.applyConfig(config({ enabled: true, captureMode: 'metadata' }));
		expect('output' in buildChatTurnRecord(capture)).toBe(false);
		telemetryState.applyConfig(config({ enabled: true, captureMode: 'content' }));
		const rec = buildChatTurnRecord(capture);
		expect(rec.output).toBe('PASSPHRASE-OUT');
		expect(rec.input).toEqual(capture.input);
	});

	it('never sets the truncation marker in metadata mode because no content is carried', () => {
		telemetryState.applyConfig(config({ enabled: true, captureMode: 'metadata' }));
		const rec = buildChatTurnRecord({ ...capture, input: { system: 'x'.repeat(FIELD_CAP + 10) } });
		expect('input' in rec).toBe(false);
		expect(rec.truncated).toBeUndefined();
	});

	it('content mode keeps the truncation marker (regression)', () => {
		telemetryState.applyConfig(config({ enabled: true, captureMode: 'content' }));
		const rec = buildChatTurnRecord({ ...capture, output: 'x'.repeat(FIELD_CAP + 10) });
		expect(rec.output).toHaveLength(FIELD_CAP);
		expect(rec.truncated).toBe(true);
	});
});

describe('capture + relay pipeline', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers();
		fetchMock = vi.fn(async () => new Response('{}', { status: 202 }));
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(async () => {
		telemetryState.applyConfig(config({ enabled: false }));
		await vi.advanceTimersByTimeAsync(5001);
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('captureChatTurn relays the assembled record to POST /api/telemetry/events after the 5s window', async () => {
		telemetryState.applyConfig(config({ enabled: true }));
		captureChatTurn({
			chatId: 'chat-9',
			model: 'mock-sink',
			provider: 'openai-compatible',
			startedAt: '2026-10-31T00:00:00.000Z',
			durationMs: 7,
			outcome: 'success',
			input: { system: 'sys', messages: [{ role: 'user', content: 'hi' }] },
			output: 'yo',
			usage: { input: 1, output: 2, total: 3 }
		});
		await vi.advanceTimersByTimeAsync(4999);
		expect(fetchMock).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/telemetry/events');
		expect(init.method).toBe('POST');
		const body = JSON.parse(init.body as string) as { records: TelemetryEventRecord[] };
		expect(body.records).toHaveLength(1);
		expect(body.records[0]).toMatchObject({
			kind: 'chat-turn',
			chatId: 'chat-9',
			model: 'mock-sink',
			provider: 'openai-compatible',
			output: 'yo'
		});
	});

	it('a composed turn relays the chat-turn and title records with session, model, usage, and content intact', async () => {
		telemetryState.applyConfig(config({ enabled: true }));
		captureChatTurn({
			chatId: 'chat-42',
			model: 'mock-sink',
			provider: 'openai-compatible',
			startedAt: '2026-10-31T00:00:00.000Z',
			durationMs: 11,
			outcome: 'success',
			input: {
				system: 'sys',
				messages: [{ role: 'user', content: 'TURN-PROMPT' }]
			},
			output: 'TURN-REPLY',
			usage: { input: 1, output: 1, total: 2 }
		});
		// Side generator on turn one: auto-title rides the same chat session.
		captureGenerator('title', {
			chatId: 'chat-42',
			model: 'mock-sink',
			provider: 'openai-compatible',
			startedAt: Date.now() - 10,
			input: {
				system: 'You generate titles.',
				messages: [{ role: 'user', content: 'TURN-PROMPT' }]
			},
			output: 'The Title',
			usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
		});
		await vi.advanceTimersByTimeAsync(5000);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
			records: TelemetryEventRecord[];
		};
		expect(body.records).toHaveLength(2);
		const [turn, title] = body.records;
		expect(turn).toMatchObject({
			kind: 'chat-turn',
			chatId: 'chat-42',
			model: 'mock-sink',
			provider: 'openai-compatible',
			outcome: 'success',
			usage: { input: 1, output: 1, total: 2 }
		});
		expect(turn.errorDetail).toBeUndefined();
		expect(turn.output).toBe('TURN-REPLY');
		expect((turn.input as { messages: Array<{ content: string }> }).messages.at(-1)?.content).toBe(
			'TURN-PROMPT'
		);
		expect(title).toMatchObject({
			kind: 'title',
			// Session grouping: the title span shares the chat's session id.
			chatId: 'chat-42',
			model: 'mock-sink',
			provider: 'openai-compatible',
			outcome: 'success',
			usage: { input: 1, output: 1, total: 2 }
		});
		expect(title.output).toBe('The Title');
	});

	it('an aborted turn relays the aborted chat-turn record without an error detail', async () => {
		telemetryState.applyConfig(config({ enabled: true }));
		captureChatTurn({
			chatId: 'chat-42',
			model: 'mock-sink',
			provider: 'openai-compatible',
			startedAt: '2026-10-31T00:00:00.000Z',
			durationMs: 3,
			outcome: 'aborted',
			output: 'partial text'
		});
		await vi.advanceTimersByTimeAsync(5000);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
			records: TelemetryEventRecord[];
		};
		expect(body.records).toHaveLength(1);
		const rec = body.records[0];
		expect(rec.outcome).toBe('aborted');
		expect(rec.model).toBe('mock-sink');
		// Aborted is not an error: no error detail rides the record.
		expect('errorDetail' in rec).toBe(false);
		expect(rec.output).toBe('partial text');
	});

	it('metadata mode relays a composed turn whose delivered payload never carries conversation text', async () => {
		const PASSPHRASE = 'ZEBRA-42-TELEMETRY';
		telemetryState.applyConfig(config({ enabled: true, captureMode: 'metadata' }));
		captureChatTurn({
			chatId: 'chat-42',
			model: 'mock-sink',
			provider: 'openai-compatible',
			startedAt: '2026-10-31T00:00:00.000Z',
			durationMs: 5,
			outcome: 'success',
			input: {
				system: 'sys',
				messages: [{ role: 'user', content: `Remember ${PASSPHRASE} for later` }]
			},
			output: `I will keep ${PASSPHRASE} secret`,
			usage: { input: 1, output: 1, total: 2 }
		});
		captureGenerator('title', {
			chatId: 'chat-42',
			model: 'mock-sink',
			provider: 'openai-compatible',
			startedAt: Date.now() - 10,
			input: {
				system: 'You generate titles.',
				messages: [{ role: 'user', content: `Remember ${PASSPHRASE}` }]
			},
			output: 'A Secret Chat',
			usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
		});
		await vi.advanceTimersByTimeAsync(5000);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const raw = (fetchMock.mock.calls[0]![1] as RequestInit).body as string;
		// SC-005: the passphrase appears nowhere in anything delivered.
		expect(raw).not.toContain(PASSPHRASE);
		const body = JSON.parse(raw) as { records: TelemetryEventRecord[] };
		expect(body.records).toHaveLength(2);
		for (const rec of body.records) {
			// Absent, not empty, on every record kind in the batch.
			expect('input' in rec).toBe(false);
			expect('output' in rec).toBe(false);
			// Structure stays intact per mode semantics.
			expect(rec.kind === 'chat-turn' || rec.kind === 'title').toBe(true);
			expect(rec.chatId).toBe('chat-42');
			expect(rec.model).toBe('mock-sink');
			expect(rec.provider).toBe('openai-compatible');
			expect(rec.outcome).toBe('success');
			expect(rec.usage).toEqual({ input: 1, output: 1, total: 2 });
		}
	});

	it('captureChatTurn never throws into the caller when relaying fails', async () => {
		telemetryState.applyConfig(config({ enabled: true }));
		fetchMock.mockRejectedValue(new Error('down'));
		expect(() =>
			captureChatTurn({
				chatId: 'chat-9',
				model: 'm',
				provider: 'p',
				startedAt: '2026-10-31T00:00:00.000Z',
				durationMs: 1,
				outcome: 'error',
				errorDetail: 'down'
			})
		).not.toThrow();
		await vi.advanceTimersByTimeAsync(5000);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('relay bounds the buffer at 50 records per window, dropping the oldest', async () => {
		telemetryState.applyConfig(config({ enabled: true }));
		for (let i = 0; i < 60; i++) relayTelemetry(record({ id: `r-${i}` }));
		await vi.advanceTimersByTimeAsync(0);
		let body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
			records: TelemetryEventRecord[];
		};
		expect(body.records.map((r) => r.id)).toEqual(Array.from({ length: 50 }, (_, i) => `r-${i}`));
		await vi.advanceTimersByTimeAsync(5000);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		body = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string) as {
			records: TelemetryEventRecord[];
		};
		expect(body.records.map((r) => r.id)).toEqual(
			Array.from({ length: 10 }, (_, i) => `r-${i + 50}`)
		);
	});

	it('relay retries failed records in the next window', async () => {
		telemetryState.applyConfig(config({ enabled: true }));
		fetchMock.mockRejectedValueOnce(new Error('down'));
		for (let i = 0; i < 3; i++) relayTelemetry(record({ id: `r-${i}` }));
		await vi.advanceTimersByTimeAsync(5000);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(5000);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const body = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string) as {
			records: TelemetryEventRecord[];
		};
		expect(body.records.map((r) => r.id)).toEqual(['r-0', 'r-1', 'r-2']);
	});

	it('relay evicts the oldest records when retry restores exceed the 50 bound', async () => {
		telemetryState.applyConfig(config({ enabled: true }));
		fetchMock.mockRejectedValue(new Error('down'));
		for (let i = 0; i < 50; i++) relayTelemetry(record({ id: `r-${i}` }));
		await vi.advanceTimersByTimeAsync(0); // flush #1 fails, 50 restored
		for (let i = 0; i < 5; i++) relayTelemetry(record({ id: `n-${i}` })); // 55 → trim to 50
		await vi.advanceTimersByTimeAsync(5000); // flush #2 (immediate at the 50 bound) + retry #3
		expect(fetchMock).toHaveBeenCalledTimes(3);
		// Oldest record evicted under pressure: r-0 is gone, retry carries r-1.. first.
		const body = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string) as {
			records: TelemetryEventRecord[];
		};
		expect(body.records.map((r) => r.id)).toEqual([
			...Array.from({ length: 49 }, (_, i) => `r-${i + 1}`),
			'n-0'
		]);
	});

	it('relay discards the buffer when telemetry is disabled and stays silent', async () => {
		telemetryState.applyConfig(config({ enabled: true }));
		for (let i = 0; i < 3; i++) relayTelemetry(record({ id: `r-${i}` }));
		telemetryState.applyConfig(config({ enabled: false }));
		await vi.advanceTimersByTimeAsync(20_000);
		expect(fetchMock).not.toHaveBeenCalled();
		relayTelemetry(record({ id: 'r-late' }));
		await vi.advanceTimersByTimeAsync(20_000);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('relay never lets a delivery rejection escape into caller code', async () => {
		telemetryState.applyConfig(config({ enabled: true }));
		fetchMock.mockRejectedValue(new Error('persistent outage'));
		relayTelemetry(record());
		await vi.advanceTimersByTimeAsync(5000);
		await vi.advanceTimersByTimeAsync(5000);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
