import { expect, type APIRequestContext } from '@playwright/test';
import { test } from './fixtures/onboard';
import { LATE_MARKER } from './fixtures/kitchen-sink';
import { openKitchenSinkReply } from './fixtures/render';

// The stub receiver is published to the host for assertions; the server dials
// it inside the compose network via the config host http://langfuse-stub:9998.
const STUB_URL = 'http://127.0.0.1:9998';
const STUB_HOST = 'http://langfuse-stub:9998';
const PUBLIC_KEY = 'pk-lf-e2e-stub';

interface LangfuseEvent {
	id: string;
	type: string;
	body: Record<string, unknown>;
}

interface StubData {
	batches: number;
	received: Array<{ authorization: string | null; batch: LangfuseEvent[] }>;
	events: LangfuseEvent[];
}

async function stubData(request: APIRequestContext): Promise<StubData> {
	const res = await request.get(`${STUB_URL}/__received`);
	expect(res.ok()).toBeTruthy();
	return (await res.json()) as StubData;
}

/** Poll the stub until `pred` holds, returning the matching snapshot. */
async function waitForStub(
	request: APIRequestContext,
	pred: (data: StubData) => boolean,
	timeoutMs = 45_000
): Promise<StubData> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const data = await stubData(request);
		if (pred(data)) return data;
		if (Date.now() > deadline) throw new Error('langfuse-stub did not receive the expected events');
		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}
}

async function enableTelemetry(request: APIRequestContext): Promise<void> {
	const res = await request.put('/api/telemetry/config', {
		data: {
			enabled: true,
			host: STUB_HOST,
			publicKey: PUBLIC_KEY,
			captureMode: 'content'
		}
	});
	expect(res.ok()).toBeTruthy();
}

async function disableTelemetry(request: APIRequestContext): Promise<void> {
	await request.put('/api/telemetry/config', { data: { enabled: false } });
}

async function resetStub(request: APIRequestContext): Promise<void> {
	const res = await request.post(`${STUB_URL}/__reset`);
	expect(res.ok()).toBeTruthy();
}

/** Trace-create events for one kind and session, paired with their generation observation. */
function traceWithObservation(
	data: StubData,
	name: string,
	sessionId: string
): Array<{ trace: LangfuseEvent; observation: LangfuseEvent | undefined }> {
	return data.events
		.filter(
			(e) => e.type === 'trace-create' && e.body.name === name && e.body.sessionId === sessionId
		)
		.map((trace) => ({
			trace,
			observation: data.events.find(
				(e) => e.type === 'observation-create' && e.body.traceId === trace.body.id
			)
		}));
}

