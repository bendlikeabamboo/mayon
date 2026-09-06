/**
 * Branch-artifact summary generation (020 US1, contract §6).
 *
 * One-shot `generateText` over the branch's assembled context (parent prefix +
 * branch turns), summarized into a handoff note for the parent. The role
 * framing lives in the system prompt; the summarization task rides as the
 * TRAILING user turn — with the transcript ending on the branch's own
 * assistant reply, a system-only instruction reads as "continue the
 * transcript" and models echo the content instead of summarizing it.
 * Mirrors the title path (`generate-title.ts`): active SDK provider,
 * `maxRetries: 0`, trace persisted to `agent_traces` with kind
 * `branch_artifact_summary` via `buildObjectTrace`. Throws on failure — the
 * caller inserts nothing (FR-013); the trace still lands best-effort on the
 * error path.
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

/**
 * Role framing only — the actual summarization task rides as the FINAL user
 * turn (see `BRANCH_SUMMARY_TASK`). With the instruction in the system role
 * and a transcript that ends on the branch's big assistant reply, models
 * treat the call as "continue the transcript" and reproduce the content
 * instead of summarizing it; anchoring the task at the generation point is
 * what keeps the output a summary.
 */
const SUMMARY_SYSTEM = [
	'You write the handoff note a branched conversation sends back to its parent conversation.',
	"You compress: you never reproduce the branch's content, and you never invent what the transcript does not show."
].join('\n');

const BRANCH_SUMMARY_TASK = [
	"The transcript above is the branch's full view: first the parent conversation up to the branch point, then the branch's own turns.",
	'Write the handoff summary the branch sends back to the parent now. Rules:',
	'- Summarize only what the BRANCH added or changed relative to the parent — decisions made, corrections applied, content added, and the resulting state. Do not restate what the parent already knew.',
	"- Do not reproduce, restate, or continue the branch's content. No lessons, no code dumps — compress it into prose.",
	'- Plain prose. No headings, no preamble, no sign-off, no offers to continue.',
	'- A few sentences, at most about 120 words.'
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
	const { system, messages } = splitContextForGeneration(ctx, SUMMARY_SYSTEM);
	// The task MUST be the trailing user turn: it anchors the instruction at
	// the exact generation point instead of letting the model continue the
	// transcript (which ends on the branch's own assistant reply).
	const taskedMessages: typeof messages = [
		...messages,
		{ role: 'user' as const, content: BRANCH_SUMMARY_TASK }
	];
	const request: ObjectTraceRequest = {
		system,
		messages: taskedMessages.map((m) => ({ role: m.role, content: m.content })),
		schema: 'text',
		providerOptions: requestSettings.providerOptions,
		callSettings: requestSettings.callSettings
	};
	const startTime = Date.now();
	try {
		const result = await generateText({
			model,
			system,
			messages: taskedMessages,
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
