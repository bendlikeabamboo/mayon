/**
 * Lab generation orchestrator (architecture.md §7, P3).
 *
 * Uses the tool-calling structured-output helper (`generateObjectViaTool`) to
 * produce a strict lab object. Tool calling is the provider-native path
 * (`generateObject`'s `json_schema` responseFormat is silently ignored by
 * Z.AI/GLM and other OpenAI-compatible gateways, which then emit prose and
 * trip `NoObjectGeneratedError`). Retry logic is handled internally by the SDK
 * via `maxRetries`.
 */
import type { LanguageModel } from 'ai';
import type { ChatMessage } from '../types';
import { GeneratedLabSchema, type GeneratedLab } from './lab';
import { generateObjectViaTool, extractObjectErrorRaw } from './object-tool';
import { splitContextForGeneration } from './context-split';

export const DEFAULT_LAB_PROMPT = [
	'You are a learning lab designer. Given a conversation, produce a hands-on lab that lets a learner practice the topic.',
	'',
	'The output must be a JSON object with EXACTLY these four fields:',
	'',
	'- "title": string — a short lab title.',
	'- "intro": string — 1-2 sentence orientation.',
	'- "steps": array of strings — ordered, concrete instructions. Each step is one string.',
	'- "checklist": array of objects, each {"text": "..."} — verifiable completion criteria.',
	'',
	'Example of the exact shape (use this structure):',
	'',
	'{',
	'  "title": "Your First Makefile",',
	'  "intro": "Practice build automation by writing a minimal Makefile.",',
	'  "steps": [',
	'    "Create a file named `Makefile` in an empty directory.",',
	'    "Add a target that compiles a hello-world program.",',
	'    "Run `make` and confirm the binary is produced."',
	'  ],',
	'  "checklist": [',
	'    {"text": "The Makefile exists and has a valid target"},',
	'    {"text": "Running make produced the binary without errors"}',
	'  ]',
	'}',
	'',
	'The conversation may open with a learner brief (goal/level/mode/scope). Align the lab to that goal and level; make the checklist criteria test whether the learner can DO the goal.',
	'',
	'Rules:',
	'- Field names are lowercase and exactly as shown; checklist items are objects with a "text" key (not bare strings).',
	'- Do NOT include ids, done flags, or any field other than title/intro/steps/checklist.',
	'- steps and checklist are non-empty arrays.',
	'- Each step is a single concrete instruction string. Include backticks for code inline — do not escape them.'
].join('\n');

export class LabGenerationError extends Error {
	constructor(
		message: string,
		public readonly raw: string
	) {
		super(message);
		this.name = 'LabGenerationError';
	}
}

export async function readLabPrompt(): Promise<string> {
	const { repos } = await import('$lib/db');
	const override = await repos.settings.get<string>('labPrompt');
	return override && override.trim().length > 0 ? override : DEFAULT_LAB_PROMPT;
}

export interface GenerateLabOptions {
	prompt?: string;
	signal?: AbortSignal;
	onTrace?: (t: {
		request: import('$lib/agent/trace').ObjectTraceRequest;
		result?: { object: unknown };
		error?: string;
		raw?: string;
	}) => void;
}

export async function generateLab(
	model: LanguageModel,
	messages: ChatMessage[],
	opts: GenerateLabOptions = {}
): Promise<GeneratedLab> {
	const prompt = opts.prompt ?? (await readLabPrompt());
	const { system, messages: core } = splitContextForGeneration(messages, prompt, {
		includeSystemNotes: false
	});
	const request = {
		system,
		messages: core.map((m) => ({ role: m.role, content: String(m.content) })),
		schema: 'GeneratedLabSchema'
	};
	try {
		const { object } = await generateObjectViaTool(model, {
			schema: GeneratedLabSchema,
			system,
			messages: core,
			signal: opts.signal,
			maxRetries: 2
		});
		opts.onTrace?.({ request, result: { object } });
		return object;
	} catch (err) {
		opts.onTrace?.({
			request,
			error: err instanceof Error ? err.message : String(err),
			raw: extractObjectErrorRaw(err)
		});
		throw new LabGenerationError('Lab generation failed.', extractObjectErrorRaw(err));
	}
}
