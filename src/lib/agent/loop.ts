import { streamText, tool, jsonSchema, APICallError } from 'ai';
import type { LanguageModel, ToolSet } from 'ai';
import { getToolDefinitions, getToolDefinition, toolsRun } from '#lib/agent/registry.js';
import { resolveToolCapability, disableToolsForSession } from '#lib/agent/capability.js';
import { validateTurn, type CriticIssue } from '#lib/agent/critic.js';
import { projectEntries } from '#lib/chat/projection.js';
import {
	buildCapabilitiesPreamble,
	buildFirstTurnOrientationPreamble,
	buildReplyTiersPreamble
} from '#lib/chat/brief.js';
import type { ChatMessage, ReasoningEffort, ProviderConfig } from '#lib/ai/types.js';
import {
	resolveRequestSettings,
	wireImageToCandidate,
	type ImageCandidate
} from '#lib/ai/dialects.js';
import { supportsVision } from '#lib/ai/vision-capability.js';
import type { Message } from '#lib/db/index.js';
import type { TraceEvent, TracedRequestMessage } from './trace';

const MAX_ITERATIONS = 6;
const MAX_CORRECTIONS = 2;

/**
 * A stream-recognized image candidate stamped with its arrival offset
 * (feature 033, research D5): `offset` is the current streaming-text length
 * at the moment of recognition, letting finalize place the image relative to
 * the turn's text. Optional — critic-round candidates carry none.
 */
export type StreamImageCandidate = ImageCandidate & { offset?: number };

export interface AgentTurnDeps {
	model: LanguageModel;
	config: ProviderConfig;
	chatId: string;
	rootChatId: string;
	signal: AbortSignal;
	effort: ReasoningEffort;
	updateStreamBuffer: (next: string) => void;
	updateReasoningBuffer: (next: string) => void;
	onReasoningSegmentStart?: () => void;
	onTextSegmentStart?: (startOffset: number) => void;
	/**
	 * Iteration boundary (035, contracts/iteration-boundary.md): fired only
	 * AFTER an iteration's blocks are persisted — or at critic re-emit start —
	 * so durable rows replace the live view with no gap. NEVER fired before a
	 * persist (that would blank paced live text during the deferred drain).
	 */
	onIterationBoundary?: () => void;
	appendReasoning?: (text: string, iteration: number) => Promise<void>;
	appendSelfCorrected?: (
		report: { issues: { type: string; message: string }[]; attempts: number; succeeded: boolean },
		finalTextLength: number
	) => Promise<void>;
	appendAssistantText: (
		content: string,
		opts?: {
			model?: string;
			reasoning?: string;
			images?: StreamImageCandidate[];
			final?: boolean;
		}
	) => Promise<Message>;
	onImageRecognized?: (candidate: StreamImageCandidate) => void;
	appendAssistantToolCall: (p: {
		toolCallId: string;
		toolName: string;
		args: unknown;
		text?: string;
	}) => Promise<Message>;
	appendToolResult: (r: {
		toolCallId: string;
		toolName: string;
		summary: string;
		detail?: unknown;
		ok?: boolean;
	}) => Promise<Message>;
	reassembleContext: () => Promise<ChatMessage[]>;
	requestApproval: (req: {
		toolCallId: string;
		toolName: string;
		description: string;
		args: unknown;
	}) => Promise<{ approved: boolean; aborted?: boolean }>;
	notifyLowRisk: (toolLabel: string, summary: string) => void;
	notifyGenerativeStatus?: (status: { toolName: string; label: string } | null) => void;
	disabledToolIds?: string[];
	firstTurn?: boolean;
	onTrace?: (e: TraceEvent) => void;
}

interface CollectedToolCall {
	toolCallId: string;
	toolName: string;
	args: unknown;
}

/**
 * Shadow of the store's `liveBlocks` (029 T012): one entry per arrival-order
 * block of the current iteration. Reasoning blocks carry their captured text;
 * text blocks are offsets into the concatenated buffer, sliced at walk time.
 */
type PersistBlock = { kind: 'reasoning'; text: string } | { kind: 'text'; start: number };

function candidateFromFile(file: Record<string, unknown>): ImageCandidate | null {
	const { mediaType, base64 } = file;
	if (typeof base64 !== 'string' || base64 === '') return null;
	// SDK caveat: url-typed file data lands unconverted in the base64 slot.
	if (/^https?:\/\//.test(base64)) {
		return typeof mediaType === 'string' ? { mediaType, url: base64 } : { url: base64 };
	}
	return {
		mediaType: typeof mediaType === 'string' ? mediaType : undefined,
		base64
	};
}

