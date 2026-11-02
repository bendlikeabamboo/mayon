import { expect, type APIRequestContext } from '@playwright/test';
import { test } from './fixtures/onboard';
import { LATE_MARKER } from './fixtures/kitchen-sink';
import { openKitchenSinkReply } from './fixtures/render';

// The stub receiver is published to the host for assertions; the server dials
// it inside the compose network via the config host http://langfuse-stub:9998.
const STUB_URL = 'http://127.0.0.1:9998';
const STUB_HOST = 'http://langfuse-stub:9998';
const PUBLIC_KEY = 'pk-lf-e2e-stub';

interface StubSpan {
	traceId: string;
	spanId: string;
	name: string;
	attributes?: Array<{ key: string; value: { stringValue?: string; intValue?: string } }>;
}

interface StubData {
	batches: number;
	received: Array<{ authorization: string | null; spans: StubSpan[] }>;
	spans: StubSpan[];
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
		if (Date.now() > deadline) throw new Error('langfuse-stub did not receive the expected spans');
		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}
}

/** Attribute value by key (string or int), or undefined when absent. */
function attr(span: StubSpan, key: string): string | undefined {
	const found = span.attributes?.find((a) => a.key === key);
	return found?.value?.stringValue ?? found?.value?.intValue;
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

/** Spans of one event kind within one chat session. */
function sessionSpans(data: StubData, name: string, sessionId: string): StubSpan[] {
	return data.spans.filter((s) => s.name === name && attr(s, 'langfuse.session.id') === sessionId);
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
				(d) => sessionSpans(d, 'chat-turn', chatId).length >= 2
			);

			const turns = sessionSpans(data, 'chat-turn', chatId);
			expect(turns.length).toBeGreaterThanOrEqual(2);
			for (const span of turns) {
				// Span identity: 32-hex trace id, INTERNAL kind sibling fields.
				expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
				// Session grouping + provider/outcome/capture dimensions.
				expect(attr(span, 'langfuse.session.id')).toBe(chatId);
				expect(attr(span, 'mayon.provider')).toBe('openai-compatible');
				expect(attr(span, 'mayon.outcome')).toBe('success');
				expect(attr(span, 'mayon.capture_mode')).toBe('content');
				// Generation mapping: model + usage {1,1,2} from the mock's
				// terminal frame, and full input/output content.
				expect(attr(span, 'gen_ai.request.model')).toBe('mock-sink');
				expect(attr(span, 'gen_ai.usage.input_tokens')).toBe('1');
				expect(attr(span, 'gen_ai.usage.output_tokens')).toBe('1');
				expect(attr(span, 'gen_ai.usage.total_tokens')).toBe('2');
				const prompt = attr(span, 'gen_ai.prompt');
				expect(typeof prompt).toBe('string');
				expect(prompt!.length).toBeGreaterThan(0);
				const completion = attr(span, 'gen_ai.completion');
				expect(typeof completion).toBe('string');
				expect(completion!.length).toBeGreaterThan(0);
				expect(typeof span.attributes?.find((a) => a.key === 'error.type')).toBe('undefined');
			}

			// Side generators ride the same session: auto-title fires on turn one.
			const titleSpans = sessionSpans(data, 'title', chatId);
			expect(titleSpans.length).toBeGreaterThanOrEqual(1);
			expect(attr(titleSpans[0]!, 'gen_ai.request.model')).toBe('mock-sink');
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

			const data = await waitForStub(
				request,
				(d) =>
					sessionSpans(d, 'chat-turn', chatId).filter((s) => attr(s, 'mayon.outcome') === 'aborted')
						.length > 0
			);

			const aborted = sessionSpans(data, 'chat-turn', chatId).find(
				(s) => attr(s, 'mayon.outcome') === 'aborted'
			);
			expect(aborted).toBeDefined();
			expect(attr(aborted!, 'gen_ai.request.model')).toBe('mock-sink');
			// Aborted outcome carries no error detail; the turn simply stops.
			expect(aborted!.attributes?.find((a) => a.key === 'error.type')).toBeUndefined();
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
				(d) => sessionSpans(d, 'chat-turn', chatId).length >= 1
			);

			// Structure intact: session linkage, capture mode, model, usage, timing.
			const turns = sessionSpans(data, 'chat-turn', chatId);
			expect(turns.length).toBeGreaterThanOrEqual(1);
			for (const span of turns) {
				expect(attr(span, 'langfuse.session.id')).toBe(chatId);
				expect(attr(span, 'mayon.capture_mode')).toBe('metadata');
				expect(attr(span, 'gen_ai.request.model')).toBe('mock-sink');
				expect(attr(span, 'gen_ai.usage.input_tokens')).toBe('1');
				expect(attr(span, 'gen_ai.usage.output_tokens')).toBe('1');
				expect(attr(span, 'gen_ai.usage.total_tokens')).toBe('2');
			}

			// Absent, not empty: no span carries prompt/completion attributes.
			for (const span of data.spans) {
				expect(span.attributes?.find((a) => a.key === 'gen_ai.prompt')).toBeUndefined();
				expect(span.attributes?.find((a) => a.key === 'gen_ai.completion')).toBeUndefined();
			}
			// The passphrase appears nowhere in anything the stub received (SC-005).
			expect(JSON.stringify(data)).not.toContain(PASSPHRASE);
		} finally {
			await disableTelemetry(request);
		}
	});
});
