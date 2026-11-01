import { randomUUID } from 'node:crypto';
import type { TelemetryConfig, TelemetryEventRecord } from '@mayon/shared';

const QUEUE_BOUND = 500;
const FLUSH_INTERVAL_MS = 5000;
const FLUSH_BATCH_RECORDS = 20;
const BACKOFF_BASE_MS = 1000;
const MAX_BACKOFF_MS = 60_000;
const PROBE_TIMEOUT_MS = 5000;

const DISABLED_DEFAULT: TelemetryConfig = {
	enabled: false,
	host: '',
	publicKey: '',
	captureMode: 'content',
	updatedAt: ''
};

export interface TelemetryIngestSource {
	getConfig: () => Promise<TelemetryConfig>;
	secret: () => string | undefined;
}

let source: TelemetryIngestSource = {
	getConfig: async () => DISABLED_DEFAULT,
	secret: () => process.env.MAYON_LANGFUSE_SECRET_KEY
};

export function configureTelemetryIngest(src: TelemetryIngestSource): void {
	source = src;
	hookShutdown();
}

const queue: TelemetryEventRecord[] = [];
let lastDeliveredAt: string | null = null;
let lastError: { at: string; summary: string } | null = null;
let backoffMs = 0;
let nextFlushAt = 0;
let flushing = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export function getTelemetryPipelineStatus(): {
	queueDepth: number;
	lastDeliveredAt: string | null;
	lastError: { at: string; summary: string } | null;
} {
	return { queueDepth: queue.length, lastDeliveredAt, lastError };
}

/** FR-003: synchronous queue drop on disable — nothing buffered may ever flush. */
export function resetTelemetryQueue(): void {
	queue.length = 0;
	backoffMs = 0;
	nextFlushAt = 0;
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
}

function armTimer(): void {
	if (timer) return;
	timer = setTimeout(
		() => {
			timer = null;
			void runFlush();
		},
		Math.max(0, nextFlushAt - Date.now())
	);
	timer.unref();
}

function reschedule(at: number): void {
	nextFlushAt = at;
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
	armTimer();
}

export function enqueueTelemetry(record: TelemetryEventRecord): void {
	queue.push(record);
	if (queue.length > QUEUE_BOUND) {
		queue.splice(0, queue.length - QUEUE_BOUND);
	}
	if (queue.length >= FLUSH_BATCH_RECORDS && backoffMs === 0 && nextFlushAt > Date.now()) {
		reschedule(Date.now());
		return;
	}
	if (!timer && nextFlushAt <= Date.now()) {
		reschedule(Date.now() + FLUSH_INTERVAL_MS);
		return;
	}
	armTimer();
}

async function runFlush(): Promise<void> {
	if (flushing) {
		reschedule(Date.now() + FLUSH_INTERVAL_MS);
		return;
	}
	if (queue.length === 0) {
		reschedule(Date.now() + FLUSH_INTERVAL_MS);
		return;
	}
	flushing = true;
	try {
		const config = await source.getConfig();
		const secret = source.secret();
		// FR-002 network half: the pipeline dials Langfuse only while enabled with a secret.
		if (config.enabled && secret && config.host) {
			const batch = queue.slice(0, FLUSH_BATCH_RECORDS);
			const result = await deliverBatch(config, secret, batch);
			if (result.ok) {
				queue.splice(0, batch.length);
				lastDeliveredAt = new Date().toISOString();
				lastError = null;
				backoffMs = 0;
				reschedule(Date.now() + FLUSH_INTERVAL_MS);
			} else {
				lastError = { at: new Date().toISOString(), summary: result.summary };
				backoffMs = backoffMs === 0 ? BACKOFF_BASE_MS : Math.min(backoffMs * 2, MAX_BACKOFF_MS);
				reschedule(Date.now() + backoffMs);
			}
		} else {
			reschedule(Date.now() + FLUSH_INTERVAL_MS);
		}
	} catch {
		lastError = { at: new Date().toISOString(), summary: 'delivery failed' };
		backoffMs = backoffMs === 0 ? BACKOFF_BASE_MS : Math.min(backoffMs * 2, MAX_BACKOFF_MS);
		reschedule(Date.now() + backoffMs);
	} finally {
		flushing = false;
	}
}