/** Recognize image parts (`file`, openai-compatible `raw`) into candidates. */
function collectStreamImages(p: Record<string, unknown>, into: ImageCandidate[]): void {
	if (p.type === 'file') {
		const file = p.file;
		if (typeof file === 'object' && file !== null) {
			const c = candidateFromFile(file as Record<string, unknown>);
			if (c) into.push(c);
		}
		return;
	}
	if (p.type === 'raw') {
		const raw = p.rawValue as { choices?: { delta?: { images?: unknown } }[] } | undefined;
		const wireImages = raw?.choices?.[0]?.delta?.images;
		if (Array.isArray(wireImages)) {
			for (const w of wireImages) {
				const c = wireImageToCandidate(w);
				if (c) into.push(c);
			}
		}
	}
}

function buildSdkTools(enabled: boolean, disabledToolIds?: string[]): ToolSet {
	if (!enabled) return {};
	const disabled = new Set(disabledToolIds ?? []);
	const defs = getToolDefinitions().filter((d) => !disabled.has(d.id));
	const MAX_TOOL_DEFS = 64;
	const dropped = defs.slice(MAX_TOOL_DEFS);
	if (dropped.length > 0) {
		for (const d of dropped) {
			console.warn(`[mcp] tool cap: dropped ${d.id} (exceeds ${MAX_TOOL_DEFS} tool definitions)`);
		}
	}
	const capped = defs.slice(0, MAX_TOOL_DEFS);
	const out: ToolSet = {};
	for (const def of capped) {
		out[def.id] = tool({
			description: def.description,
			inputSchema: jsonSchema(def.parameters)
		});
	}
	return out;
}

function extractPartContent(p: Record<string, unknown>): string {
	if (p.type === 'text') return String(p.text ?? '');
	if (p.type === 'image') {
		// Short placeholder only — never the image payload (no base64 in traces).
		// AI SDK user image parts are { type:'image', image } (no dimensions);
		// stored MessagePart shapes carry width/height, so use them when present.
		const w = p.width;
		const h = p.height;
		return typeof w === 'number' && typeof h === 'number' ? `[image ${w}x${h}]` : '[image]';
	}
	if (p.type === 'tool-call') return JSON.stringify(p.input ?? {});
	if (p.type === 'tool-result') {
		const out = p.output as Record<string, unknown> | undefined;
		if (!out) return '';
		if (out.type === 'text') return String(out.value ?? '');
		if (out.type === 'json') return JSON.stringify(out.value ?? {});
		return String(out.value ?? '');
	}
	return '';
}

function partKind(p: Record<string, unknown>): string | undefined {
	if (p.type === 'tool-call') return 'tool_call';
	if (p.type === 'tool-result') return 'tool_result';
	return undefined;
}

function resolveTurnSettings(deps: AgentTurnDeps) {
	return resolveRequestSettings(deps.config, deps.config.defaultModel, deps.effort);
}

function toTracedRequestMessage(msg: { role: string; content: unknown }): TracedRequestMessage {
	if (typeof msg.content === 'string') {
		return { role: msg.role, content: msg.content, kind: `${msg.role}_message` };
	}

	const parts = Array.isArray(msg.content) ? msg.content : [];
	const texts = parts.map((p) => extractPartContent(p as Record<string, unknown>));
	const content = texts.join('\n');

	const result: TracedRequestMessage = { role: msg.role, content };

	for (const p of parts) {
		const pp = p as Record<string, unknown>;
		const k = partKind(pp);
		if (k) {
			result.toolCallId = String(pp.toolCallId ?? '');
			result.toolName = String(pp.toolName ?? '');
			result.kind = k;
			break;
		}
	}

	if (!result.kind) {
		result.kind = `${msg.role}_message`;
	}

	return result;
}

