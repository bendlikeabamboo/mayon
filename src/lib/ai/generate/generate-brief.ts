import { z } from 'zod';
import { generateObject, APICallError } from 'ai';
import type { LanguageModel } from 'ai';
import type { ChatMessage } from '../types';
import { LEVEL_OPTIONS, MODE_OPTIONS, type LearningBrief } from '$lib/chat/brief';
import { SCOPE_STRATEGY_IDS } from '$lib/chat/strategies';
import { extractFencedJson } from './generate-gate';

export { extractFencedJson } from './generate-gate';

const BT = String.fromCharCode(96);
const FENCE = BT.repeat(3);

export const DEFAULT_BRIEF_PROMPT = [
	'You infer a concise learning brief from a conversation.',
	'',
	`Reply with ONLY a single JSON object wrapped in one ${FENCE}json fenced block. No prose before or after the block.`,
	'',
	'The JSON has these fields:',
	'- "goal": string (required) — a doable verb phrase ("be able to …", "decide …").',
	'- "context": string (optional) — role / situation.',
	'- "level": string (optional) — one of: novice, some, regular, practitioner.',
	'- "mode": string (optional) — one of: socratic, explainer, build.',
	'- "scopeStrategy": string (optional) — one of: guided-curriculum, deep-dive, quick-orientation, reference-manual, guided-inquiry, devils-advocate, case-based, workshop, tutorial, pair-programming. Pick a strategy consistent with the inferred mode.',
	'- "scope": string (optional) — depth / time budget.',
	'',
	'Example:',
	'',
	`${FENCE}json`,
	'{"goal": "be able to write a basic Makefile", "context": "software engineer", "level": "some", "mode": "explainer", "scopeStrategy": "guided-curriculum", "scope": "30 min"}',
	FENCE,
	'',
	`Output ONE ${FENCE}json block. Do not include any fields other than goal, context, level, mode, scopeStrategy, scope.`
].join('\n');

export type GeneratedBrief = Pick<
	LearningBrief,
	'goal' | 'context' | 'level' | 'mode' | 'scopeStrategy' | 'scope'
>;

export const GeneratedBriefSchema: z.ZodType<GeneratedBrief> = z
	.object({
		goal: z.string().min(1),
		context: z.string().optional(),
		level: z.enum(LEVEL_OPTIONS).optional(),
		mode: z.enum(MODE_OPTIONS).optional(),
		scopeStrategy: z.enum(SCOPE_STRATEGY_IDS).optional(),
		scope: z.string().optional()
	})
	.strict();

export class BriefParseError extends Error {
	constructor(
		message: string,
		public readonly raw: string
	) {
		super(message);
		this.name = 'BriefParseError';
	}
}

export function parseGeneratedBrief(raw: string): GeneratedBrief {
	const jsonText = extractFencedJson(raw);
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch (err) {
		throw new BriefParseError(
			`Model output was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
			raw
		);
	}
	const result = GeneratedBriefSchema.safeParse(parsed);
	if (!result.success) {
		const first = result.error.issues[0];
		const path = first && first.path.length > 0 ? ` at ${first.path.join('.')}` : '';
		const msg = first ? `${first.message}${path}` : 'schema validation failed';
		throw new BriefParseError(`Model output did not match the brief schema: ${msg}`, raw);
	}
	return result.data;
}

export class BriefGenerationError extends Error {
	constructor(
		message: string,
		public readonly raw: string
	) {
		super(message);
		this.name = 'BriefGenerationError';
	}
}

export async function readBriefPrompt(): Promise<string> {
	const { repos } = await import('$lib/db');
	const override = await repos.settings.get<string>('briefPrompt');
	return override && override.trim().length > 0 ? override : DEFAULT_BRIEF_PROMPT;
}

export interface GenerateBriefOptions {
	prompt?: string;
	signal?: AbortSignal;
}

function extractRaw(err: unknown): string {
	if (err instanceof APICallError) {
		return err.responseBody ?? err.message ?? '';
	}
	if (err instanceof Error) {
		return err.message;
	}
	return String(err);
}

export async function generateBrief(
	model: LanguageModel,
	messages: ChatMessage[],
	opts?: GenerateBriefOptions
): Promise<GeneratedBrief> {
	const prompt = opts?.prompt ?? (await readBriefPrompt());
	try {
		const result = await generateObject({
			model,
			schema: GeneratedBriefSchema,
			system: prompt,
			messages: messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
			abortSignal: opts?.signal,
			maxRetries: 2
		});
		return result.object;
	} catch (err) {
		throw new BriefGenerationError('Brief generation failed.', extractRaw(err));
	}
}
