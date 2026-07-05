type Args = Record<string, unknown>;
const FORMATTERS: Record<string, (a: Args) => string> = {
	create_quiz: (a) => `Create a quiz on: ${a.topic ?? 'this chat'}`,
	create_lab: (a) => `Create a lab on: ${a.topic ?? 'this chat'}`,
	branch_chat: (a) =>
		a.topic ? `Branch this conversation (${a.topic})` : 'Branch this conversation',
	save_brief: (a) => `Set learning goal: ${a.goal ?? '(unspecified)'}`,
	draft_lab_skeleton: (a) => `Draft a lab outline: ${a.topic ?? 'this chat'}`,
	draft_quiz_outline: (a) => `Draft a quiz outline: ${a.topic ?? 'this chat'}`,
	toggle_checklist_item: () => 'Toggle a checklist step',
	read_checklist: () => 'Read the lab checklist',
	list_artifacts: () => 'List labs and quizzes',
	read_artifact: (a) => `Read a ${a.kind ?? 'artifact'}`,
	summarize_progress: () => 'Summarize progress'
};

export function summarizeToolCall(toolName: string, args: unknown): string | null {
	const fn = FORMATTERS[toolName];
	if (!fn) return null;
	try {
		return fn((args ?? {}) as Args);
	} catch {
		return null;
	}
}