async function consumeStream(
	fullStream: AsyncIterable<unknown>,
	signal: AbortSignal,
	onTextDelta: (text: string) => void,
	onToolCall: (tc: CollectedToolCall) => void,
	onReasoningDelta: (text: string) => void,
	onReasoningSegmentStart: () => void,
	onTextSegmentStart: (startOffset: number) => void,
	textLength: () => number,
	imageSink: StreamImageCandidate[],
	onImageRecognized: ((candidate: StreamImageCandidate) => void) | undefined,
	onTrace?: (e: TraceEvent) => void
): Promise<{
	finishReason: string;
	usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null;
	images: StreamImageCandidate[];
}> {
	let finishReason = '';
	let usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null =
		null;
	// Caller-owned recognition accumulator (033, research D3): recognized
	// candidates land here at arrival, so an abort cannot discard them; the
	// returned `images` array is this sink at normal completion.
	// Segment state machine (029): reasoning segments are positional (provider
	// ids are reused/reopened), whitespace-only segments defer their open until
	// real content arrives, and text splits are recorded at the current buffer
	// length whenever a new text stretch begins.
	let segText = '';
	let segStarted = false;
	let textOpen = false;
	const closeReasoningSegment = () => {
		segText = '';
		segStarted = false;
	};
	for await (const part of fullStream) {
		if (signal.aborted) break;
		const p = part as Record<string, unknown>;
		// Traces never carry image payloads: file parts lose base64/uint8Array,
		// raw chunks lose rawValue entirely (it duplicates the wire SSE).
		const tracePayload =
			p.type === 'file' || p.type === 'reasoning-file'
				? {
						type: p.type,
						file: {
							mediaType: (p.file as Record<string, unknown> | undefined)?.mediaType
						}
					}
				: p.type === 'raw'
					? { type: p.type }
					: p;
		onTrace?.({ kind: 'part', type: p.type as string, payload: tracePayload });
		if (p.type === 'reasoning-start') {
			closeReasoningSegment();
			textOpen = false;
		} else if (p.type === 'reasoning-delta' && typeof p.text === 'string') {
			segText += p.text;
			if (!segStarted && segText.trim()) {
				segStarted = true;
				onReasoningSegmentStart();
			}
			if (segStarted) onReasoningDelta(p.text);
		} else if (p.type === 'reasoning-end') {
			closeReasoningSegment();
		} else if (p.type === 'text-start') {
			closeReasoningSegment();
			textOpen = true;
			onTextSegmentStart(textLength());
		} else if (p.type === 'text-delta' && typeof p.text === 'string') {
			if (!textOpen) {
				textOpen = true;
				onTextSegmentStart(textLength());
			}
			onTextDelta(p.text);
		} else if (p.type === 'tool-call') {
			closeReasoningSegment();
			onToolCall({
				toolCallId: p.toolCallId as string,
				toolName: p.toolName as string,
				args: p.input ?? p.args
			});
		} else if (p.type === 'file' || p.type === 'raw') {
			// 033 (finalize-composition §1): recognition pushes into the caller-
			// owned sink, stamping each newly recognized candidate with the
			// arrival offset (current text length) and firing the recognized-count
			// signal from recognition time.
			const firstNew = imageSink.length;
			collectStreamImages(p, imageSink);
			for (let k = firstNew; k < imageSink.length; k++) {
				const c = imageSink[k]!;
				if (c.offset === undefined) c.offset = textLength();
				onImageRecognized?.(c);
			}
		} else if (p.type === 'finish') {
			closeReasoningSegment();
			textOpen = false;
			finishReason = p.finishReason as string;
			// ai@7 renamed the finish-part usage fields to inputTokens/outputTokens;
			// accept both spellings per field. Prefer the richer of usage / totalUsage
			// per field: chunked-usage providers can report zeros in `usage` with real
			// counts in `totalUsage`.
			const read = (x: unknown) => {
				const u = (x ?? {}) as Record<string, number | undefined>;
				return {
					input: u.inputTokens ?? u.promptTokens,
					output: u.outputTokens ?? u.completionTokens,
					total: u.totalTokens
				};
			};
			const u = read(p.usage);
			const t = read(p.totalUsage);
			usage =
				p.usage || p.totalUsage
					? {
							promptTokens: Math.max(u.input ?? 0, t.input ?? 0) || undefined,
							completionTokens: Math.max(u.output ?? 0, t.output ?? 0) || undefined,
							totalTokens: Math.max(u.total ?? 0, t.total ?? 0) || undefined
						}
					: null;
		} else if (p.type === 'error') {
			throw p.error as Error;
		}
	}
	return { finishReason, usage: usage ?? null, images: imageSink };
}

interface CriticReport {
	issues: { type: string; message: string }[];
	attempts: number;
	succeeded: boolean;
}

interface CriticResult {
	text: string;
	report: CriticReport | null;
}

/**
 * Critic-round re-emit (033 contract §2, best-effort, documented): the
 * corrected reply is one fresh stretch, so the pre-critic candidates' arrival
 * offsets no longer apply to it — drop them and let the images append after
 * the corrected text instead of splitting it at stale positions.
 */
function appendAfterText(images: StreamImageCandidate[]): StreamImageCandidate[] {
	return images.map(({ offset: _stale, ...candidate }) => candidate);
}

function stripCriticIssue(issue: CriticIssue): { type: string; message: string } {
	return { type: issue.type, message: issue.message };
}

