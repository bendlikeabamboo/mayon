import type { FastifyInstance } from 'fastify';
import type {
	TelemetryConfig,
	TelemetryConfigInput,
	TelemetryEventRecord,
	TelemetryEventsRequest,
	TelemetryStatus
} from '@mayon/shared';
import type { PgPoolLike } from './pg';
import {
	configureTelemetryIngest,
	enqueueTelemetry,
	getTelemetryPipelineStatus,
	probeLangfuse,
	resetTelemetryQueue
} from './telemetry-ingest';

const TELEMETRY_CONFIG_KEY = 'telemetry';
const TELEMETRY_CONFIG_TTL_MS = 5000;

export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
	enabled: false,
	host: '',
	publicKey: '',
	captureMode: 'content',
	updatedAt: ''
};

interface TelemetryConfigCache {
	value: TelemetryConfig;
	readAt: number;
}
const telemetryConfigCaches = new WeakMap<PgPoolLike, TelemetryConfigCache>();

function isTelemetryConfigShape(value: unknown): value is TelemetryConfig {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const c = value as Record<string, unknown>;
	return (
		typeof c.enabled === 'boolean' &&
		typeof c.host === 'string' &&
		typeof c.publicKey === 'string' &&
		(c.captureMode === 'content' || c.captureMode === 'metadata') &&
		typeof c.updatedAt === 'string'
	);
}

export async function getTelemetryConfig(
	pool: PgPoolLike | undefined,
	now: () => number = Date.now
): Promise<TelemetryConfig> {
	if (!pool) {
		return DEFAULT_TELEMETRY_CONFIG;
	}
	const cached = telemetryConfigCaches.get(pool);
	if (cached && now() - cached.readAt < TELEMETRY_CONFIG_TTL_MS) {
		return cached.value;
	}
	try {
		const res = await pool.query('SELECT value FROM settings WHERE key = $1', [
			TELEMETRY_CONFIG_KEY
		]);
		let value = DEFAULT_TELEMETRY_CONFIG;
		const raw = res.rows[0]?.value;
		if (typeof raw === 'string') {
			const parsed: unknown = JSON.parse(raw);
			if (isTelemetryConfigShape(parsed)) {
				value = parsed;
			}
		}
		telemetryConfigCaches.set(pool, { value, readAt: now() });
		return value;
	} catch {
		return DEFAULT_TELEMETRY_CONFIG;
	}
}

/**
 * Queue-drop hook invoked synchronously when a config write disables telemetry
 * (FR-003). registerTelemetry defaults it to the real ingest-pipeline reset;
 * tests may override.
 */
let resetPipeline: () => void = () => {};

export function setTelemetryReset(fn: () => void): void {
	resetPipeline = fn;
}

function invalid(detail: string): { error: 'invalid config'; detail: string } {
	return { error: 'invalid config', detail };
}

