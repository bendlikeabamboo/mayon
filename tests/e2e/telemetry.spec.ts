import { expect, type APIRequestContext } from '@playwright/test';
import { test } from './fixtures/onboard';
import { LATE_MARKER } from './fixtures/kitchen-sink';
import { openKitchenSinkReply } from './fixtures/render';

// The stub receiver is published to the host for assertions; the server dials
// it inside the compose network via the config host http://langfuse-stub:9998.
// Span-field composition (session/model/usage/outcome/metadata absences) is
// proven in src/lib/telemetry/telemetry.test.ts (031 parity); this spec keeps
// only thin live-delivery checks per stub path — that the records actually
// arrive over the wire after the reload arming.
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
	test('a two-turn conversation arrives grouped by chat as chat-turn spans with an auto-title (quickstart V2)', async ({
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

			// Both turn records delivered under one session.
			expect(data.spans.length).toBeGreaterThanOrEqual(2);

			// Side generators ride the same session and delivery path:
			// auto-title fires on turn one.
			const titleSpans = sessionSpans(data, 'title', chatId);
			expect(titleSpans.length).toBeGreaterThanOrEqual(1);
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

			await waitForStub(
				request,
				(d) =>
					sessionSpans(d, 'chat-turn', chatId).filter((s) => attr(s, 'mayon.outcome') === 'aborted')
						.length > 0
			);
		} finally {
			await disableTelemetry(request);
		}
	});
});

test.describe('telemetry metadata mode delivery', () => {
	test('a metadata-mode conversation arrives with records intact (quickstart V4)', async ({
		onboarded,
		request
	}) => {
		test.setTimeout(120_000);
		const { page } = onboarded;
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

			await page.getByPlaceholder(/Message the active provider/).fill('Metadata probe');
			await page.getByRole('button', { name: 'Send', exact: true }).click();
			await expect(page.locator('.markdown-body').last()).toContainText(LATE_MARKER);

			await waitForStub(request, (d) => sessionSpans(d, 'chat-turn', chatId).length >= 1);
		} finally {
			await disableTelemetry(request);
		}
	});
});