async function runCriticPhase(
	buf: string,
	deps: AgentTurnDeps,
	ctx: ChatMessage[],
	images: ImageCandidate[]
): Promise<CriticResult> {
	const initialIssues = await validateTurn(buf);
	if (initialIssues.length === 0) return { text: buf, report: null };

	const originalIssues = initialIssues.map(stripCriticIssue);
	// 035 (iteration-boundary site 4): the re-emit is a fresh stretch — the
	// pre-correction live blocks' offsets no longer apply, so the store resets
	// its live view before the first re-stream and opens a fresh text block at
	// offset 0. Fires only when issues were actually found (no flash on valid
	// turns).
	deps.onIterationBoundary?.();
	let corrected = buf;
	let attempts = 0;

	for (let i = 0; i < MAX_CORRECTIONS; i++) {
		const issue = initialIssues[0];
		const correctionMsg: ChatMessage = {
			role: 'user',
			content: `Your previous reply had a problem: ${issue.type}: ${issue.message}. Re-emit the full reply as valid markdown.`
		};
		const correctionCtx = [...ctx, correctionMsg];

		deps.updateStreamBuffer('');
		const sysParts = correctionCtx.filter((m) => m.role === 'system').map((m) => m.content);
		const messages = projectEntries(correctionCtx, {
			visionCapable: supportsVision(deps.config, deps.config.defaultModel)
		});
		const resolved = resolveTurnSettings(deps);

		const result = streamText({
			model: deps.model,
			system: sysParts.join('\n\n') || undefined,
			messages,
			...(deps.config.kind === 'openai-compatible' ? { includeRawChunks: true } : {}),
			abortSignal: deps.signal,
			providerOptions: resolved.providerOptions as never,
			...resolved.callSettings
		});

		let freshBuf = '';
		for await (const part of result.fullStream) {
			if (deps.signal.aborted) break;
			const p = part as Record<string, unknown>;
			if (p.type === 'text-delta') {
				freshBuf += p.text as string;
				deps.updateStreamBuffer(freshBuf);
			} else if (p.type === 'file' || p.type === 'raw') {
				// 033 T022 (research D7): critic-round recognitions fire the same
				// counter dep — the store's refinement and zero-image notice must
				// see every recognized image of the turn. Offset-less (critic
				// candidates append after the text at the finalize handoff).
				const firstNew = images.length;
				collectStreamImages(p, images);
				for (let k = firstNew; k < images.length; k++) {
					deps.onImageRecognized?.(images[k] as StreamImageCandidate);
				}
			} else if (p.type === 'error') {
				throw p.error as Error;
			}
		}

		attempts++;

		if (deps.signal.aborted) {
			corrected = freshBuf || corrected;
			return { text: corrected, report: null };
		}

		const freshIssues = await validateTurn(freshBuf);
		if (freshIssues.length === 0) {
			corrected = freshBuf;
			return {
				text: corrected,
				report: { issues: originalIssues, attempts, succeeded: true }
			};
		}
		corrected = freshBuf;
	}

	if (deps.signal.aborted) {
		return { text: corrected, report: null };
	}

	console.warn('[agent] critic: still broken after max corrections');
	return {
		text: corrected,
		report: { issues: originalIssues, attempts, succeeded: false }
	};
}

