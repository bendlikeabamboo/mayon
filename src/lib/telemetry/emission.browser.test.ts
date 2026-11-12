import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpResponse, http } from 'msw';
import type { TelemetryEventRecord } from '@mayon/shared';

import { worker } from '../../../tests/mocks/browser';
import { captureChatTurn } from './capture';
import { telemetryState } from './state.svelte';

// The capture path only reads `repos` through boot init, which this test never
// calls; stub the DB module so the browser test needs no storage backend.
vi.mock('#lib/db/index.js', () => ({
	repos: {
		settings: {
			get: async () => null,
			set: async () => {},
			delete: async () => {}
		}
	}
}));

interface CapturedRequest {
	method: string;
	url: string;
	records: TelemetryEventRecord[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EVENTS_ENDPOINT = /\/api\/telemetry\/events$/;

let captured: CapturedRequest | null = null;

beforeAll(async () => {
	await worker.start({ onUnhandledRequest: 'error', quiet: true });
	worker.use(
		http.post(EVENTS_ENDPOINT, async ({ request }) => {
			const body = (await request.json()) as { records: TelemetryEventRecord[] };
			captured = { method: request.method, url: request.url, records: body.records };
			return HttpResponse.json({ ok: true });
		})
	);
});

afterAll(() => {
	worker.stop();
});

beforeEach(() => {
	captured = null;
	telemetryState.applyConfig({
		enabled: true,
		host: '',
		publicKey: '',
		captureMode: 'content',
		updatedAt: '2026-10-31T00:00:00.000Z'
	});
});

describe('client telemetry emission payload', () => {
	it('relays chat-turn records to /api/telemetry/events with the contract shape', async () => {
		// 50 records fill the relay window and flush immediately, so the test
		// observes the network boundary without a fixed wait.
		for (let i = 0; i < 50; i++) {
			captureChatTurn({
				chatId: `chat-${i}`,
				model: 'mock-sink',
				provider: 'openai-compatible',
				startedAt: new Date(1_700_000_000_000 + i).toISOString(),
				durationMs: 42,
				outcome: 'success',
				input: { system: 'sys', messages: [{ role: 'user', content: 'hello' }] },
				output: 'answer',
				usage: { input: 1, output: 2, total: 3 }
			});
		}

		await expect.poll(() => captured?.records.length).toBe(50);
		const request = captured!;
		expect(request.method).toBe('POST');
		expect(new URL(request.url).pathname).toBe('/api/telemetry/events');

		const first = request.records[0]!;
		expect(first.id).toMatch(UUID_RE);
		expect(first).toMatchObject({
			kind: 'chat-turn',
			chatId: 'chat-0',
			model: 'mock-sink',
			provider: 'openai-compatible',
			startedAt: '2023-11-14T22:13:20.000Z',
			durationMs: 42,
			outcome: 'success',
			input: { system: 'sys', messages: [{ role: 'user', content: 'hello' }] },
			output: 'answer',
			usage: { input: 1, output: 2, total: 3 }
		});
		expect(first.truncated).toBeUndefined();
	});
});
