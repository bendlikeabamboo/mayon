import { streamText, tool, jsonSchema, APICallError } from 'ai';
import type { LanguageModel, ToolSet } from 'ai';
import { getToolDefinitions, getToolDefinition, toolsRun } from '$lib/agent/registry';
import { isSessionDisabled, disableToolsForSession } from '$lib/agent/capability';
import { validateTurn } from '$lib/agent/critic';
import { toCoreMessages } from '$lib/chat/context';
import { buildCapabilitiesPreamble, buildFirstTurnOrientationPreamble } from '$lib/chat/brief';
import type { ChatMessage, ReasoningEffort, ProviderConfig } from '$lib/ai/types';
import { providerOptionsForReasoning } from '$lib/ai/sdk-factory';
import type { Message } from '$lib/db/schema';
import type { TraceEvent } from './trace';

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

async function runCriticPhase(
	buf: string,
	deps: AgentTurnDeps,
	ctx: ChatMessage[]
): Promise<string> {
	let issues = await validateTurn(buf);
	if (issues.length === 0) return buf;

	let corrected = buf;
	for (let attempt = 0; attempt < MAX_CORRECTIONS; attempt++) {
		const issue = issues[0];
		const correctionMsg: ChatMessage = {
			role: 'user',
			content: `Your previous reply had a problem: ${issue.type}: ${issue.message}. Re-emit the full reply as valid markdown.`
		};
		const correctionCtx = [...ctx, correctionMsg];

		deps.updateStreamBuffer('');
		const sysParts = correctionCtx.filter((m) => m.role === 'system').map((m) => m.content);
		const messages = toCoreMessages(correctionCtx);

		const result = streamText({
			model: deps.model,
			system: sysParts.join('\n\n') || undefined,
			messages,
			abortSignal: deps.signal
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

		if (deps.signal.aborted) {
			corrected = freshBuf || corrected;
			break;
		}

		issues = await validateTurn(freshBuf);
		if (issues.length === 0) {
			corrected = freshBuf;
			break;
		}
		corrected = freshBuf;
	}

	if (issues.length > 0) {
		console.warn('[agent] critic: still broken after max corrections');
	}

	return corrected;
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
			const messages = toCoreMessages(ctx);

			const system = sysParts.join('\n\n');
			const disabled = deps.disabledToolIds ?? [];
			const disabledSet = new Set(disabled);
			const pOpts = providerOptionsForReasoning(
				deps.config.kind,
				deps.effort,
				deps.config.name,
				deps.config.defaultModel
			);
			const toolNames = toolsEnabled
				? getToolDefinitions()
						.filter((d) => !disabledSet.has(d.id))
						.map((d) => d.id)
				: [];
			deps.onTrace?.({
				kind: 'request',
				system,
				messages: ctx.map((m) => ({
					role: m.role,
					content: typeof m.content === 'string' ? m.content : String(m.content)
				})),
				tools: toolNames,
				providerOptions: pOpts as Record<string, unknown>
			});

			let result;
			try {
				result = streamText({
					model: deps.model,
					system: system || undefined,
					messages,
					tools: buildSdkTools(toolsEnabled, disabled),
					abortSignal: deps.signal,
					providerOptions: pOpts as never
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
				const finalBuf = await runCriticPhase(buf, deps, ctx);
				const msg = await deps.appendAssistantText(finalBuf, {
					reasoning: reasoningBuf || undefined
				});
				deps.onTrace?.({
					kind: 'persisted',
					messageId: msg.id,
					finalText: finalBuf,
					empty: !finalBuf
				});
				return { aborted: false };
			}

			const hasGenerative = toolCalls.some((tc) => getToolDefinition(tc.toolName)?.generative);

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
					detail
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

			buf = '';
		}

		const ctx = await deps.reassembleContext();
		const finalBuf = buf + '\n\n_(…tool budget reached; continuing from here.)_';
		await runCriticPhase(finalBuf, deps, ctx);
		const msg = await deps.appendAssistantText(finalBuf, {
			reasoning: reasoningBuf || undefined
		});
		deps.onTrace?.({ kind: 'persisted', messageId: msg.id, finalText: finalBuf, empty: !finalBuf });
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
