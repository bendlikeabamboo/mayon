import { generateText } from 'ai';
import type { McpClient } from './client';
import type { McpServerConfig } from './types';
import { withTimeout } from './caps';

export interface SamplingTurnState {
	callCount: number;
	tokensUsed: number;
}

export function registerSamplingHandler(
	client: McpClient,
	config: McpServerConfig,
	turnState: SamplingTurnState
): void {
	client.registerRequestHandler('sampling/createMessage', async (_id, params) => {
		const ctx = client.turnContext;

		if (!config.allowSampling) {
			return { error: { code: -32603, message: 'sampling denied' } };
		}

		const maxCalls = config.samplingMaxCallsPerTurn ?? 1;
		const maxTokens = config.samplingMaxTokensPerTurn ?? 2048;

		if (turnState.callCount >= maxCalls) {
			return { error: { code: -32603, message: 'sampling denied: per-turn call limit reached' } };
		}

		if (turnState.tokensUsed >= maxTokens) {
			return {
				error: { code: -32603, message: 'sampling denied: per-turn token budget exhausted' }
			};
		}

		const p = params as
			| {
					messages?: Array<{ role: string; content: unknown }>;
					maxTokens?: number;
			  }
			| undefined;
		const requestedTokens = p?.maxTokens ?? 1024;
		const remainingBudget = maxTokens - turnState.tokensUsed;
		if (requestedTokens > remainingBudget) {
			return {
				error: {
					code: -32603,
					message: 'sampling denied: requested tokens exceed remaining budget'
				}
			};
		}

		if (!ctx?.requestApproval) {
			return { error: { code: -32603, message: 'sampling denied: no approval mechanism' } };
		}

		const serverName = config.name;
		const promptPreview = (p?.messages ?? [])
			.map(
				(m) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`
			)
			.join('\n')
			.slice(0, 200);

		const decision = await ctx.requestApproval({
			toolCallId: `mcp-sampling-${config.id}-${turnState.callCount}`,
			toolName: `MCP Sampling: ${serverName}`,
			description: `Server "${serverName}" requests LLM sampling (budget: ${remainingBudget} tokens remaining)`,
			args: { prompt: promptPreview, maxTokens: requestedTokens }
		});

		if (!decision.approved || decision.aborted) {
			return { error: { code: -32603, message: 'sampling denied' } };
		}

		if (!ctx.model) {
			return { error: { code: -32603, message: 'sampling denied: no active model' } };
		}

		turnState.callCount++;

		const { text, usage } = await withTimeout(
			generateText({
				model: ctx.model,
				messages: (p?.messages ?? []).map((m) => ({
					role: m.role as 'user' | 'assistant',
					content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
				})),
				abortSignal: ctx.signal
			}),
			30000,
			ctx.signal
		);

		if (usage) {
			turnState.tokensUsed += usage.totalTokens ?? 0;
		}

		ctx.onTrace?.({
			kind: 'mcp-sampling',
			serverId: config.id,
			serverName,
			approved: true,
			tokensUsed: usage?.totalTokens ?? 0
		});

		return {
			result: {
				role: 'assistant',
				content: [{ type: 'text' as const, text: text ?? '' }],
				model: (ctx.config as { modelId?: string })?.modelId ?? 'unknown'
			}
		};
	});
}