// Bare http(s) origin: scheme + host, no path/query/fragment.
const HOST_PATTERN = /^https?:\/\/[^/?#]+$/;
const PUBLIC_KEY_PATTERN = /^pk-lf-/;

const configBodySchema = {
	type: 'object',
	required: ['enabled'],
	additionalProperties: false,
	properties: {
		enabled: { type: 'boolean' },
		host: { type: 'string' },
		publicKey: { type: 'string' },
		captureMode: { type: 'string', enum: ['content', 'metadata'], default: 'content' }
	}
} as const;

export interface TelemetryOptions {
	pool?: PgPoolLike;
}

const TELEMETRY_EVENT_KINDS = [
	'chat-turn',
	'title',
	'brief',
	'quiz',
	'grading',
	'lab',
	'branch-summary',
	'mcp-sampling'
] as const;

const telemetryRecordSchema = {
	type: 'object',
	required: ['id', 'kind', 'chatId', 'model', 'provider', 'startedAt', 'durationMs', 'outcome'],
	additionalProperties: false,
	properties: {
		id: { type: 'string' },
		kind: { type: 'string', enum: TELEMETRY_EVENT_KINDS },
		chatId: { type: 'string' },
		model: { type: 'string' },
		provider: { type: 'string' },
		startedAt: { type: 'string' },
		durationMs: { type: 'number' },
		outcome: { type: 'string', enum: ['success', 'error', 'aborted'] },
		errorDetail: { type: 'string' },
		input: {},
		output: { type: 'string' },
		usage: {
			type: 'object',
			additionalProperties: false,
			properties: {
				input: { type: 'number' },
				output: { type: 'number' },
				total: { type: 'number' }
			}
		},
		truncated: { type: 'boolean' }
	}
} as const;

const MAX_EVENTS_BATCH = 50;
const MAX_EVENTS_BODY_BYTES = 2 * 1024 * 1024;

const eventsBodySchema = {
	type: 'object',
	required: ['records'],
	additionalProperties: false,
	properties: {
		records: { type: 'array', maxItems: MAX_EVENTS_BATCH, items: telemetryRecordSchema }
	}
} as const;

export function registerTelemetry(app: FastifyInstance, opts: TelemetryOptions): void {
	// One ingest pipeline per server process; the env secret never leaves this module.
	configureTelemetryIngest({
		getConfig: () => getTelemetryConfig(opts.pool),
		secret: () => process.env.MAYON_LANGFUSE_SECRET_KEY
	});
	// FR-003: disable drops the pipeline queue synchronously (overridable in tests).
	setTelemetryReset(resetTelemetryQueue);

	app.register(async function telemetryRoutes(t) {
		// Map Fastify schema-validation failures onto the contract's error bodies.
		t.setErrorHandler((err, req, reply) => {
			if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
				void reply.code(400).send({ error: 'request body too large' });
				return;
			}
			if (err.validation) {
				const label = req.routeOptions.url.endsWith('/api/telemetry/events')
					? 'invalid records'
					: 'invalid config';
				void reply.code(400).send({ error: label, detail: err.message });
				return;
			}
			throw err;
		});

		t.put<{ Body: TelemetryConfigInput }>(
			'/api/telemetry/config',
			{ schema: { body: configBodySchema } },
			async (req, reply) => {
				const body = req.body;
				if (body.enabled) {
					if (!HOST_PATTERN.test(body.host)) {
						return reply
							.code(400)
							.send(invalid('host must be an http(s) origin without path, query, or fragment'));
					}
					if (!PUBLIC_KEY_PATTERN.test(body.publicKey)) {
						return reply
							.code(400)
							.send(invalid('publicKey must be a Langfuse public key (pk-lf-…)'));
					}
				}

				const pool = opts.pool;
				const current = await getTelemetryConfig(pool);
				// FR-004: enabling, or changing host/publicKey while enabled, requires the
				// authenticated probe (server-side so the env secret never transits the
				// browser; bounded 5s inside probeLangfuse) before anything is persisted.
				// Mode-only changes skip it. On failure the previous config is kept.
				if (
					body.enabled &&
					(!current.enabled || body.host !== current.host || body.publicKey !== current.publicKey)
				) {
					const secret = process.env.MAYON_LANGFUSE_SECRET_KEY;
					if (!secret) {
						return reply.code(409).send({
							error: 'server secret missing',
							detail: 'MAYON_LANGFUSE_SECRET_KEY is not set'
						});
					}
					const probe = await probeLangfuse(body.host, body.publicKey, secret);
					if (probe !== 'ok') {
						const detail =
							probe === 'credentials rejected'
								? 'the destination rejected the public key / secret key pair (401/403)'
								: `no response from ${body.host} within 5s`;
						return reply.code(409).send({ error: probe, detail });
					}
				}

				const config: TelemetryConfig = {
					enabled: body.enabled,
					host: body.host ?? '',
					publicKey: body.publicKey ?? '',
					captureMode: body.captureMode ?? 'content',
					updatedAt: new Date().toISOString()
				};

				if (pool) {
					await pool.query(
						`INSERT INTO settings(key,value) VALUES($1,$2)
						 ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
						[TELEMETRY_CONFIG_KEY, JSON.stringify(config)]
					);
					telemetryConfigCaches.set(pool, { value: config, readAt: Date.now() });
				}

				if (!config.enabled) {
					resetPipeline();
				}
				return reply.send({ ok: true, config });
			}
		);

		t.post<{ Body: TelemetryEventsRequest }>(
			'/api/telemetry/events',
			{ bodyLimit: MAX_EVENTS_BODY_BYTES, schema: { body: eventsBodySchema } },
			async (req, reply) => {
				const config = await getTelemetryConfig(opts.pool);
				if (!config.enabled) {
					return reply.code(409).send({ error: 'telemetry disabled' });
				}
				// FR-009 defense in depth: reject the whole batch, never partially
				// enqueue, when any record carries content in metadata mode.
				if (
					config.captureMode === 'metadata' &&
					(req.body.records as TelemetryEventRecord[]).some(
						(r) => r.input !== undefined || r.output !== undefined
					)
				) {
					return reply.code(400).send({ error: 'content in metadata mode' });
				}
				for (const record of req.body.records as TelemetryEventRecord[]) {
					enqueueTelemetry(record);
				}
				return reply.code(202).send({ ok: true });
			}
		);

		// FR-010: delivery-health projection. Cheap and side-effect-free; the UI
		// polls it only while the telemetry settings section is mounted. Config
		// holds no secret material and the payload never adds any.
		t.get('/api/telemetry/status', async (_req, reply) => {
			const config = await getTelemetryConfig(opts.pool);
			const pipeline = getTelemetryPipelineStatus();
			const status: TelemetryStatus = {
				configured: config.host !== '' || config.publicKey !== '',
				enabled: config.enabled,
				captureMode: config.captureMode,
				secretPresent: Boolean(process.env.MAYON_LANGFUSE_SECRET_KEY),
				queueDepth: pipeline.queueDepth,
				lastDeliveredAt: pipeline.lastDeliveredAt,
				lastError: pipeline.lastError
			};
			return reply.send(status);
		});
	});
}
