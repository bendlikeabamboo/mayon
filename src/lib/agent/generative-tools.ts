import { repos } from '#lib/db/index.js';
import type { ToolResult, Tool } from '#lib/agent/registry.js';
import type { ObjectTraceRequest } from '#lib/agent/trace.js';
import { assembleContext } from '#lib/chat/context.js';
import { generateQuiz, QuizGenerationError } from '#lib/ai/generate/generate-quiz.js';
import { toQuizQuestions } from '#lib/ai/generate/quiz.js';
import { generateLab, LabGenerationError } from '#lib/ai/generate/generate.js';
import { toLabContent } from '#lib/ai/generate/lab.js';
import { captureGenerator } from '#lib/telemetry/capture.js';

function toolSchema(properties: Record<string, unknown>): Record<string, unknown> {
	return {
		type: 'object',
		properties,
		required: Object.keys(properties ?? {})
	};
}

function modelIdOf(model: unknown): string {
	return (model as { modelId?: string } | null | undefined)?.modelId ?? '';
}

/** onTrace sink shared by both generative tools. */
interface TraceCapture {
	request?: ObjectTraceRequest;
	result?: { object: unknown };
	error?: string;
}

export const generativeTools: Tool[] = [
	{
		def: {
			id: 'create_quiz',
			description:
				'Generate a mixed quiz (MCQ, flashcard, short-answer) from the chat context and persist it. Do not reproduce the quiz content in chat — the artifact owns it.',
			parameters: toolSchema({
				topic: { type: 'string', description: 'Optional topic hint for the quiz.' },
				questionCount: {
					type: 'number',
					description: 'Approximate number of questions (optional).'
				}
			}),
			risk: 'high',
			generative: true
		},
		async run(args, ctxArg): Promise<ToolResult> {
			const startedAt = Date.now();
			const trace: TraceCapture = {};
			try {
				const ctx = await assembleContext(ctxArg.chatId);
				const generated = await generateQuiz(ctxArg.model, ctx, {
					signal: ctxArg.signal,
					onTrace: (t) => {
						trace.request = t.request;
						trace.result = t.result;
						trace.error = t.error;
					}
				});
				if (ctxArg.signal?.aborted) return { ok: false, summary: 'aborted' };

				const items = toQuizQuestions(generated);
				const quiz = await repos.quizzes.create({
					chatId: ctxArg.chatId,
					model: ctxArg.config.defaultModel
				});
				for (const it of items) {
					await repos.quizQuestions.add({
						quizId: quiz.id,
						type: it.type,
						prompt: it.prompt,
						payload: it.payload
					});
				}

				captureGenerator('quiz', {
					chatId: ctxArg.chatId,
					model: modelIdOf(ctxArg.model),
					provider: ctxArg.config.kind,
					startedAt,
					input: trace.request,
					result: trace.result ?? { object: generated },
					aborted: ctxArg.signal?.aborted === true
				});

				const firstQuestionTopic = items.length > 0 ? items[0].prompt.slice(0, 60) : 'Quiz';
				return {
					ok: true,
					summary: `Created quiz "${firstQuestionTopic}" (${items.length} questions). Saved at /quiz/${quiz.id}. Do not reproduce its questions in chat — the artifact owns them.`,
					detail: { artifact: { kind: 'quiz', id: quiz.id } }
				};
			} catch (err) {
				captureGenerator('quiz', {
					chatId: ctxArg.chatId,
					model: modelIdOf(ctxArg.model),
					provider: ctxArg.config.kind,
					startedAt,
					input: trace.request,
					error: trace.error ?? (err instanceof Error ? err.message : String(err)),
					aborted: ctxArg.signal?.aborted === true
				});
				if (err instanceof QuizGenerationError) {
					return { ok: false, summary: 'quiz generation failed' };
				}
				return {
					ok: false,
					summary: `quiz error: ${err instanceof Error ? err.message : String(err)}`
				};
			}
		}
	},
	{
		def: {
			id: 'create_lab',
			description:
				'Generate a hands-on lab with steps and a checklist from the chat context and persist it. Do not reproduce the lab content in chat — the artifact owns it.',
			parameters: toolSchema({
				topic: { type: 'string', description: 'Optional topic hint for the lab.' }
			}),
			risk: 'high',
			generative: true
		},
		async run(args, ctxArg): Promise<ToolResult> {
			const startedAt = Date.now();
			const trace: TraceCapture = {};
			try {
				const ctx = await assembleContext(ctxArg.chatId);
				const generated = await generateLab(ctxArg.model, ctx, {
					signal: ctxArg.signal,
					onTrace: (t) => {
						trace.request = t.request;
						trace.result = t.result;
						trace.error = t.error;
					}
				});
				if (ctxArg.signal?.aborted) return { ok: false, summary: 'aborted' };

				const { title, content, checklist } = toLabContent(generated);
				const lab = await repos.labs.create({
					chatId: ctxArg.chatId,
					title,
					content,
					checklist,
					model: ctxArg.config.defaultModel
				});

				captureGenerator('lab', {
					chatId: ctxArg.chatId,
					model: modelIdOf(ctxArg.model),
					provider: ctxArg.config.kind,
					startedAt,
					input: trace.request,
					result: trace.result ?? { object: generated },
					aborted: ctxArg.signal?.aborted === true
				});

				return {
					ok: true,
					summary: `Created lab "${title}". Saved at /lab/${lab.id}. Do not reproduce its content in chat — the artifact owns it.`,
					detail: { artifact: { kind: 'lab', id: lab.id } }
				};
			} catch (err) {
				captureGenerator('lab', {
					chatId: ctxArg.chatId,
					model: modelIdOf(ctxArg.model),
					provider: ctxArg.config.kind,
					startedAt,
					input: trace.request,
					error: trace.error ?? (err instanceof Error ? err.message : String(err)),
					aborted: ctxArg.signal?.aborted === true
				});
				if (err instanceof LabGenerationError) {
					return { ok: false, summary: 'lab generation failed' };
				}
				return {
					ok: false,
					summary: `lab error: ${err instanceof Error ? err.message : String(err)}`
				};
			}
		}
	}
];
