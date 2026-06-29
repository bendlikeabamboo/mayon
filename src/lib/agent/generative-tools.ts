import { repos } from '$lib/db';
import type { ToolResult, Tool } from '$lib/agent/registry';
import { assembleContext } from '$lib/chat/context';
import { generateQuiz, QuizGenerationError } from '$lib/ai/generate/generate-quiz';
import { toQuizQuestions } from '$lib/ai/generate/quiz';
import { generateLab, LabGenerationError } from '$lib/ai/generate/generate';
import { toLabContent } from '$lib/ai/generate/lab';

function toolSchema(properties: Record<string, unknown>): Record<string, unknown> {
	return {
		type: 'object',
		properties,
		required: Object.keys(properties ?? {})
	};
}

export const generativeTools: Tool[] = [
	{
		def: {
			id: 'create_quiz',
			description:
				'Generate a mixed quiz (MCQ, flashcard, short-answer) from the chat context and persist it.',
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
			try {
				const ctx = await assembleContext(ctxArg.chatId);
				const generated = await generateQuiz(ctxArg.model, ctx, {
					signal: ctxArg.signal
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

				const firstQuestionTopic = items.length > 0 ? items[0].prompt.slice(0, 60) : 'Quiz';
				return {
					ok: true,
					summary: `Created quiz "${firstQuestionTopic}" (${items.length} questions)`,
					detail: { artifact: { kind: 'quiz', id: quiz.id } }
				};
			} catch (err) {
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
				'Generate a hands-on lab with steps and a checklist from the chat context and persist it.',
			parameters: toolSchema({
				topic: { type: 'string', description: 'Optional topic hint for the lab.' }
			}),
			risk: 'high',
			generative: true
		},
		async run(args, ctxArg): Promise<ToolResult> {
			try {
				const ctx = await assembleContext(ctxArg.chatId);
				const generated = await generateLab(ctxArg.model, ctx, {
					signal: ctxArg.signal
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
				return {
					ok: true,
					summary: `Created lab "${title}"`,
					detail: { artifact: { kind: 'lab', id: lab.id } }
				};
			} catch (err) {
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
