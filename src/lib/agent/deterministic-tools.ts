import { repos } from '$lib/db';
import type { ToolResult, Tool } from '$lib/agent/registry';
import { parseBrief, summarizeBrief, strategyForBrief } from '$lib/chat/brief';
import type { LearningBrief } from '$lib/chat/brief';

function toolSchema(properties: Record<string, unknown>): Record<string, unknown> {
	return {
		type: 'object',
		properties,
		required: Object.keys(properties ?? {})
	};
}

export const deterministicTools: Tool[] = [
	{
		def: {
			id: 'branch_chat',
			description:
				'Branch a child chat off the current chat at the last message. Do not reproduce artifact content from the branch target in the source chat.',
			parameters: toolSchema({
				topic: { type: 'string', description: 'Optional title for the new branch.' }
			}),
			risk: 'high',
			generative: false
		},
		async run(args, ctx): Promise<ToolResult> {
			const { topic } = args as { topic?: string };
			const msgs = await repos.messages.listByChat(ctx.chatId);
			if (msgs.length === 0) return { ok: false, summary: 'no messages in chat' };
			let idx = msgs.length - 1;
			while (idx >= 0 && msgs[idx].role === 'assistant' && msgs[idx].toolCallId) {
				idx--;
			}
			if (idx < 0) return { ok: false, summary: 'no suitable branch point' };
			const last = msgs[idx];
			const child = await repos.chats.createChild({
				parentId: ctx.chatId,
				branchPointMessageId: last.id,
				title: topic?.trim() || 'Deeper dive'
			});
			return {
				ok: true,
				summary: `Branched "${child.title}"`,
				detail: { artifact: { kind: 'chat', id: child.id } }
			};
		}
	},
	{
		def: {
			id: 'save_brief',
			description: 'Save or update the learning brief on the root chat.',
			parameters: toolSchema({
				goal: { type: 'string', description: 'Learning goal (required).' },
				context: { type: 'string', description: 'Learner context / role.' },
				level: {
					type: 'string',
					description: 'Prior knowledge level (novice|some|regular|practitioner).'
				},
				mode: { type: 'string', description: 'Teaching mode (socratic|explainer|build).' },
				scope: { type: 'string', description: 'Depth / time budget.' }
			}),
			risk: 'high',
			generative: false
		},
		async run(args, ctx): Promise<ToolResult> {
			const a = args as {
				goal?: string;
				context?: string;
				level?: string;
				mode?: string;
				scope?: string;
			};
			if (!a.goal?.trim()) return { ok: false, summary: 'missing goal' };

			const rootChat = await repos.chats.getById(ctx.rootChatId);
			const existing = rootChat?.brief ? parseBrief(rootChat.brief) : null;

			const merged: LearningBrief = {
				goal: a.goal.trim(),
				context: a.context?.trim() || existing?.context,
				level: (a.level as LearningBrief['level']) || existing?.level || 'some',
				mode: (a.mode as LearningBrief['mode']) || existing?.mode || 'socratic',
				scope: a.scope?.trim() || existing?.scope,
				scopeStrategy: existing?.scopeStrategy,
				persona: existing?.persona
			};

			await repos.chats.updateBrief(ctx.rootChatId, merged);
			return { ok: true, summary: summarizeBrief(merged), detail: { brief: merged } };
		}
	},
	{
		def: {
			id: 'draft_lab_skeleton',
			description: 'Generate a deterministic lab skeleton markdown scaffold (no LLM call).',
			parameters: toolSchema({
				topic: { type: 'string', description: 'Lab topic (optional, seeds the scaffold).' }
			}),
			risk: 'low',
			generative: false
		},
		async run(args, ctx): Promise<ToolResult> {
			const { topic } = args as { topic?: string };

			const rootChat = await repos.chats.getById(ctx.rootChatId);
			const brief = rootChat?.brief ? parseBrief(rootChat.brief) : null;
			const strat = strategyForBrief(brief ?? {});
			const stepCount = strat.gated ? 5 : 4;

			const title = topic?.trim() || brief?.goal || 'Lab';
			const lines: string[] = [];
			lines.push(`# Lab: ${title}\n`);
			lines.push('## Objective\n');
			lines.push(brief?.goal ? `${brief.goal}\n` : '(describe the objective)\n');
			lines.push('## Prerequisites\n');
			lines.push('- (list prerequisites)\n');
			lines.push('## Setup\n');
			lines.push('(setup instructions)\n');
			for (let i = 1; i <= stepCount; i++) {
				lines.push(`## Step ${i}\n`);
				lines.push('(instructions)\n');
			}
			lines.push('## Checkpoint\n');
			lines.push('(verify completion)\n');
			lines.push('## Reflection\n');
			lines.push('(self-assessment questions)\n');

			const markdown = lines.join('\n');
			return {
				ok: true,
				summary: `Drafted a lab skeleton (${stepCount + 4} sections)`,
				detail: { markdown }
			};
		}
	},
	{
		def: {
			id: 'draft_quiz_outline',
			description: 'Generate a deterministic quiz outline (no LLM call).',
			parameters: toolSchema({
				topic: { type: 'string', description: 'Quiz topic (optional).' },
				questionCount: { type: 'number', description: 'Number of questions (default 5).' }
			}),
			risk: 'low',
			generative: false
		},
		async run(args, _ctx): Promise<ToolResult> {
			const { topic, questionCount } = args as { topic?: string; questionCount?: number };
			const count = typeof questionCount === 'number' ? Math.max(1, Math.round(questionCount)) : 5;
			const title = topic?.trim() || 'Quiz';

			const types = ['multiple-choice', 'short-answer'];
			const lines: string[] = [];
			lines.push(`# Quiz: ${title}\n`);
			lines.push(`${count} questions\n`);
			for (let i = 1; i <= count; i++) {
				const kind = types[(i - 1) % types.length];
				lines.push(`## Q${i} (${kind})\n`);
				lines.push('(question text)\n');
				if (kind === 'multiple-choice') {
					lines.push('- A. (option)\n  - B. (option)\n  - C. (option)\n  - D. (option)\n');
				}
				lines.push(`**Answer:** (answer)\n`);
			}

			const markdown = lines.join('\n');
			return {
				ok: true,
				summary: `Drafted a quiz outline (${count} questions)`,
				detail: { markdown }
			};
		}
	},
	{
		def: {
			id: 'toggle_checklist_item',
			description: 'Toggle a checklist item between checked and unchecked.',
			parameters: toolSchema({
				labId: { type: 'string', description: 'The lab ID.' },
				itemId: { type: 'string', description: 'The checklist item ID.' }
			}),
			risk: 'low',
			generative: false
		},
		async run(args, _ctx): Promise<ToolResult> {
			const { labId, itemId } = args as { labId?: string; itemId?: string };
			if (!labId || !itemId) return { ok: false, summary: 'missing labId or itemId' };

			const next = await repos.labs.toggleChecklistItem(labId, itemId);
			if (!next) return { ok: false, summary: 'lab/item not found' };

			const toggled = next.find((i) => i.id === itemId);
			const state = toggled?.done ? 'checked' : 'unchecked';
			return {
				ok: true,
				summary: `${toggled?.text ?? itemId}: ${state}`,
				detail: { checklist: next }
			};
		}
	},
	{
		def: {
			id: 'present_choices',
			description:
				'Present pacing choices to the learner as tappable chips (e.g. after a unit or step). ' +
				'Call this instead of emitting the choices as a fenced block or raw JSON. ' +
				'The options appear as reply chips under the composer.',
			parameters: toolSchema({
				nextUnit: { type: 'string', description: 'Title of the next unit or step.' },
				options: {
					type: 'array',
					items: { type: 'string' },
					description: '2–3 short option labels (e.g. ["continue","go deeper"]).'
				},
				progress: {
					type: 'string',
					description: 'A short progress label (e.g. "Unit 2 / 5" or "Step 3 / 8").'
				}
			}),
			risk: 'readonly',
			generative: false,
			terminal: true
		},
		async run(args, _ctx): Promise<ToolResult> {
			const a = args as { nextUnit?: string; options?: string[]; progress?: string };
			const opts = (a.options ?? []).join(', ');
			return {
				ok: true,
				summary: `Next: ${a.nextUnit ?? '—'} (${opts})`,
				detail: { nextUnit: a.nextUnit, options: a.options, progress: a.progress }
			};
		}
	}
];
