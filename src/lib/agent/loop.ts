import { streamText, tool, jsonSchema, APICallError } from 'ai';
import type { LanguageModel, ToolSet } from 'ai';
import { getToolDefinitions, getToolDefinition, toolsRun } from '$lib/agent/registry';
import { isSessionDisabled, disableToolsForSession } from '$lib/agent/capability';
import { validateTurn, type CriticIssue } from '$lib/agent/critic';
import { projectEntries } from '$lib/chat/projection';
import { buildCapabilitiesPreamble, buildFirstTurnOrientationPreamble } from '$lib/chat/brief';
import type { ChatMessage, ReasoningEffort, ProviderConfig } from '$lib/ai/types';
import { resolveRequestSettings } from '$lib/ai/dialects';
import type { Message } from '$lib/db/schema';
import type { TraceEvent, TracedRequestMessage } from './trace';

const MAX_ITERATIONS = 6;
const MAX_CORRECTIONS = 2;

export interface AgentTurnDeps {
	model: LanguageModel;
	config: ProviderConfig;
	chatId: string;
	rootChatId: string;
	signal: AbortSignal;
	effort: ReasoningEffort;
	updateStreamBuffer: (next: string) => void;
	updateReasoningBuffer: (next: string) => void;
	appendReasoning?: (text: string, iteration: number) => Promise<void>;
	appendSelfCorrected?: (
		report: { issues: { type: string; message: string }[]; attempts: number; succeeded: boolean },
		finalTextLength: number
	) => Promise<void>;
	appendAssistantText: (
		content: string,
		opts?: { model?: string; reasoning?: string }
	) => Promise<Message>;
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
	onTrace?: (e: TraceEvent) => void
): Promise<{
	finishReason: string;
	usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null;
}> {
	let finishReason = '';
	let usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null =
		null;
	for await (const part of fullStream) {
		if (signal.aborted) break;
		const p = part as Record<string, unknown>;
		onTrace?.({ kind: 'part', type: p.type as string, payload: p });
		if (p.type === 'text-delta' && typeof p.text === 'string') {
			onTextDelta(p.text);
		} else if (p.type === 'tool-call') {
			onToolCall({
				toolCallId: p.toolCallId as string,
				toolName: p.toolName as string,
				args: p.input ?? p.args
			});
		} else if (p.type === 'reasoning-delta' && typeof p.text === 'string') {
			onReasoningDelta(p.text);
		} else if (p.type === 'finish') {
			finishReason = p.finishReason as string;
			usage =
				((p.usage ?? p.totalUsage) as
					| { promptTokens?: number; completionTokens?: number; totalTokens?: number }
					| undefined) ?? null;
		} else if (p.type === 'error') {
			throw p.error as Error;
		}
	}
	return { finishReason, usage: usage ?? null };
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

function stripCriticIssue(issue: CriticIssue): { type: string; message: string } {
	return { type: issue.type, message: issue.message };
}

async function runCriticPhase(
	buf: string,
	deps: AgentTurnDeps,
	ctx: ChatMessage[]
): Promise<CriticResult> {
	const initialIssues = await validateTurn(buf);
	if (initialIssues.length === 0) return { text: buf, report: null };

	const originalIssues = initialIssues.map(stripCriticIssue);
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
		const messages = projectEntries(correctionCtx);
		const resolved = resolveTurnSettings(deps);

		const result = streamText({
			model: deps.model,
			system: sysParts.join('\n\n') || undefined,
			messages,
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
	const baseCapability = deps.config.toolCapability && !isSessionDisabled();
	const toolCapability = baseCapability && !deps.firstTurn;

	async function inner(toolsEnabled: boolean): Promise<{ aborted: boolean }> {
		const turnBudget = { subCalls: 0, maxSubCalls: 1 };
		let buf = '';
		let reasoningBuf = '';

		for (let i = 0; i < MAX_ITERATIONS; i++) {
			if (deps.signal.aborted) {
				if (buf) {
					const msg = await deps.appendAssistantText(buf);
					deps.onTrace?.({ kind: 'persisted', messageId: msg.id, finalText: buf, empty: false });
				}
				deps.onTrace?.({ kind: 'aborted' });
				return { aborted: true };
			}

			const ctx = await deps.reassembleContext();

			const sysParts = ctx.filter((m) => m.role === 'system').map((m) => m.content);
			if (toolsEnabled) {
				sysParts.push(buildCapabilitiesPreamble());
			}
			if (deps.firstTurn) {
				sysParts.push(buildFirstTurnOrientationPreamble());
			}
			const messages = projectEntries(ctx);

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
					abortSignal: deps.signal,
					providerOptions: resolved.providerOptions as never,
					...resolved.callSettings
				});
			} catch (err) {
				if (err instanceof Error && err.name === 'AbortError') {
					if (buf) {
						const msg = await deps.appendAssistantText(buf);
						deps.onTrace?.({ kind: 'persisted', messageId: msg.id, finalText: buf, empty: false });
					}
					deps.onTrace?.({ kind: 'aborted' });
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

			let finishReason: string;
			let streamUsage: {
				promptTokens?: number;
				completionTokens?: number;
				totalTokens?: number;
			} | null;
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
					},
					deps.onTrace
				));
			} catch (err) {
				if (err instanceof Error && err.name === 'AbortError') {
					if (reasoningBuf) {
						await deps.appendReasoning?.(reasoningBuf, i);
					}
					reasoningBuf = '';
					deps.updateReasoningBuffer('');
					if (buf) {
						const msg = await deps.appendAssistantText(buf);
						deps.onTrace?.({ kind: 'persisted', messageId: msg.id, finalText: buf, empty: false });
					}
					deps.onTrace?.({ kind: 'aborted' });
					return { aborted: true };
				}
				deps.onTrace?.({
					kind: 'error',
					message: err instanceof Error ? err.message : String(err)
				});
				throw err;
			}

			// Persist this iteration's reasoning before any text/tool rows of the same
			// iteration, so stored order matches the canonical display order (003 US3).
			if (reasoningBuf) {
				await deps.appendReasoning?.(reasoningBuf, i);
			}
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
				if (buf) {
					const msg = await deps.appendAssistantText(buf);
					deps.onTrace?.({ kind: 'persisted', messageId: msg.id, finalText: buf, empty: false });
				}
				deps.onTrace?.({ kind: 'aborted' });
				return { aborted: true };
			}

			if (finishReason !== 'tool-calls' || toolCalls.length === 0) {
				const { text: finalBuf, report } = await runCriticPhase(buf, deps, ctx);
				if (report && deps.appendSelfCorrected) {
					await deps.appendSelfCorrected(report, finalBuf.length);
				}
				const msg = await deps.appendAssistantText(finalBuf);
				deps.onTrace?.({
					kind: 'persisted',
					messageId: msg.id,
					finalText: finalBuf,
					empty: !finalBuf
				});
				return { aborted: false };
			}

			const hasGenerative = toolCalls.some((tc) => getToolDefinition(tc.toolName)?.generative);

			const allTerminal =
				toolCalls.length > 0 &&
				toolCalls.every((tc) => getToolDefinition(tc.toolName)?.terminal === true);

			if (buf && !hasGenerative) {
				const msg = await deps.appendAssistantText(buf);
				deps.onTrace?.({ kind: 'persisted', messageId: msg.id, finalText: buf, empty: false });
			}
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
							results.push({ tc, result: { ok: false, summary: 'user declined' } });
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
		const budgetResult = await runCriticPhase(finalBuf, deps, ctx);
		if (budgetResult.report && deps.appendSelfCorrected) {
			await deps.appendSelfCorrected(budgetResult.report, budgetResult.text.length);
		}
		const msg = await deps.appendAssistantText(budgetResult.text);
		deps.onTrace?.({
			kind: 'persisted',
			messageId: msg.id,
			finalText: budgetResult.text,
			empty: !budgetResult.text
		});
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
