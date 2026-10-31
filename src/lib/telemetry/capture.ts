import type { TelemetryEventKind, TelemetryEventRecord, TelemetryUsage } from '@mayon/shared';
import { telemetryState } from './state.svelte';
import { relayTelemetry } from './relay';

/**
 * Single capture entry point (FR-002). The disabled check is synchronous and
 * first: a disabled deployment does zero work per record — no buffering, no
 * network.
 */
export function emitTelemetry(record: TelemetryEventRecord): void {
	if (!telemetryState.enabled) return;
	relayTelemetry(record);
}

const FIELD_CAP_CHARS = 128 * 1024;

/** Shared ~128KiB per-field cap (data-model) with a truncation marker flag. */
function makeCapper() {
	let truncated = false;
	return {
		cap(s: string): string {
			if (s.length <= FIELD_CAP_CHARS) return s;
			truncated = true;
			return s.slice(0, FIELD_CAP_CHARS);
		},
		get isTruncated() {
			return truncated;
		}
	};
}

/** Chat-turn capture fields, all already resolved at the trace seam (research D1). */
export interface ChatTurnCapture {
	chatId: string;
	model: string;
	provider: string;
	startedAt: string;
	durationMs: number;
	outcome: TelemetryEventRecord['outcome'];
	errorDetail?: string;
	/** Last agent-loop request: system + traced messages (the `request` trace event). */
	input?: { system?: string; messages?: Array<{ role?: string; content?: string }> };
	/** Persisted final text (`persisted` trace event) or live buffer partial on abort. */
	output?: string;
	usage?: TelemetryUsage;
}

export function buildChatTurnRecord(t: ChatTurnCapture): TelemetryEventRecord {
	// FR-009: mode is read per record, so a settings switch applies to the next
	// record without restart. Stripped fields are omitted, never empty.
	const metadata = telemetryState.captureMode === 'metadata';
	const capper = makeCapper();
	const cap = (s: string): string => capper.cap(s);
	const record: TelemetryEventRecord = {
		id: crypto.randomUUID(),
		kind: 'chat-turn',
		chatId: t.chatId,
		model: t.model,
		provider: t.provider,
		startedAt: t.startedAt,
		durationMs: t.durationMs,
		outcome: t.outcome
	};
	if (t.errorDetail !== undefined) record.errorDetail = t.errorDetail;
	if (t.usage !== undefined) record.usage = t.usage;
	if (!metadata && t.input !== undefined) {
		record.input = {
			...(t.input.system !== undefined ? { system: cap(t.input.system) } : {}),
			...(t.input.messages !== undefined
				? {
						messages: t.input.messages.map((m) =>
							m.content !== undefined ? { ...m, content: cap(m.content) } : m
						)
					}
				: {})
		};
	}
	if (!metadata && t.output !== undefined) record.output = cap(t.output);
	if (capper.isTruncated) record.truncated = true;
	return record;
}

/** Assemble and hand off a chat-turn record; never throws into the chat path. */
export function captureChatTurn(t: ChatTurnCapture): void {
	try {
		emitTelemetry(buildChatTurnRecord(t));
	} catch {
		/* telemetry must never throw into the chat path */
	}
}

/**
 * Side-generator capture (research D1/D7): every non-chat LLM interaction
 * (title, brief, quiz, grading, lab, branch summary, MCP sampling) emits the
 * same normalized record via one shared helper. Fields are whatever the tap
 * site already has in hand — usage only when the provider reported it.
 */
export type GeneratorKind = Exclude<TelemetryEventKind, 'chat-turn'>;

/** SDK usage triple — ai v7 names plus the legacy stream-part names. */
export interface GeneratorUsage {
	inputTokens?: number;
	outputTokens?: number;
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
}

export interface GeneratorCaptureInput {
	chatId: string;
	model: string;
	provider: string;
	/** `Date.now()` captured when the generation started. */
	startedAt: number;
	/** Provider-agnostic prompt: the traced request, or raw sampled messages. */
	input?: { system?: string; messages?: Array<{ role?: string; content: string }> };
	/** The traced success result (`{ object }` from onTrace); stringified unless already text. */
	result?: { object: unknown };
	/** Explicit output text — wins over `result` when both are present. */
	output?: string;
	/** Failure reason (also carried on abort as the status message). */
	error?: string;
	aborted?: boolean;
	usage?: GeneratorUsage | null;
}

/** No synthesized zero-usage (langfuse-ingestion contract): absent unless reported. */
function usageOf(u: GeneratorCaptureInput['usage']): TelemetryUsage | undefined {
	if (!u) return undefined;
	const usage: TelemetryUsage = {};
	const input = u.inputTokens ?? u.promptTokens;
	const output = u.outputTokens ?? u.completionTokens;
	if (input !== undefined) usage.input = input;
	if (output !== undefined) usage.output = output;
	if (u.totalTokens !== undefined) usage.total = u.totalTokens;
	return usage.input !== undefined || usage.output !== undefined || usage.total !== undefined
		? usage
		: undefined;
}

function outputOf(t: GeneratorCaptureInput): string | undefined {
	if (t.output !== undefined) return t.output;
	const object = t.result?.object;
	if (object === undefined) return undefined;
	return typeof object === 'string' ? object : JSON.stringify(object);
}

/** Assemble and hand off a side-generator record; never throws into generator paths. */
export function captureGenerator(kind: GeneratorKind, t: GeneratorCaptureInput): void {
	try {
		if (!telemetryState.enabled) return;
		// FR-009: mode read per record; metadata omits input/output entirely.
		const metadata = telemetryState.captureMode === 'metadata';
		const capper = makeCapper();
		const record: TelemetryEventRecord = {
			id: crypto.randomUUID(),
			kind,
			chatId: t.chatId,
			model: t.model,
			provider: t.provider,
			startedAt: new Date(t.startedAt).toISOString(),
			durationMs: Math.max(0, Date.now() - t.startedAt),
			outcome: t.aborted ? 'aborted' : t.error !== undefined ? 'error' : 'success'
		};
		if (t.error !== undefined) record.errorDetail = t.error;
		const usage = usageOf(t.usage);
		if (usage !== undefined) record.usage = usage;
		if (!metadata && t.input !== undefined) {
			record.input = {
				...(t.input.system !== undefined ? { system: capper.cap(t.input.system) } : {}),
				...(t.input.messages !== undefined
					? {
							messages: t.input.messages.map((m) => ({ ...m, content: capper.cap(m.content) }))
						}
					: {})
			};
		}
		const output = metadata ? undefined : outputOf(t);
		if (output !== undefined) record.output = capper.cap(output);
		if (capper.isTruncated) record.truncated = true;
		emitTelemetry(record);
	} catch {
		/* telemetry must never throw into generator paths */
	}
}
