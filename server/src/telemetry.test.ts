import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './server';
import { DEFAULT_TELEMETRY_CONFIG, getTelemetryConfig, setTelemetryReset } from './telemetry';
import {
	enqueueTelemetry,
	getTelemetryPipelineStatus,
	resetTelemetryQueue
} from './telemetry-ingest';
import type Fastify from 'fastify';
import type { PgPoolLike } from './pg';
import type { TelemetryConfig, TelemetryEventRecord } from '@mayon/shared';

function mockPool(rows: unknown[] = []): {
	pool: PgPoolLike;
	query: ReturnType<typeof vi.fn>;
	end: ReturnType<typeof vi.fn>;
} {
	const query = vi.fn(async () => ({ rows, fields: [], rowCount: rows.length }));
	const end = vi.fn(async () => {});
	return { pool: { query, end } as unknown as PgPoolLike, query, end };
}

const VALID_ENABLE = {
	enabled: true,
	host: 'https://langfuse.example.com',
	publicKey: 'pk-lf-test-key',
	captureMode: 'content'
};

describe('PUT /api/telemetry/config', () => {
	let app: Fastify.Instance;
	const SUITE_SECRET = 'sk-lf-config-suite-secret';
	let savedSecret: string | undefined;

	beforeAll(async () => {
		app = buildApp(':memory:');
		await app.listen({ port: 0, host: '0.0.0.0' });
	});

	afterAll(async () => {
		await app.close();
	});

	// The probe path (US4) dials the destination on enable/destination change:
	// default the suite to a reachable destination with the env secret present.
	beforeEach(() => {
		savedSecret = process.env.MAYON_LANGFUSE_SECRET_KEY;
		process.env.MAYON_LANGFUSE_SECRET_KEY = SUITE_SECRET;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('[]', { status: 200 }))
		);
	});

	afterEach(() => {
		if (savedSecret === undefined) delete process.env.MAYON_LANGFUSE_SECRET_KEY;
		else process.env.MAYON_LANGFUSE_SECRET_KEY = savedSecret;
		vi.unstubAllGlobals();
	});

	it('accepts a valid config, persists the telemetry settings row, and returns 200 {ok, config}', async () => {
		const { pool, query } = mockPool();
		const telemetryApp = buildApp(':memory:', { pgPool: pool });
		await telemetryApp.listen({ port: 0, host: '0.0.0.0' });
		try {
			const res = await telemetryApp.inject({
				method: 'PUT',
				url: '/api/telemetry/config',
				payload: VALID_ENABLE
			});
			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.ok).toBe(true);
			expect(body.config.enabled).toBe(true);
			expect(body.config.host).toBe(VALID_ENABLE.host);
			expect(body.config.publicKey).toBe(VALID_ENABLE.publicKey);
			expect(body.config.captureMode).toBe('content');
			expect(Number.isNaN(Date.parse(body.config.updatedAt))).toBe(false);

			const insert = query.mock.calls.find((call) =>
				String(call[0]).includes('INSERT INTO settings')
			);
			expect(insert).toBeTruthy();
			expect(insert![1][0]).toBe('telemetry');
			expect(JSON.parse(insert![1][1])).toMatchObject({
				enabled: true,
				host: VALID_ENABLE.host,
				publicKey: VALID_ENABLE.publicKey,
				captureMode: 'content',
				updatedAt: body.config.updatedAt
			});
		} finally {
			await telemetryApp.close();
		}
	});

	it('replaces the config cache so a read after an accepted write returns the new config without a re-query', async () => {
		const { pool, query } = mockPool();
		const telemetryApp = buildApp(':memory:', { pgPool: pool });
		await telemetryApp.listen({ port: 0, host: '0.0.0.0' });
		try {
			await telemetryApp.inject({
				method: 'PUT',
				url: '/api/telemetry/config',
				payload: VALID_ENABLE
			});
			const writes = query.mock.calls.length;
			const config = await getTelemetryConfig(pool);
			expect(config.enabled).toBe(true);
			expect(config.host).toBe(VALID_ENABLE.host);
			expect(query.mock.calls.length).toBe(writes);
		} finally {
			await telemetryApp.close();
		}
	});

	it('rejects a host with a path (not a bare origin) with 400 {error: "invalid config"}', async () => {
		const res = await app.inject({
			method: 'PUT',
			url: '/api/telemetry/config',
			payload: { ...VALID_ENABLE, host: 'https://langfuse.example.com/api' }
		});
		expect(res.statusCode).toBe(400);
		const body = res.json();
		expect(body.error).toBe('invalid config');
		expect(typeof body.detail).toBe('string');
	});

	it('rejects a non-http(s) host with 400 invalid config', async () => {
		const res = await app.inject({
			method: 'PUT',
			url: '/api/telemetry/config',
			payload: { ...VALID_ENABLE, host: 'ftp://langfuse.example.com' }
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toBe('invalid config');
	});

	it('rejects a bad captureMode enum with 400 invalid config', async () => {
		const res = await app.inject({
			method: 'PUT',
			url: '/api/telemetry/config',
			payload: { ...VALID_ENABLE, captureMode: 'everything' }
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toBe('invalid config');
	});

	it('rejects enabling without a Langfuse-shaped publicKey with 400 invalid config', async () => {
		const res = await app.inject({
			method: 'PUT',
			url: '/api/telemetry/config',
			payload: { ...VALID_ENABLE, publicKey: 'sk-something-else' }
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toBe('invalid config');
	});

	it('rejects a body without enabled with 400 invalid config', async () => {
		const res = await app.inject({
			method: 'PUT',
			url: '/api/telemetry/config',
			payload: { host: VALID_ENABLE.host, publicKey: VALID_ENABLE.publicKey }
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toBe('invalid config');
	});

	it('accepts a disable without host/key shape requirements and persists enabled:false', async () => {
		const { pool, query } = mockPool();
		const telemetryApp = buildApp(':memory:', { pgPool: pool });
		await telemetryApp.listen({ port: 0, host: '0.0.0.0' });
		try {
			const res = await telemetryApp.inject({
				method: 'PUT',
				url: '/api/telemetry/config',
				payload: { enabled: false, host: '', publicKey: '', captureMode: 'content' }
			});
			expect(res.statusCode).toBe(200);
			expect(res.json().config.enabled).toBe(false);
			const insert = query.mock.calls.find((call) =>
				String(call[0]).includes('INSERT INTO settings')
			);
			expect(insert).toBeTruthy();
			expect(JSON.parse(insert![1][1]).enabled).toBe(false);
		} finally {
			await telemetryApp.close();
		}
	});

	it('invokes the pipeline reset hook synchronously on disable, never on enable', async () => {
		const { pool } = mockPool();
		const telemetryApp = buildApp(':memory:', { pgPool: pool });
		await telemetryApp.listen({ port: 0, host: '0.0.0.0' });
		const reset = vi.fn();
		setTelemetryReset(reset);
		try {
			const enable = await telemetryApp.inject({
				method: 'PUT',
				url: '/api/telemetry/config',
				payload: VALID_ENABLE
			});
			expect(enable.statusCode).toBe(200);
			expect(reset).not.toHaveBeenCalled();

			const disable = await telemetryApp.inject({
				method: 'PUT',
				url: '/api/telemetry/config',
				payload: { enabled: false, host: '', publicKey: '', captureMode: 'content' }
			});
			expect(disable.statusCode).toBe(200);
			expect(reset).toHaveBeenCalledTimes(1);
		} finally {
			setTelemetryReset(() => {});
			await telemetryApp.close();
		}
	});

	it('probes the destination server-side on enable and applies the config when the probe passes', async () => {
		const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const { pool, query } = mockPool();
		const telemetryApp = buildApp(':memory:', { pgPool: pool });
		await telemetryApp.listen({ port: 0, host: '0.0.0.0' });
		try {
			const res = await telemetryApp.inject({
				method: 'PUT',
				url: '/api/telemetry/config',
				payload: VALID_ENABLE
			});
			expect(res.statusCode).toBe(200);
			expect(res.json().config.enabled).toBe(true);

			expect(fetchMock).toHaveBeenCalledTimes(1);
			const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
			expect(String(url)).toBe('https://langfuse.example.com/api/public/projects');
			expect(init.method).toBe('GET');
			// Probe runs server-side: Basic auth is built from the env secret.
			expect(init.headers).toMatchObject({
				authorization: `Basic ${Buffer.from(`${VALID_ENABLE.publicKey}:${SUITE_SECRET}`).toString('base64')}`
			});

			const insert = query.mock.calls.find((call) =>
				String(call[0]).includes('INSERT INTO settings')
			);
			expect(insert).toBeTruthy();
			expect(JSON.parse(insert![1][1]).enabled).toBe(true);
		} finally {
			await telemetryApp.close();
		}
	});

	it('rejects an unreachable destination with 409 {error: "destination not reachable"} and retains the previous active config', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('fetch failed');
			})
		);
		const stored: TelemetryConfig = {
			enabled: true,
			host: 'https://lf.example.com',
			publicKey: 'pk-lf-x',
			captureMode: 'content',
			updatedAt: '2026-10-31T00:00:00.000Z'
		};
		const { pool, query } = mockPool([{ value: JSON.stringify(stored) }]);
		const telemetryApp = buildApp(':memory:', { pgPool: pool });
		await telemetryApp.listen({ port: 0, host: '0.0.0.0' });
		try {
			const res = await telemetryApp.inject({
				method: 'PUT',
				url: '/api/telemetry/config',
				payload: { ...VALID_ENABLE, host: 'https://unreachable.example.com' }
			});
			expect(res.statusCode).toBe(409);
			const body = res.json();
			expect(body.error).toBe('destination not reachable');
			expect(typeof body.detail).toBe('string');

			const writes = query.mock.calls.filter((call) =>
				String(call[0]).includes('INSERT INTO settings')
			);
			expect(writes).toHaveLength(0);
			// Previous active config retained: the cache still serves the stored row.
			expect(await getTelemetryConfig(pool)).toEqual(stored);
		} finally {
			await telemetryApp.close();
		}
	});

	it('rejects 401 and 403 probe outcomes with 409 {error: "credentials rejected"} and does not persist', async () => {
		const { pool, query } = mockPool();
		const telemetryApp = buildApp(':memory:', { pgPool: pool });
		await telemetryApp.listen({ port: 0, host: '0.0.0.0' });
		try {
			for (const status of [401, 403]) {
				vi.stubGlobal(
					'fetch',
					vi.fn(async () => new Response('no', { status }))
				);
				const res = await telemetryApp.inject({
					method: 'PUT',
					url: '/api/telemetry/config',
					payload: VALID_ENABLE
				});
				expect(res.statusCode).toBe(409);
				expect(res.json().error).toBe('credentials rejected');
				expect(typeof res.json().detail).toBe('string');
			}
			const writes = query.mock.calls.filter((call) =>
				String(call[0]).includes('INSERT INTO settings')
			);
			expect(writes).toHaveLength(0);
		} finally {
			await telemetryApp.close();
		}
	});

	it('rejects enabling without the env secret with 409 {error: "server secret missing"} before any network call', async () => {
		delete process.env.MAYON_LANGFUSE_SECRET_KEY;
		const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const { pool, query } = mockPool();
		const telemetryApp = buildApp(':memory:', { pgPool: pool });
		await telemetryApp.listen({ port: 0, host: '0.0.0.0' });
		try {
			const res = await telemetryApp.inject({
				method: 'PUT',
				url: '/api/telemetry/config',
				payload: VALID_ENABLE
			});
			expect(res.statusCode).toBe(409);
			expect(res.json()).toEqual({
				error: 'server secret missing',
				detail: 'MAYON_LANGFUSE_SECRET_KEY is not set'
			});
			expect(fetchMock).not.toHaveBeenCalled();

			const writes = query.mock.calls.filter((call) =>
				String(call[0]).includes('INSERT INTO settings')
			);
			expect(writes).toHaveLength(0);
		} finally {
			await telemetryApp.close();
		}
	});

	it('accepts a mode-only change while enabled without probing', async () => {
		const stored: TelemetryConfig = {
			enabled: true,
			host: 'https://lf.example.com',
			publicKey: 'pk-lf-x',
			captureMode: 'content',
			updatedAt: '2026-10-31T00:00:00.000Z'
		};
		const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const { pool, query } = mockPool([{ value: JSON.stringify(stored) }]);
		const telemetryApp = buildApp(':memory:', { pgPool: pool });
		await telemetryApp.listen({ port: 0, host: '0.0.0.0' });
		try {
			const res = await telemetryApp.inject({
				method: 'PUT',
				url: '/api/telemetry/config',
				payload: {
					enabled: true,
					host: stored.host,
					publicKey: stored.publicKey,
					captureMode: 'metadata'
				}
			});
			expect(res.statusCode).toBe(200);
			expect(fetchMock).not.toHaveBeenCalled();

			const insert = query.mock.calls.find((call) =>
				String(call[0]).includes('INSERT INTO settings')
			);
			expect(insert).toBeTruthy();
			expect(JSON.parse(insert![1][1]).captureMode).toBe('metadata');
		} finally {
			await telemetryApp.close();
		}
	});
});

describe('getTelemetryConfig (GET-equivalent default)', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns the disabled default when the settings row is absent', async () => {
		const { pool } = mockPool([]);
		const config = await getTelemetryConfig(pool);
		expect(config).toEqual(DEFAULT_TELEMETRY_CONFIG);
		expect(config.enabled).toBe(false);
	});

	it('returns the disabled default without a pool', async () => {
		expect(await getTelemetryConfig(undefined)).toEqual(DEFAULT_TELEMETRY_CONFIG);
	});

	it('returns a stored row verbatim', async () => {
		const stored = {
			enabled: true,
			host: 'https://lf.example.com',
			publicKey: 'pk-lf-x',
			captureMode: 'metadata',
			updatedAt: '2026-10-31T00:00:00.000Z'
		};
		const { pool } = mockPool([{ value: JSON.stringify(stored) }]);
		const config = await getTelemetryConfig(pool);
		expect(config).toEqual(stored);
	});
});

