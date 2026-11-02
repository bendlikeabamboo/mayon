import { randomBytes } from 'node:crypto';
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

export interface OtlpAttributeValue {
	stringValue?: string;
	intValue?: string;
}

export interface OtlpAttribute {
	key: string;
	value: OtlpAttributeValue;
}

export interface OtlpSpan {
	traceId: string;
	spanId: string;
	name: string;
	kind: number;
	startTimeUnixNano?: string;
	endTimeUnixNano?: string;
	attributes: OtlpAttribute[];
}

function strAttribute(key: string, value: string): OtlpAttribute {
	return { key, value: { stringValue: value } };
}

function intAttribute(key: string, value: number): OtlpAttribute {
	// OTLP/JSON encodes int64 as a decimal string.
	return { key, value: { intValue: String(value) } };
}

function nanosOf(ms: number): string {
	return (BigInt(Math.trunc(ms)) * 1_000_000n).toString();
}

export function toOtlpSpans(records: TelemetryEventRecord[], captureMode: string): OtlpSpan[] {
	return records.map((record) => {
		const startMs = Date.parse(record.startedAt);
		const attributes: OtlpAttribute[] = [
			strAttribute('langfuse.observation.type', 'generation'),
			strAttribute('langfuse.session.id', record.chatId),
			strAttribute('gen_ai.request.model', record.model),
			strAttribute('mayon.provider', record.provider),
			strAttribute('mayon.outcome', record.outcome),
			strAttribute('mayon.capture_mode', captureMode)
		];
		const usage = record.usage;
		if (usage?.input !== undefined) {
			attributes.push(intAttribute('gen_ai.usage.input_tokens', usage.input));
		}
		if (usage?.output !== undefined) {
			attributes.push(intAttribute('gen_ai.usage.output_tokens', usage.output));
		}
		if (usage?.total !== undefined) {
			attributes.push(intAttribute('gen_ai.usage.total_tokens', usage.total));
		}
		if (record.errorDetail !== undefined) {
			attributes.push(strAttribute('error.type', record.errorDetail));
		}
		// Metadata-mode records never carry input/output (stripped at assembly,
		// rejected at the relay gate); content ships as span attributes.
		if (captureMode === 'content') {
			if (record.input !== undefined) {
				attributes.push(
					strAttribute(
						'gen_ai.prompt',
						typeof record.input === 'string' ? record.input : JSON.stringify(record.input)
					)
				);
			}
			if (record.output !== undefined) {
				attributes.push(strAttribute('gen_ai.completion', record.output));
			}
		}
		return {
			traceId: record.id.replace(/-/g, ''),
			spanId: randomBytes(8).toString('hex'),
			name: record.kind,
			kind: 1,
			...(Number.isFinite(startMs)
				? {
						startTimeUnixNano: nanosOf(startMs),
						endTimeUnixNano: nanosOf(startMs + record.durationMs)
					}
				: {}),
			attributes
		};
	});
}

function toOtlpTraceBody(
	records: TelemetryEventRecord[],
	captureMode: string
): { resourceSpans: Array<Record<string, unknown>> } {
	return {
		resourceSpans: [
			{
				resource: { attributes: [strAttribute('service.name', 'mayon')] },
				scopeSpans: [{ spans: toOtlpSpans(records, captureMode) }]
			}
		]
	};
}

function ingestionErrorMessage(body: string): string | undefined {
	let parsed: {
		errors?: Array<{ message?: unknown }>;
		partialSuccess?: { errorMessage?: unknown };
	};
	try {
		parsed = JSON.parse(body);
	} catch {
		return undefined;
	}
	const legacy = parsed.errors?.[0]?.message;
	if (typeof legacy === 'string' && legacy) return legacy;
	const partial = parsed.partialSuccess?.errorMessage;
	if (typeof partial === 'string' && partial) return partial;
	return undefined;
}

function truncateSummary(summary: string, max = 300): string {
	return summary.length > max ? `${summary.slice(0, max - 3)}...` : summary;
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
		const res = await fetch(new URL('/api/public/otel/v1/traces', destination.host), {
			method: 'POST',
			headers: {
				authorization: basicAuth(destination.publicKey, secret),
				'content-type': 'application/json',
				'x-langfuse-ingestion-version': '4'
			},
			body: JSON.stringify(toOtlpTraceBody(records, destination.captureMode))
		});
		const body = await res.text();
		if (res.status === 401 || res.status === 403) {
			return { ok: false, summary: 'credentials rejected' };
		}
		const message = ingestionErrorMessage(body);
		// Only a clean 2xx is delivered: 207 carries per-event rejections and a
		// populated partialSuccess.errorMessage means spans were dropped.
		if (res.status === 207) {
			return { ok: false, summary: truncateSummary(message ?? 'ingestion failed (HTTP 207)') };
		}
		if (res.ok) {
			return message ? { ok: false, summary: truncateSummary(message) } : { ok: true };
		}
		return {
			ok: false,
			summary: truncateSummary(message ?? `ingestion failed (HTTP ${res.status})`)
		};
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
