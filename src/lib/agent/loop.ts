import { streamText, tool, jsonSchema, APICallError } from 'ai';
import type { LanguageModel, ToolSet } from 'ai';
import { getToolDefinitions, getToolDefinition, toolsRun } from '$lib/agent/registry';
import { isSessionDisabled, disableToolsForSession } from '$lib/agent/capability';
import { validateTurn } from '$lib/agent/critic';
import { toCoreMessages } from '$lib/chat/context';
import { buildCapabilitiesPreamble } from '$lib/chat/brief';
import type { ChatMessage, ReasoningMode, ProviderConfig } from '$lib/ai/types';
import { providerOptionsForReasoning } from '$lib/ai/sdk-factory';
import type { Message } from '$lib/db/schema';

const MAX_ITERATIONS = 6;
const MAX_CORRECTIONS = 2;

export interface AgentTurnDeps {
	model: LanguageModel;
	config: ProviderConfig;
	chatId: string;
	rootChatId: string;
	signal: AbortSignal;
	reasoning: ReasoningMode;
	updateStreamBuffer: (next: string) => void;
	appendAssistantText: (content: string, opts?: { model?: string }) => Promise<Message>;
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
}

interface CollectedToolCall {
	toolCallId: string;
	toolName: string;
	args: unknown;
}

function buildSdkTools(enabled: boolean): ToolSet {
	if (!enabled) return {};
	const out: ToolSet = {};
	for (const def of getToolDefinitions()) {
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
	onToolCall: (tc: CollectedToolCall) => void
): Promise<{ finishReason: string }> {
	let finishReason = '';
	for await (const part of fullStream) {
		if (signal.aborted) break;
		const p = part as Record<string, unknown>;
		if (p.type === 'text-delta') {
			onTextDelta(p.textDelta as string);
		} else if (p.type === 'tool-call') {
			onToolCall({
				toolCallId: p.toolCallId as string,
				toolName: p.toolName as string,
				args: p.args
			});
		} else if (p.type === 'finish') {
			finishReason = p.finishReason as string;
		} else if (p.type === 'error') {
			throw p.error as Error;
		}
	}
	return { finishReason };
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
				freshBuf += p.textDelta as string;
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
	const toolCapability = deps.config.toolCapability && !isSessionDisabled();

	async function inner(toolsEnabled: boolean): Promise<{ aborted: boolean }> {
		const turnBudget = { subCalls: 0, maxSubCalls: 1 };
		let buf = '';

		for (let i = 0; i < MAX_ITERATIONS; i++) {
			if (deps.signal.aborted) {
				if (buf) await deps.appendAssistantText(buf);
				return { aborted: true };
			}

			const ctx = await deps.reassembleContext();

			const sysParts = ctx.filter((m) => m.role === 'system').map((m) => m.content);
			if (toolsEnabled) {
				sysParts.push(buildCapabilitiesPreamble());
			}
			const messages = toCoreMessages(ctx);

			let result;
			try {
				result = streamText({
					model: deps.model,
					system: sysParts.join('\n\n') || undefined,
					messages,
					tools: buildSdkTools(toolsEnabled),
					abortSignal: deps.signal,
					providerOptions: providerOptionsForReasoning(deps.config.kind, deps.reasoning) as never
				});
			} catch (err) {
				if (err instanceof Error && err.name === 'AbortError') {
					if (buf) await deps.appendAssistantText(buf);
					return { aborted: true };
				}
				throw err;
			}

			const toolCalls: CollectedToolCall[] = [];
			buf = '';

			let finishReason: string;
			try {
				({ finishReason } = await consumeStream(
					result.fullStream,
					deps.signal,
					(text) => {
						buf += text;
						deps.updateStreamBuffer(buf);
					},
					(tc) => toolCalls.push(tc)
				));
			} catch (err) {
				if (err instanceof Error && err.name === 'AbortError') {
					if (buf) await deps.appendAssistantText(buf);
					return { aborted: true };
				}
				throw err;
			}

			if (deps.signal.aborted) {
				if (buf) await deps.appendAssistantText(buf);
				return { aborted: true };
			}

			if (finishReason !== 'tool-calls' || toolCalls.length === 0) {
				const finalBuf = await runCriticPhase(buf, deps, ctx);
				await deps.appendAssistantText(finalBuf);
				return { aborted: false };
			}

			if (buf) {
				await deps.appendAssistantText(buf);
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
						const r = await toolsRun(tc.toolName, tc.args, {
							chatId: deps.chatId,
							rootChatId: deps.rootChatId,
							signal: deps.signal,
							budget: turnBudget,
							model: deps.model,
							config: deps.config
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
							results.push({ tc, result: { ok: false, summary: 'aborted' } });
						} else if (!dec.approved) {
							results.push({ tc, result: { ok: false, summary: 'user declined' } });
						} else {
							const def = getToolDefinition(tc.toolName);
							if (def?.generative && turnBudget.subCalls >= turnBudget.maxSubCalls) {
								results.push({
									tc,
									result: { ok: false, summary: 'one generative action per turn' }
								});
								continue;
							}
							if (def?.generative) turnBudget.subCalls++;
							const r = await toolsRun(tc.toolName, tc.args, {
								chatId: deps.chatId,
								rootChatId: deps.rootChatId,
								signal: deps.signal,
								budget: turnBudget,
								model: deps.model,
								config: deps.config
							});
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
				await deps.appendToolResult({
					toolCallId: tc.toolCallId,
					toolName: tc.toolName,
					summary: entry.result.summary,
					detail: (entry.result as { detail?: unknown }).detail
				});
				if (entry.result.summary === 'aborted') {
					aborted = true;
				}
			}

			if (aborted) return { aborted: true };

			buf = '';
		}

		const ctx = await deps.reassembleContext();
		const finalBuf = buf + '\n\n_(…tool budget reached; continuing from here.)_';
		await runCriticPhase(finalBuf, deps, ctx);
		await deps.appendAssistantText(finalBuf);
		return { aborted: false };
	}

	if (toolCapability) {
		try {
			return await inner(true);
		} catch (err) {
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