test.describe('telemetry delivers structured traces when enabled', () => {
	test('a two-turn conversation arrives grouped by chat with model, usage, and content (quickstart V2)', async ({
		onboarded,
		request
	}) => {
		test.setTimeout(120_000);
		const { page } = onboarded;
		await resetStub(request);
		try {
			await enableTelemetry(request);
			// Boot re-reads the settings row, arming the browser-side capture gate.
			await page.reload();
			await expect(page.getByPlaceholder(/Message the active provider/)).toBeVisible({
				timeout: 15_000
			});

			const chatId = page.url().split('/').pop() ?? '';
			expect(chatId).not.toBe('');

			// Two real turns through the mock provider (browser → proxy → mock-llm).
			await openKitchenSinkReply(page);
			const composer = page.getByPlaceholder(/Message the active provider/);
			await composer.fill('One more question, please');
			await page.getByRole('button', { name: 'Send', exact: true }).click();
			await expect(page.locator('.markdown-body').last()).toContainText(LATE_MARKER);

			// Relay (≤5s) + server flush (≤5s) + delivery; poll the stub.
			const data = await waitForStub(
				request,
				(d) => traceWithObservation(d, 'chat-turn', chatId).length >= 2
			);

			const turns = traceWithObservation(data, 'chat-turn', chatId);
			expect(turns.length).toBeGreaterThanOrEqual(2);
			for (const { trace, observation } of turns) {
				// Trace body: session grouping + tags + outcome metadata.
				expect(trace.body.name).toBe('chat-turn');
				expect(trace.body.sessionId).toBe(chatId);
				expect(trace.body.tags).toEqual(['chat-turn', 'openai-compatible', 'content']);
				expect(trace.body.metadata).toMatchObject({
					app: 'mayon',
					model: 'mock-sink',
					outcome: 'success'
				});
				// Generation observation: model, usage {1,1,2} from the mock's
				// terminal frame, and full input/output content.
				expect(observation).toBeDefined();
				const body = observation!.body;
				expect(body.type).toBe('generation');
				expect(body.name).toBe('chat-turn');
				expect(body.model).toBe('mock-sink');
				expect(body.usage).toEqual({ input: 1, output: 1, total: 2, unit: 'TOKENS' });
				expect(body.level).toBe('DEFAULT');
				const input = body.input as { system: string; messages: unknown[] };
				expect(typeof input.system).toBe('string');
				expect(input.system.length).toBeGreaterThan(0);
				expect(input.messages.length).toBeGreaterThan(0);
				expect(typeof body.output).toBe('string');
				expect((body.output as string).length).toBeGreaterThan(0);
				expect(typeof body.startTime).toBe('string');
				expect(typeof body.endTime).toBe('string');
			}

			// Side generators ride the same session: auto-title fires on turn one.
			const titleTraces = traceWithObservation(data, 'title', chatId);
			expect(titleTraces.length).toBeGreaterThanOrEqual(1);
			expect(titleTraces[0]!.observation!.body.model).toBe('mock-sink');
		} finally {
			await disableTelemetry(request);
		}
	});

	test('an aborted mid-stream turn arrives as an aborted record (quickstart V3, abort leg)', async ({
		onboarded,
		request
	}) => {
		test.setTimeout(120_000);
		const { page } = onboarded;
		await resetStub(request);
		try {
			await enableTelemetry(request);
			await page.reload();
			await expect(page.getByPlaceholder(/Message the active provider/)).toBeVisible({
				timeout: 15_000
			});

			const chatId = page.url().split('/').pop() ?? '';
			expect(chatId).not.toBe('');

			// Send and abort while the mock stream is still flowing. The mock has
			// no error affordance, so the abort leg stands in for the error leg at
			// this level (V3's error leg is covered by unit/inject-level tests).
			const composer = page.getByPlaceholder(/Message the active provider/);
			await composer.fill('Abort this reply midway');
			await page.getByRole('button', { name: 'Send', exact: true }).click();
			const stop = page.getByRole('button', { name: 'Stop' });
			await stop.click({ timeout: 5_000 });
			await expect(stop).toHaveCount(0, { timeout: 15_000 });

			const data = await waitForStub(request, (d) => {
				const aborted = d.events.filter(
					(e) =>
						e.type === 'trace-create' &&
						e.body.name === 'chat-turn' &&
						e.body.sessionId === chatId &&
						(e.body.metadata as Record<string, unknown> | undefined)?.outcome === 'aborted'
				);
				return aborted.length > 0;
			});

			const aborted = data.events.find(
				(e) =>
					e.type === 'trace-create' &&
					e.body.name === 'chat-turn' &&
					e.body.sessionId === chatId &&
					(e.body.metadata as Record<string, unknown> | undefined)?.outcome === 'aborted'
			);
			expect(aborted).toBeDefined();
			const observation = data.events.find(
				(e) => e.type === 'observation-create' && e.body.traceId === aborted!.body.id
			);
			expect(observation).toBeDefined();
			expect(observation!.body.model).toBe('mock-sink');
			// Aborted outcome maps to the non-error level; the turn simply stops.
			expect(observation!.body.level).toBe('DEFAULT');
		} finally {
			await disableTelemetry(request);
		}
	});
});

test.describe('telemetry metadata mode leaks no conversation text', () => {
	test('a metadata-mode conversation arrives with structure intact and the passphrase nowhere in the payload (quickstart V4)', async ({
		onboarded,
		request
	}) => {
		test.setTimeout(120_000);
		const { page } = onboarded;
		const PASSPHRASE = 'ZEBRA-42-TELEMETRY';
		await resetStub(request);
		try {
			const res = await request.put('/api/telemetry/config', {
				data: {
					enabled: true,
					host: STUB_HOST,
					publicKey: PUBLIC_KEY,
					captureMode: 'metadata'
				}
			});
			expect(res.ok()).toBeTruthy();
			// Boot re-reads the settings row, arming the browser-side capture gate.
			await page.reload();
			await expect(page.getByPlaceholder(/Message the active provider/)).toBeVisible({
				timeout: 15_000
			});

			const chatId = page.url().split('/').pop() ?? '';
			expect(chatId).not.toBe('');

			await page
				.getByPlaceholder(/Message the active provider/)
				.fill(`Remember ${PASSPHRASE} for later`);
			await page.getByRole('button', { name: 'Send', exact: true }).click();
			await expect(page.locator('.markdown-body').last()).toContainText(LATE_MARKER);

			const data = await waitForStub(
				request,
				(d) => traceWithObservation(d, 'chat-turn', chatId).length >= 1
			);

			// Structure intact: session linkage, tags, model, usage, timing.
			const turns = traceWithObservation(data, 'chat-turn', chatId);
			expect(turns.length).toBeGreaterThanOrEqual(1);
			for (const { trace, observation } of turns) {
				expect(trace.body.sessionId).toBe(chatId);
				expect(trace.body.tags).toEqual(['chat-turn', 'openai-compatible', 'metadata']);
				expect(observation).toBeDefined();
				expect(observation!.body.model).toBe('mock-sink');
				expect(observation!.body.usage).toEqual({
					input: 1,
					output: 1,
					total: 2,
					unit: 'TOKENS'
				});
				expect(typeof observation!.body.startTime).toBe('string');
			}

			// Absent, not empty: no observation carries input/output fields.
			for (const e of data.events) {
				if (e.type === 'observation-create') {
					expect('input' in e.body).toBe(false);
					expect('output' in e.body).toBe(false);
				}
			}
			// The passphrase appears nowhere in anything the stub received (SC-005).
			expect(JSON.stringify(data)).not.toContain(PASSPHRASE);
		} finally {
			await disableTelemetry(request);
		}
	});
});
