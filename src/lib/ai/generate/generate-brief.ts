import { z } from 'zod';
import type { ChatMessage, ChatStreamOptions, Provider } from '../types';
import { LEVEL_OPTIONS, MODE_OPTIONS, type LearningBrief } from '$lib/chat/brief';
import { extractFencedJson } from './fence';

export { extractFencedJson } from './fence';

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
	'- "scope": string (optional) — depth / time budget.',
	'',
	'Example:',
	'',
	`${FENCE}json`,
	'{"goal": "be able to write a basic Makefile", "context": "software engineer", "level": "some", "mode": "explainer", "scope": "30 min"}',
	FENCE,
	'',
	`Output ONE ${FENCE}json block. Do not include any fields other than goal, context, level, mode, scope.`
].join('\n');

const CORRECTION_INSTRUCTION =
	'That was not valid JSON matching the brief schema. Output ONLY one ```json block with {goal, context?, level?, mode?, scope?} and nothing else. level must be one of: novice, some, regular, practitioner. mode must be one of: socratic, explainer, build.';

export type GeneratedBrief = Pick<LearningBrief, 'goal' | 'context' | 'level' | 'mode' | 'scope'>;

export const GeneratedBriefSchema: z.ZodType<GeneratedBrief> = z
	.object({
		goal: z.string().min(1),
		context: z.string().optional(),
		level: z.enum(LEVEL_OPTIONS).optional(),
		mode: z.enum(MODE_OPTIONS).optional(),
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

const MAX_ATTEMPTS = 3;

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

async function accumulate(
	provider: Provider,
	turns: ChatMessage[],
	signal?: AbortSignal
): Promise<string> {
	let buffer = '';
	for await (const token of provider.chatStream(turns, { signal, reasoning: 'disabled' })) {
		buffer += token.text ?? token.delta ?? '';
	}
	return buffer;
}

export interface GenerateBriefOptions extends ChatStreamOptions {
	prompt?: string;
}

export async function generateBrief(
	provider: Provider,
	messages: ChatMessage[],
	opts?: GenerateBriefOptions
): Promise<GeneratedBrief> {
	const prompt = opts?.prompt ?? (await readBriefPrompt());
	const signal = opts?.signal;

	let attempt = 0;
	const turns: ChatMessage[] = [{ role: 'system', content: prompt }, ...messages];

	let lastRaw = '';
	while (attempt < MAX_ATTEMPTS) {
		attempt += 1;
		lastRaw = await accumulate(provider, turns, signal);

		try {
			return parseGeneratedBrief(lastRaw);
		} catch (err) {
			if (!(err instanceof Error && err.name === 'BriefParseError')) throw err;
			if (attempt >= MAX_ATTEMPTS) break;
			turns.push({ role: 'assistant', content: lastRaw });
			turns.push({ role: 'user', content: CORRECTION_INSTRUCTION });
		}
	}

	throw new BriefGenerationError(
		`Brief generation failed after ${MAX_ATTEMPTS} attempts; the model output never matched the schema.`,
		lastRaw
	);
}