export async function runAgentTurn(deps: AgentTurnDeps): Promise<{ aborted: boolean }> {
	const toolCapability = resolveToolCapability(deps.config) && !deps.firstTurn;

	async function inner(toolsEnabled: boolean): Promise<{ aborted: boolean }> {
		const turnBudget = { subCalls: 0, maxSubCalls: 1 };
		let buf = '';
		let reasoningBuf = '';
		let blocks: PersistBlock[] = [];

		// Walk the iteration's blocks in arrival order (029 contract rules 1–6):
		// one reasoning row per reasoning block, one text row per text block —
		// except a single-text-block iteration persists one row with the full
		// buffer (byte-identical to pre-029). Empty/whitespace blocks make no
		// rows. Returns the last text row (anchor for id/usage plumbing).
		// 033 T016 (research D5): each image rides the text row whose slice
		// contains its arrival offset, converted to a row-relative offset so
		// the store can split that row's text at it (arrival ordering).
		// Overflowing offsets and offset-less (critic-round) candidates ride
		// the last text row with text — they append after its text.
		const walkPersist = async (
			iteration: number,
			textBuf: string,
			images?: StreamImageCandidate[],
			final?: boolean
		): Promise<Message | null> => {
			const textRows: { start: number; content: string }[] = [];
			let nextStart = textBuf.length;
			for (let k = blocks.length - 1; k >= 0; k--) {
				const b = blocks[k]!;
				if (b.kind !== 'text') continue;
				textRows.unshift({ start: b.start, content: textBuf.slice(b.start, nextStart) });
				nextStart = b.start;
			}
			const lastTextRow = (() => {
				for (let k = textRows.length - 1; k >= 0; k--) if (textRows[k]!.content) return k;
				return -1;
			})();
			const rides: StreamImageCandidate[][] = textRows.map(() => []);
			for (const img of images ?? []) {
				let row = lastTextRow;
				if (row !== -1 && img.offset !== undefined && img.offset < textBuf.length) {
					const inside = textRows.findIndex(
						(r) => r.content && img.offset! < r.start + r.content.length
					);
					if (inside !== -1) row = inside;
				}
				if (row !== -1) rides[row]!.push(img);
			}
			let msg: Message | null = null;
			let ti = 0;
			for (const b of blocks) {
				if (b.kind === 'reasoning') {
					if (b.text.trim()) await deps.appendReasoning?.(b.text, iteration);
					continue;
				}
				const row = textRows[ti]!;
				ti++;
				if (!row.content) continue;
				const rowImages = rides[ti - 1]!.map((img) =>
					img.offset === undefined
						? { ...img }
						: {
								...img,
								offset: Math.min(Math.max(img.offset - row.start, 0), row.content.length)
							}
				);
				if (rowImages.length > 0) {
					// 030 §3 (amended by 033): image-bearing appends carry their
					// slice's assigned candidates; on the abort paths the finalize
					// handoff is marked `final` (033, finalize-composition §3).
					msg = await deps.appendAssistantText(
						row.content,
						final ? { images: rowImages, final: true } : { images: rowImages }
					);
				} else if (final && !deps.signal.aborted) {
					// 033 T022 (research D7): the turn's non-aborted finalize appends
					// carry the `final` marker — it drives the store's zero-image
					// notice placement. Image-less abort persists keep the exact
					// pre-033 1-arg call (finalize-composition §3).
					msg = await deps.appendAssistantText(row.content, { final: true });
				} else {
					// Image-less interim rows keep the exact 1-arg call.
					msg = await deps.appendAssistantText(row.content);
				}
			}
			blocks = [];
			return msg;
		};

		// Image candidates accumulate across iterations and critic rounds (R-3).
		// This same caller-owned array is the consumeStream recognition sink
		// (033, research D3): candidates land here at arrival, so an abort
		// cannot discard them, and every persist site reads the full turn set.
		const turnImages: StreamImageCandidate[] = [];

		// 033 T011 (research D3): persist the turn's images through the stop
		// point — partial text rides the full image set; an image-only abort
		// persists the image-only row via the D2 fallback. Image-less aborts
		// keep the exact pre-033 1-arg call shapes.
		const persistAbortedTurn = async (): Promise<void> => {
			if (buf) {
				const msg =
					turnImages.length > 0
						? await deps.appendAssistantText(buf, { images: turnImages, final: true })
						: await deps.appendAssistantText(buf);
				deps.onTrace?.({ kind: 'persisted', messageId: msg.id, finalText: buf, empty: false });
			} else if (turnImages.length > 0) {
				const msg = await deps.appendAssistantText('', { images: turnImages, final: true });
				deps.onTrace?.({ kind: 'persisted', messageId: msg.id, finalText: '', empty: true });
			}
			deps.onTrace?.({ kind: 'aborted' });
		};
		const visionCapable = supportsVision(deps.config, deps.config.defaultModel);

		for (let i = 0; i < MAX_ITERATIONS; i++) {
			if (deps.signal.aborted) {
				await persistAbortedTurn();
				return { aborted: true };
			}

			const ctx = await deps.reassembleContext();

			const sysParts = ctx.filter((m) => m.role === 'system').map((m) => m.content);
			if (!deps.firstTurn) {
				sysParts.push(buildReplyTiersPreamble());
			}
			if (toolsEnabled) {
				sysParts.push(buildCapabilitiesPreamble());
			}
			if (deps.firstTurn) {
				sysParts.push(buildFirstTurnOrientationPreamble());
			}
			const messages = projectEntries(ctx, { visionCapable });

			const system = sysParts.join('\n\n');
			const disabled = deps.disabledToolIds ?? [];
			const disabledSet = new Set(disabled);
			const resolved = resolveTurnSettings(deps);
			const toolNames = toolsEnabled
				? getToolDefinitions()
						.filter((d) => !disabledSet.has(d.id))
						.map((d) => d.id)
				: [];
			deps.onTrace?.({
				kind: 'request',
				system,
				messages: messages.map(toTracedRequestMessage),
				tools: toolNames,
				providerOptions: resolved.providerOptions as Record<string, unknown>,
				callSettings: resolved.callSettings as Record<string, unknown>
			});

			let result;
			try {
				result = streamText({
					model: deps.model,
					system: system || undefined,
					messages,
					tools: buildSdkTools(toolsEnabled, disabled),
					...(deps.config.kind === 'openai-compatible' ? { includeRawChunks: true } : {}),
					abortSignal: deps.signal,
					providerOptions: resolved.providerOptions as never,
					...resolved.callSettings
				});
			} catch (err) {
				if (err instanceof Error && err.name === 'AbortError') {
					await persistAbortedTurn();
					return { aborted: true };
				}
				deps.onTrace?.({
					kind: 'error',
					message: err instanceof Error ? err.message : String(err)
				});
				throw err;
			}

			const toolCalls: CollectedToolCall[] = [];
			buf = '';
			blocks = [];

			let finishReason: string;
			let streamUsage: {
				promptTokens?: number;
				completionTokens?: number;
				totalTokens?: number;
			} | null;
			// Caller-owned turn-scoped sink (033, research D3): recognition pushes
			// straight into turnImages during streaming, so the abort paths below
			// see the in-flight iteration's images without a post-completion merge.
			try {
				({ finishReason, usage: streamUsage } = await consumeStream(
					result.fullStream,
					deps.signal,
					(text) => {
						buf += text;
						deps.updateStreamBuffer(buf);
					},
					(tc) => {
						if (getToolDefinition(tc.toolName)?.generative) {
							buf = '';
							deps.updateStreamBuffer('');
						}
						toolCalls.push(tc);
					},
					(t) => {
						reasoningBuf += t;
						deps.updateReasoningBuffer(reasoningBuf);
						const last = blocks[blocks.length - 1];
						if (last?.kind === 'reasoning') last.text = reasoningBuf;
					},
					() => {
						reasoningBuf = '';
						blocks.push({ kind: 'reasoning', text: '' });
						deps.onReasoningSegmentStart?.();
					},
					(startOffset) => {
						blocks.push({ kind: 'text', start: startOffset });
						deps.onTextSegmentStart?.(startOffset);
					},
					() => buf.length,
					turnImages,
					deps.onImageRecognized,
					deps.onTrace
				));
			} catch (err) {
				if (err instanceof Error && err.name === 'AbortError') {
					// 029 T013: persist blocks received so far — completed segments,
					// the partial in-flight segment, partial text — in arrival order,
					// nothing after the stop point (FR-008). 033: the full turn image
					// set rides the persist, and an image-only abort persists the
					// image-only row via the D2 fallback.
					const msg = await walkPersist(i, buf, turnImages, true);
					if (!msg && turnImages.length > 0) {
						await deps.appendAssistantText('', { images: turnImages, final: true });
					}
					reasoningBuf = '';
					deps.updateReasoningBuffer('');
					deps.onTrace?.({ kind: 'aborted' });
					return { aborted: true };
				}
				deps.onTrace?.({
					kind: 'error',
					message: err instanceof Error ? err.message : String(err)
				});
				throw err;
			}

			// Per-block reasoning rows are persisted by walkPersist at the persist
			// sites below, interleaved with text rows in arrival order (029 T012).
			// Only the live reasoning buffer is cleared here.
			reasoningBuf = '';
			deps.updateReasoningBuffer('');

			if (streamUsage) {
				deps.onTrace?.({
					kind: 'usage',
					usage: {
						promptTokens: streamUsage.promptTokens ?? 0,
						completionTokens: streamUsage.completionTokens ?? 0,
						totalTokens: streamUsage.totalTokens ?? 0
					},
					modelId: (deps.model as { modelId?: string })?.modelId ?? ''
				});
			}

			if (deps.signal.aborted) {
				const msg = await walkPersist(i, buf, turnImages, true);
				if (!msg && turnImages.length > 0) {
					await deps.appendAssistantText('', { images: turnImages, final: true });
				}
				deps.onTrace?.({ kind: 'aborted' });
				return { aborted: true };
			}

			if (finishReason !== 'tool-calls' || toolCalls.length === 0) {
				const { text: finalBuf, report } = await runCriticPhase(buf, deps, ctx, turnImages);
				if (report && deps.appendSelfCorrected) {
					await deps.appendSelfCorrected(report, finalBuf.length);
				}
				// 035 (corrected-persist): the corrected reply is one fresh stretch,
				// so the walk's stale block offsets don't apply — flush the ORIGINAL
				// iteration's reasoning rows in arrival order, then persist the
				// corrected text as a single row. Mutually exclusive with the walk
				// arm below, so reasoning persists exactly once.
				if (finalBuf !== buf) {
					for (const b of blocks) {
						if (b.kind === 'reasoning' && b.text.trim()) {
							await deps.appendReasoning?.(b.text, i);
						}
					}
					blocks = [];
				}
				// A critic correction re-emits the reply as one stretch — the stream's
				// block offsets no longer apply, so it persists as a single row
				// (contract rules 3/6); otherwise walk the blocks (029 T012). Images
				// ride both paths (030 §3, amended by 033): on the walk each image
				// rides the row containing its arrival offset; the critic re-emit
				// drops the stale offsets and appends the images after the
				// corrected text (finalize-composition §2, best-effort). 033 T022
				// (research D7): the turn's finalize calls are marked `final` on
				// both paths (the image-only fallback below already is).
				let msg =
					finalBuf !== buf
						? turnImages.length > 0
							? await deps.appendAssistantText(finalBuf, {
									images: appendAfterText(turnImages),
									final: true
								})
							: await deps.appendAssistantText(finalBuf, { final: true })
						: await walkPersist(i, finalBuf, turnImages, true);
				// 033 T008 (research D2): an image-only finalize (no text row) still
				// persists — the image-only row (content '') rides the single
				// finalize point, marked `final`.
				if (!msg && turnImages.length > 0) {
					msg = await deps.appendAssistantText('', { images: turnImages, final: true });
				}
				if (msg) {
					deps.onTrace?.({
						kind: 'persisted',
						messageId: msg.id,
						finalText: finalBuf,
						empty: !finalBuf
					});
				}
				// 035 (iteration-boundary site 2): the finalize persist replaced the
				// live view — both the corrected-append and walk branches land here,
				// incl. the image-only fallback above.
				deps.onIterationBoundary?.();
				return { aborted: false };
			}

			const hasGenerative = toolCalls.some((tc) => getToolDefinition(tc.toolName)?.generative);

			const allTerminal =
				toolCalls.length > 0 &&
				toolCalls.every((tc) => getToolDefinition(tc.toolName)?.terminal === true);

			const interimMsg = await walkPersist(i, buf);
			if (interimMsg) {
				deps.onTrace?.({
					kind: 'persisted',
					messageId: interimMsg.id,
					finalText: buf,
					empty: false
				});
			}
			// 035 (iteration-boundary site 1): iteration i's rows just became
			// durable — the next iteration must not re-show them live.
			deps.onIterationBoundary?.();
			if (hasGenerative) {
				buf = '';
				deps.updateStreamBuffer('');
			}

			for (const tc of toolCalls) {
				await deps.appendAssistantToolCall({
					toolCallId: tc.toolCallId,
					toolName: tc.toolName,
					args: tc.args
				});
			}

			const autoCalls: CollectedToolCall[] = [];
			const highCalls: CollectedToolCall[] = [];
			for (const tc of toolCalls) {
				const def = getToolDefinition(tc.toolName);
				if (def && def.risk === 'high') {
					highCalls.push(tc);
				} else {
					autoCalls.push(tc);
				}
			}

			type Decision = { approved: boolean; aborted?: boolean };

			const [autoResults, highResults] = await Promise.all([
				(async (): Promise<
					Array<{ tc: CollectedToolCall; result: Awaited<ReturnType<typeof toolsRun>> }>
				> => {
					const results: Array<{
						tc: CollectedToolCall;
						result: Awaited<ReturnType<typeof toolsRun>>;
					}> = [];
					for (const tc of autoCalls) {
						if (deps.signal.aborted) {
							results.push({ tc, result: { ok: false, summary: 'aborted' } });
							break;
						}
						deps.onTrace?.({
							kind: 'tool-call',
							toolCallId: tc.toolCallId,
							toolName: tc.toolName,
							args: tc.args as Record<string, unknown>
						});
						const r = await toolsRun(tc.toolName, tc.args, {
							chatId: deps.chatId,
							rootChatId: deps.rootChatId,
							signal: deps.signal,
							budget: turnBudget,
							model: deps.model,
							config: deps.config,
							requestApproval: deps.requestApproval,
							onTrace: deps.onTrace
						});
						const def = getToolDefinition(tc.toolName);
						if (def?.risk === 'low') {
							deps.notifyLowRisk(tc.toolName, r.summary);
						}
						results.push({ tc, result: r });
					}
					return results;
				})(),
				(async (): Promise<
					Array<{ tc: CollectedToolCall; result: Awaited<ReturnType<typeof toolsRun>> }>
				> => {
					const results: Array<{
						tc: CollectedToolCall;
						result: Awaited<ReturnType<typeof toolsRun>>;
					}> = [];
					if (highCalls.length === 0) return results;

					const decisions: Decision[] = await Promise.all(
						highCalls.map((tc) => {
							const def = getToolDefinition(tc.toolName);
							return deps.requestApproval({
								toolCallId: tc.toolCallId,
								toolName: tc.toolName,
								description: def?.description ?? tc.toolName,
								args: tc.args
							});
						})
					);

					for (let i = 0; i < highCalls.length; i++) {
						const tc = highCalls[i];
						const dec = decisions[i];
						if (deps.signal.aborted || dec.aborted) {
							if (getToolDefinition(tc.toolName)?.generative) {
								deps.notifyGenerativeStatus?.(null);
							}
							results.push({ tc, result: { ok: false, summary: 'aborted' } });
						} else if (!dec.approved) {
							if (getToolDefinition(tc.toolName)?.generative) {
								deps.notifyGenerativeStatus?.(null);
							}
							results.push({
								tc,
								result: { ok: false, summary: 'user declined', detail: { declined: true } }
							});
						} else {
							const def = getToolDefinition(tc.toolName);
							if (def?.generative && turnBudget.subCalls >= turnBudget.maxSubCalls) {
								deps.notifyGenerativeStatus?.(null);
								results.push({
									tc,
									result: { ok: false, summary: 'one generative action per turn' }
								});
								continue;
							}
							if (def?.generative) {
								turnBudget.subCalls++;
								const label =
									tc.toolName === 'create_quiz'
										? 'Creating your quiz…'
										: tc.toolName === 'create_lab'
											? 'Creating your lab…'
											: tc.toolName === 'propagate_to_parent'
												? 'Back-propagating to parent…'
												: 'Creating artifact…';
								deps.notifyGenerativeStatus?.({ toolName: tc.toolName, label });
							}
							deps.onTrace?.({
								kind: 'tool-call',
								toolCallId: tc.toolCallId,
								toolName: tc.toolName,
								args: tc.args as Record<string, unknown>
							});
							const r = await toolsRun(tc.toolName, tc.args, {
								chatId: deps.chatId,
								rootChatId: deps.rootChatId,
								signal: deps.signal,
								budget: turnBudget,
								model: deps.model,
								config: deps.config,
								requestApproval: deps.requestApproval,
								onTrace: deps.onTrace
							});
							if (getToolDefinition(tc.toolName)?.generative) {
								deps.notifyGenerativeStatus?.(null);
							}
							results.push({ tc, result: r });
						}
					}
					return results;
				})()
			]);

			const resultMap = new Map<
				string,
				{ tc: CollectedToolCall; result: Awaited<ReturnType<typeof toolsRun>> }
			>();
			for (const entry of [...autoResults, ...highResults]) {
				resultMap.set(entry.tc.toolCallId, entry);
			}

			let aborted = false;
			for (const tc of toolCalls) {
				const entry = resultMap.get(tc.toolCallId);
				if (!entry) continue;
				const detail = (entry.result as { detail?: unknown }).detail;
				await deps.appendToolResult({
					toolCallId: tc.toolCallId,
					toolName: tc.toolName,
					summary: entry.result.summary,
					detail,
					ok: entry.result.ok
				});
				deps.onTrace?.({
					kind: 'tool-result',
					toolCallId: tc.toolCallId,
					summary: entry.result.summary,
					detail: (detail as Record<string, unknown>) ?? {}
				});
				if (entry.result.summary === 'aborted') {
					aborted = true;
				}
			}

			if (aborted) {
				deps.onTrace?.({ kind: 'aborted' });
				return { aborted: true };
			}

			if (allTerminal) {
				return { aborted: false };
			}

			buf = '';
		}

		const ctx = await deps.reassembleContext();
		const finalBuf = buf + '\n\n_(…tool budget reached; continuing from here.)_';
		const budgetResult = await runCriticPhase(finalBuf, deps, ctx, turnImages);
		if (budgetResult.report && deps.appendSelfCorrected) {
			await deps.appendSelfCorrected(budgetResult.report, budgetResult.text.length);
		}
		// 033 T022 (research D7): the budget-exhaustion path is a finalize call —
		// its appends carry the `final` marker like the walk/critic paths.
		const msg =
			turnImages.length > 0
				? await deps.appendAssistantText(budgetResult.text, { images: turnImages, final: true })
				: await deps.appendAssistantText(budgetResult.text, { final: true });
		deps.onTrace?.({
			kind: 'persisted',
			messageId: msg.id,
			finalText: budgetResult.text,
			empty: !budgetResult.text
		});
		// 035 (iteration-boundary site 3): consistency no-op — the budget
		// path's blocks were consumed by the walk before this point.
		deps.onIterationBoundary?.();
		return { aborted: false };
	}

	if (toolCapability) {
		try {
			return await inner(true);
		} catch (err) {
			deps.onTrace?.({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
			const isApiErr =
				err instanceof APICallError &&
				(err.statusCode === 400 || /tool|function/i.test(err.message));
			if (isApiErr) {
				disableToolsForSession();
				if (import.meta.env.DEV) {
					console.warn(`[agent] safety-net disabled tools: ${err.message}`);
				}
				return await inner(false);
			}
			throw err;
		}
	}

	return inner(false);
}
