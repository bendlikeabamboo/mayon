/**
 * Branch-artifact summary generation (020 US1, contract §6).
 *
 * One-shot `generateText` over the branch's assembled context (parent prefix +
 * branch turns): "what happened on this branch since it diverged". Mirrors the
 * title path (`generate-title.ts`): active SDK provider, `maxRetries: 0`,
 * trace persisted to `agent_traces` with kind `branch_artifact_summary` via
 * `buildObjectTrace`. Throws on failure — the caller inserts nothing (FR-013);
 * the trace still lands best-effort on the error path.
 */
import { generateText } from 'ai';
import type { LanguageModel } from 'ai';
import type { ProviderConfig } from '$lib/ai/types';
import { getActiveSdkProvider } from '$lib/ai/client';
import { resolveRequestSettings } from '$lib/ai/dialects';
import { assembleContext } from '$lib/chat/context';
import { splitContextForGeneration } from './context-split';
import { buildObjectTrace, type ObjectTraceInput, type ObjectTraceRequest } from '$lib/agent/trace';
import { repos } from '$lib/db';

export const BRANCH_SUMMARY_TRACE_KIND = 'branch_artifact_summary';

const SUMMARY_PROMPT = [
	'You summarize what happened on a branch of a conversation so the branch can hand its outcome back to the parent conversation.',
	'Write a concise, faithful summary of what happened on this branch since it diverged from the parent: decisions made, fixes applied, and the current state.',
	'Rules:',
	'- Plain prose. No preamble, no headings, no sign-off.',
	'- Only what the transcript shows; never invent details.',
	'- At most three short paragraphs.'
].join('\n');

export interface BranchArtifactSummary {
	/** The model-written summary text, as returned. */
	summary: string;
	/** `agent_traces` row id for the generation, or null when tracing failed. */
	traceId: string | null;
}

async function persistTrace(
	chatId: string,
	model: LanguageModel,
	config: ProviderConfig,
	traceInput: ObjectTraceInput,
	startTime: number
): Promise<string | null> {
	try {
		const row = await repos.agentTraces.create({
			id: '',
			createdAt: startTime,
			chatId,
			kind: BRANCH_SUMMARY_TRACE_KIND,
			model: (model as { modelId?: string }).modelId ?? '',
			configKind: config.kind,
			reasoning: '',
			durationMs: Date.now() - startTime,
			trace: buildObjectTrace(traceInput)
		});
		return row.id;
	} catch {
		/* best-effort; never surfaces */
		return null;
	}
}

export async function generateBranchArtifactSummary(
	branchChatId: string,
	signal?: AbortSignal
): Promise<BranchArtifactSummary> {
	const [{ model, config }, ctx] = await Promise.all([
		getActiveSdkProvider(),
		assembleContext(branchChatId)
	]);
	const requestSettings = resolveRequestSettings(config, config.defaultModel, 'off');
	const { system, messages } = splitContextForGeneration(ctx, SUMMARY_PROMPT);
	const request: ObjectTraceRequest = {
		system,
		messages: messages.map((m) => ({ role: m.role, content: m.content })),
		schema: 'text',
		providerOptions: requestSettings.providerOptions,
		callSettings: requestSettings.callSettings
	};
	const startTime = Date.now();
	try {
		const result = await generateText({
			model,
			system,
			messages,
			abortSignal: signal,
			maxRetries: 0,
			providerOptions: requestSettings.providerOptions as never,
			...requestSettings.callSettings
		});
		const traceInput: ObjectTraceInput = {
			kind: BRANCH_SUMMARY_TRACE_KIND,
			request,
			result: { object: result.text }
		};
		const traceId = await persistTrace(branchChatId, model, config, traceInput, startTime);
		return { summary: result.text, traceId };
	} catch (err) {
		await persistTrace(
			branchChatId,
			model,
			config,
			{
				kind: BRANCH_SUMMARY_TRACE_KIND,
				request,
				error: err instanceof Error ? err.message : String(err)
			},
			startTime
		);
		throw err;
	}
}