describe('POST /api/telemetry/events', () => {
	function eventRecord(overrides?: Partial<TelemetryEventRecord>): TelemetryEventRecord {
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

	function enabledPool(): { pool: PgPoolLike } {
		const stored: TelemetryConfig = {
			enabled: true,
			host: 'https://lf.example.com',
			publicKey: 'pk-lf-x',
			captureMode: 'content',
			updatedAt: '2026-10-31T00:00:00.000Z'
		};
		return mockPool([{ value: JSON.stringify(stored) }]);
	}

	function metadataPool(): { pool: PgPoolLike } {
		const stored: TelemetryConfig = {
			enabled: true,
			host: 'https://lf.example.com',
			publicKey: 'pk-lf-x',
			captureMode: 'metadata',
			updatedAt: '2026-10-31T00:00:00.000Z'
		};
		return mockPool([{ value: JSON.stringify(stored) }]);
	}

	afterEach(() => {
		resetTelemetryQueue();
		vi.unstubAllGlobals();
	});

	it('rejects 400 {error: "content in metadata mode"} for a batch carrying input and enqueues nothing', async () => {
		const { pool } = metadataPool();
		const telemetryApp = buildApp(':memory:', { pgPool: pool });
		await telemetryApp.listen({ port: 0, host: '0.0.0.0' });
		try {
			const res = await telemetryApp.inject({
				method: 'POST',
				url: '/api/telemetry/events',
				payload: {
					records: [eventRecord({ id: 'clean-1' }), eventRecord({ input: { system: 'secret' } })]
				}
			});
			expect(res.statusCode).toBe(400);
			expect(res.json()).toEqual({ error: 'content in metadata mode' });
			// Batch rejection: the clean record is not partially enqueued.
			expect(getTelemetryPipelineStatus().queueDepth).toBe(0);
		} finally {
			await telemetryApp.close();
		}
	});

	it('rejects a record carrying output in metadata mode', async () => {
		const { pool } = metadataPool();
		const telemetryApp = buildApp(':memory:', { pgPool: pool });
		await telemetryApp.listen({ port: 0, host: '0.0.0.0' });
		try {
			const res = await telemetryApp.inject({
				method: 'POST',
				url: '/api/telemetry/events',
				payload: { records: [eventRecord({ output: 'secret reply' })] }
			});
			expect(res.statusCode).toBe(400);
			expect(res.json()).toEqual({ error: 'content in metadata mode' });
			expect(getTelemetryPipelineStatus().queueDepth).toBe(0);
		} finally {
			await telemetryApp.close();
		}
	});

	it('accepts content-free records in metadata mode', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 202 }))
		);
		const { pool } = metadataPool();
		const telemetryApp = buildApp(':memory:', { pgPool: pool });
		await telemetryApp.listen({ port: 0, host: '0.0.0.0' });
		try {
			const before = getTelemetryPipelineStatus().queueDepth;
			const res = await telemetryApp.inject({
				method: 'POST',
				url: '/api/telemetry/events',
				payload: { records: [eventRecord({ id: 'meta-1' })] }
			});
			expect(res.statusCode).toBe(202);
			expect(res.json()).toEqual({ ok: true });
			expect(getTelemetryPipelineStatus().queueDepth).toBe(before + 1);
		} finally {
			resetTelemetryQueue();
			await telemetryApp.close();
		}
	});

	it('rejects 409 {error: "telemetry disabled"} when unconfigured', async () => {
		const telemetryApp = buildApp(':memory:');
		await telemetryApp.listen({ port: 0, host: '0.0.0.0' });
		try {
			const res = await telemetryApp.inject({
				method: 'POST',
				url: '/api/telemetry/events',
				payload: { records: [eventRecord()] }
			});
			expect(res.statusCode).toBe(409);
			expect(res.json()).toEqual({ error: 'telemetry disabled' });
			expect(getTelemetryPipelineStatus().queueDepth).toBe(0);
		} finally {
			await telemetryApp.close();
		}
	});

	it('rejects 409 when the stored config is disabled', async () => {
		const { pool } = mockPool([{ value: JSON.stringify({ ...DEFAULT_TELEMETRY_CONFIG }) }]);
		const telemetryApp = buildApp(':memory:', { pgPool: pool });
		await telemetryApp.listen({ port: 0, host: '0.0.0.0' });
		try {
			const res = await telemetryApp.inject({
				method: 'POST',
				url: '/api/telemetry/events',
				payload: { records: [eventRecord()] }
			});
			expect(res.statusCode).toBe(409);
			expect(res.json()).toEqual({ error: 'telemetry disabled' });
		} finally {
			await telemetryApp.close();
		}
	});

	it('accepts 202 {ok: true} and enqueues the records when enabled', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 202 }))
		);
		const { pool } = enabledPool();
		const telemetryApp = buildApp(':memory:', { pgPool: pool });
		await telemetryApp.listen({ port: 0, host: '0.0.0.0' });
		try {
			const before = getTelemetryPipelineStatus().queueDepth;
			const res = await telemetryApp.inject({
				method: 'POST',
				url: '/api/telemetry/events',
				payload: { records: [eventRecord(), eventRecord({ id: 'r-2' })] }
			});
			expect(res.statusCode).toBe(202);
			expect(res.json()).toEqual({ ok: true });
			expect(getTelemetryPipelineStatus().queueDepth).toBe(before + 2);
		} finally {
			resetTelemetryQueue();
			await telemetryApp.close();
		}
	});

	it('rejects 400 invalid records on a per-record shape violation', async () => {
		const { pool } = enabledPool();
		const telemetryApp = buildApp(':memory:', { pgPool: pool });
		await telemetryApp.listen({ port: 0, host: '0.0.0.0' });
		try {
			const res = await telemetryApp.inject({
				method: 'POST',
				url: '/api/telemetry/events',
				payload: { records: [{ id: 'r-1' }] }
			});
			expect(res.statusCode).toBe(400);
			expect(res.json().error).toBe('invalid records');
			expect(getTelemetryPipelineStatus().queueDepth).toBe(0);
		} finally {
			await telemetryApp.close();
		}
	});

	it('rejects 400 when the batch exceeds 50 records', async () => {
		const { pool } = enabledPool();
		const telemetryApp = buildApp(':memory:', { pgPool: pool });
		await telemetryApp.listen({ port: 0, host: '0.0.0.0' });
		try {
			const res = await telemetryApp.inject({
				method: 'POST',
				url: '/api/telemetry/events',
				payload: { records: Array.from({ length: 51 }, () => eventRecord()) }
			});
			expect(res.statusCode).toBe(400);
			expect(res.json().error).toBe('invalid records');
		} finally {
			await telemetryApp.close();
		}
	});

	it('rejects 400 when the body exceeds the 2MiB limit', async () => {
		const { pool } = enabledPool();
		const telemetryApp = buildApp(':memory:', { pgPool: pool });
		await telemetryApp.listen({ port: 0, host: '0.0.0.0' });
		try {
			const res = await telemetryApp.inject({
				method: 'POST',
				url: '/api/telemetry/events',
				payload: {
					records: [eventRecord({ input: { blob: 'x'.repeat(2 * 1024 * 1024 + 64) } })]
				}
			});
			expect(res.statusCode).toBe(400);
			expect(res.json().error).toBe('request body too large');
		} finally {
			await telemetryApp.close();
		}
	});
});