function basicAuth(publicKey: string, secret: string): string {
	return `Basic ${Buffer.from(`${publicKey}:${secret}`).toString('base64')}`;
}

export type LangfuseProbeResult = 'ok' | 'destination not reachable' | 'credentials rejected';

export async function probeLangfuse(
	host: string,
	publicKey: string,
	secret: string,
	timeoutMs = PROBE_TIMEOUT_MS
): Promise<LangfuseProbeResult> {
	try {
		const res = await fetch(new URL('/api/public/projects', host), {
			method: 'GET',
			headers: { authorization: basicAuth(publicKey, secret) },
			signal: AbortSignal.timeout(timeoutMs)
		});
		if (res.ok) return 'ok';
		if (res.status === 401 || res.status === 403) return 'credentials rejected';
		return 'destination not reachable';
	} catch {
		return 'destination not reachable';
	}
}

export function toLangfuseEvents(
	records: TelemetryEventRecord[],
	captureMode: string
): Array<Record<string, unknown>> {
	const events: Array<Record<string, unknown>> = [];
	for (const record of records) {
		events.push({
			id: randomUUID(),
			type: 'trace-create',
			timestamp: record.startedAt,
			body: {
				id: record.id,
				name: record.kind,
				sessionId: record.chatId,
				tags: [record.kind, record.provider, captureMode],
				metadata: { app: 'mayon', model: record.model, outcome: record.outcome }
			}
		});
		const startMs = Date.parse(record.startedAt);
		const usage = record.usage;
		events.push({
			id: randomUUID(),
			type: 'observation-create',
			timestamp: record.startedAt,
			body: {
				id: randomUUID(),
				traceId: record.id,
				type: 'generation',
				name: record.kind,
				startTime: record.startedAt,
				...(Number.isFinite(startMs)
					? { endTime: new Date(startMs + record.durationMs).toISOString() }
					: {}),
				model: record.model,
				...(record.input !== undefined ? { input: record.input } : {}),
				...(record.output !== undefined ? { output: record.output } : {}),
				...(usage
					? {
							usage: {
								...(usage.input !== undefined ? { input: usage.input } : {}),
								...(usage.output !== undefined ? { output: usage.output } : {}),
								...(usage.total !== undefined ? { total: usage.total } : {}),
								unit: 'TOKENS'
							}
						}
					: {}),
				level: record.outcome === 'error' ? 'ERROR' : 'DEFAULT',
				...(record.errorDetail !== undefined ? { statusMessage: record.errorDetail } : {})
			}
		});
	}
	return events;
}

export interface LangfuseDestination {
	host: string;
	publicKey: string;
	captureMode: string;
}

export type DeliveryResult = { ok: true } | { ok: false; summary: string };

export async function deliverBatch(
	destination: LangfuseDestination,
	secret: string,
	records: TelemetryEventRecord[]
): Promise<DeliveryResult> {
	try {
		const res = await fetch(new URL('/api/public/ingestion', destination.host), {
			method: 'POST',
			headers: {
				authorization: basicAuth(destination.publicKey, secret),
				'content-type': 'application/json'
			},
			body: JSON.stringify({ batch: toLangfuseEvents(records, destination.captureMode) })
		});
		if (res.ok) return { ok: true };
		if (res.status === 401 || res.status === 403) {
			return { ok: false, summary: 'credentials rejected' };
		}
		return { ok: false, summary: `ingestion failed (HTTP ${res.status})` };
	} catch {
		return { ok: false, summary: 'destination not reachable' };
	}
}

// Best-effort shutdown flush: an in-flight fetch keeps the event loop alive
// until the batch resolves, and beforeExit re-fires for any remainder.
// ponytail: no durability beyond this window; upgrade path is an explicit
// SIGTERM flush before fastify close.
let shutdownHooked = false;
function hookShutdown(): void {
	if (shutdownHooked) return;
	shutdownHooked = true;
	process.on('beforeExit', () => {
		if (queue.length > 0) void runFlush();
	});
}
