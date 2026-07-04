import type { LanguageModel } from 'ai';
import type { ProviderConfig } from '$lib/ai/types';
import { repos } from '$lib/db';

// ── Types (design §4.1) ──────────────────────────────────────────

export type ToolRisk = 'readonly' | 'low' | 'high';

export interface ToolDefinition {
	id: string;
	description: string;
	parameters: Record<string, unknown>;
	risk: ToolRisk;
	generative: boolean;
}

export interface ToolResult {
	ok: boolean;
	summary: string;
	detail?: unknown;
	artifact?: unknown;
}

export interface ToolContext {
	chatId: string;
	rootChatId: string;
	signal?: AbortSignal;
	budget: { subCalls: number; maxSubCalls: number };
	model: LanguageModel;
	config: ProviderConfig;
}

export interface Tool {
	def: ToolDefinition;
	run(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}

// ── TOOLS map + dispatcher ────────────────────────────────────────

const TOOLS = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
	TOOLS.set(tool.def.id, tool);
}

export function getToolDefinitions(): ToolDefinition[] {
	return [...TOOLS.values()].map((t) => t.def);
}

export function getToolDefinition(id: string): ToolDefinition | undefined {
	return TOOLS.get(id)?.def;
}

export async function toolsRun(id: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
	const tool = TOOLS.get(id);
	if (!tool) {
		return { ok: false, summary: `unknown tool: ${id}` };
	}
	try {
		return await tool.run(args, ctx);
	} catch (err) {
		return {
			ok: false,
			summary: `tool ${id} error: ${err instanceof Error ? err.message : String(err)}`
		};
	}
}

// ── Readonly inspection tools ───────────────────────────────────

function toolSchema(properties: Record<string, unknown>): Record<string, unknown> {
	return {
		type: 'object',
		properties,
		required: Object.keys(properties ?? {})
	};
}

registerTool({
	def: {
		id: 'read_checklist',
		description: 'Read the checklist for a lab, returning completion status.',
		parameters: toolSchema({
			labId: { type: 'string', description: 'The lab ID to read the checklist for.' }
		}),
		risk: 'readonly',
		generative: false
	},
	async run(args, _ctx): Promise<ToolResult> {
		const { labId } = args as { labId?: string };
		if (!labId) return { ok: false, summary: 'missing labId' };

		const lab = await repos.labs.getById(labId);
		if (!lab) return { ok: false, summary: `lab ${labId} not found` };

		const items = repos.labs.parseChecklist(lab.checklist);
		const done = items.filter((i) => i.done).length;
		return {
			ok: true,
			summary: `${done}/${items.length} steps done`,
			detail: items
		};
	}
});

registerTool({
	def: {
		id: 'list_artifacts',
		description: 'List all labs and quizzes associated with the current chat.',
		parameters: toolSchema({}),
		risk: 'readonly',
		generative: false
	},
	async run(_args, ctx): Promise<ToolResult> {
		const chatId = ctx.chatId;

		const [labsList, quizzesList] = await Promise.all([
			repos.labs.listByChat(chatId),
			repos.quizzes.listByChat(chatId)
		]);

		const labItems = labsList.map((l) => ({ id: l.id, kind: 'lab' as const, title: l.title }));
		const quizItems = quizzesList.map((q) => ({
			id: q.id,
			kind: 'quiz' as const,
			title: `Quiz (${q.id.slice(0, 8)}…)`
		}));

		return {
			ok: true,
			summary: `${labsList.length} lab${labsList.length === 1 ? '' : 's'}, ${quizzesList.length} quiz${quizzesList.length === 1 ? '' : 'zes'}`,
			detail: [...labItems, ...quizItems]
		};
	}
});

registerTool({
	def: {
		id: 'read_artifact',
		description: 'Read the full content of a lab or quiz by its ID and kind.',
		parameters: toolSchema({
			kind: { type: 'string', enum: ['lab', 'quiz'], description: 'The artifact kind.' },
			id: { type: 'string', description: 'The artifact ID.' }
		}),
		risk: 'readonly',
		generative: false
	},
	async run(args, _ctx): Promise<ToolResult> {
		const { kind, id } = args as { kind?: string; id?: string };
		if (!kind || !id) return { ok: false, summary: 'missing kind or id' };

		if (kind === 'lab') {
			const lab = await repos.labs.getById(id);
			if (!lab) return { ok: false, summary: `lab ${id} not found` };
			const items = repos.labs.parseChecklist(lab.checklist);
			return {
				ok: true,
				summary: `Lab: ${lab.title}`,
				detail: { ...lab, checklist: items }
			};
		}

		if (kind === 'quiz') {
			const quiz = await repos.quizzes.getById(id);
			if (!quiz) return { ok: false, summary: `quiz ${id} not found` };
			const questions = await repos.quizQuestions.listByQuiz(id);
			return {
				ok: true,
				summary: `Quiz: ${questions.length} questions`,
				detail: {
					...quiz,
					questions: questions.map((q) => ({
						...q,
						payload: repos.quizQuestions.parsePayload(q.payload)
					}))
				}
			};
		}

		return { ok: false, summary: `unknown artifact kind: ${kind}` };
	}
});

registerTool({
	def: {
		id: 'summarize_progress',
		description:
			'Summarize progress across all labs and quizzes for the current chat (no LLM call).',
		parameters: toolSchema({}),
		risk: 'readonly',
		generative: false
	},
	async run(_args, ctx): Promise<ToolResult> {
		const chatId = ctx.chatId;

		const [labsList, quizzesList] = await Promise.all([
			repos.labs.listByChat(chatId),
			repos.quizzes.listByChat(chatId)
		]);

		let totalDone = 0;
		let totalSteps = 0;
		const labSummaries: Array<{ id: string; title: string; done: number; total: number }> = [];

		for (const lab of labsList) {
			const items = repos.labs.parseChecklist(lab.checklist);
			const done = items.filter((i) => i.done).length;
			totalDone += done;
			totalSteps += items.length;
			labSummaries.push({ id: lab.id, title: lab.title, done, total: items.length });
		}

		const parts: string[] = [];
		parts.push(
			`${labsList.length} lab${labsList.length === 1 ? '' : 's'}, ${quizzesList.length} quiz${quizzesList.length === 1 ? '' : 'zes'}`
		);
		if (totalSteps > 0) parts.push(`${totalDone}/${totalSteps} checklist steps complete`);
		for (const ls of labSummaries) {
			parts.push(`  Lab "${ls.title}": ${ls.done}/${ls.total}`);
		}

		return {
			ok: true,
			summary: parts.join('; '),
			detail: { labs: labSummaries, quizCount: quizzesList.length }
		};
	}
});

import { deterministicTools } from './deterministic-tools';
import { generativeTools } from './generative-tools';

for (const t of deterministicTools) registerTool(t);
for (const t of generativeTools) registerTool(t);