describe('GET /api/telemetry/status', () => {
	const STATUS_SECRET = 'sk-lf-status-suite-secret';

	function statusPool(): { pool: PgPoolLike } {
		const stored: TelemetryConfig = {
			enabled: true,
			host: 'https://lf.example.com',
			publicKey: 'pk-lf-x',
			captureMode: 'content',
			updatedAt: '2026-10-31T00:00:00.000Z'
		};
		return mockPool([{ value: JSON.stringify(stored) }]);
	}

	beforeEach(() => {
		resetTelemetryQueue();
		process.env.MAYON_LANGFUSE_SECRET_KEY = STATUS_SECRET;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 202 }))
		);
	});

	afterEach(() => {
		resetTelemetryQueue();
		delete process.env.MAYON_LANGFUSE_SECRET_KEY;
		vi.unstubAllGlobals();
	});

	async function getStatus(telemetryApp: Fastify.Instance): Promise<{
		statusCode: number;
		body: Record<string, unknown>;
	}> {
		const res = await telemetryApp.inject({ method: 'GET', url: '/api/telemetry/status' });
		return { statusCode: res.statusCode, body: res.json() };
	}

	it('projects healthy pipeline state truthfully and never contains secret material', async () => {
		const { pool } = statusPool();
		const telemetryApp = buildApp(':memory:', { pgPool: pool });
		await telemetryApp.listen({ port: 0, host: '0.0.0.0' });
		try {
			// Simulate a delivered batch: 20 records flush immediately.
			for (let i = 0; i < 20; i++) {
				enqueueTelemetry({
					id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
					kind: 'chat-turn',
					chatId: 'chat-1',
					model: 'mock-sink',
					provider: 'openai-compatible',
					startedAt: '2026-10-31T00:00:00.000Z',
					durationMs: 42,
					outcome: 'success'
				});
			}
			await vi.waitFor(() => {
				expect(getTelemetryPipelineStatus().queueDepth).toBe(0);
				expect(getTelemetryPipelineStatus().lastDeliveredAt).not.toBeNull();
			});

			const { statusCode, body } = await getStatus(telemetryApp);
			expect(statusCode).toBe(200);
			expect(body.configured).toBe(true);
			expect(body.enabled).toBe(true);
			expect(body.captureMode).toBe('content');
			expect(body.secretPresent).toBe(true);
			expect(body.queueDepth).toBe(0);
			expect(typeof body.lastDeliveredAt).toBe('string');
			expect(Number.isNaN(Date.parse(body.lastDeliveredAt as string))).toBe(false);
			expect(body.lastError).toBeNull();
			expect(JSON.stringify(body)).not.toContain(STATUS_SECRET);
		} finally {
			await telemetryApp.close();
		}
	});

	it('projects failing delivery truthfully: lastError summary and non-shrinking queueDepth', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('fetch failed');
			})
		);
		const { pool } = statusPool();
		const telemetryApp = buildApp(':memory:', { pgPool: pool });
		await telemetryApp.listen({ port: 0, host: '0.0.0.0' });
		try {
			for (let i = 0; i < 20; i++) {
				enqueueTelemetry({
					id: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`,
					kind: 'chat-turn',
					chatId: 'chat-1',
					model: 'mock-sink',
					provider: 'openai-compatible',
					startedAt: '2026-10-31T00:00:00.000Z',
					durationMs: 42,
					outcome: 'success'
				});
			}
			await vi.waitFor(() => {
				expect(getTelemetryPipelineStatus().lastError).not.toBeNull();
			});

			const { statusCode, body } = await getStatus(telemetryApp);
			expect(statusCode).toBe(200);
			expect(body.enabled).toBe(true);
			expect(body.queueDepth).toBe(20);
			expect(body.lastError).toEqual({
				at: expect.any(String),
				summary: 'destination not reachable'
			});
			expect(JSON.stringify(body)).not.toContain(STATUS_SECRET);
		} finally {
			await telemetryApp.close();
		}
	});

	it('reports secretPresent false and the unconfigured default without a settings row', async () => {
		delete process.env.MAYON_LANGFUSE_SECRET_KEY;
		const { pool } = mockPool([]);
		const telemetryApp = buildApp(':memory:', { pgPool: pool });
		await telemetryApp.listen({ port: 0, host: '0.0.0.0' });
		try {
			const { statusCode, body } = await getStatus(telemetryApp);
			expect(statusCode).toBe(200);
			expect(body.configured).toBe(false);
			expect(body.enabled).toBe(false);
			expect(body.captureMode).toBe('content');
			expect(body.secretPresent).toBe(false);
			expect(body.queueDepth).toBe(0);
			expect(JSON.stringify(body)).not.toContain(STATUS_SECRET);
		} finally {
			await telemetryApp.close();
		}
	});
});
