/**
 * Split assembled chat context for a `generateObject`/`generateText` call.
 *
 * The generation orchestrators are tool-less; they must hand the SDK a clean
 * transcript. See `generate.ts` / `generate-quiz.ts` / `generate-brief.ts` /
 * `generate-title.ts`.
 */
import type { ChatMessage } from '../types';

/** A plain user/assistant turn, in the simple shape the SDK `messages` accepts. */
export interface GenerationTurn {
	readonly role: 'user' | 'assistant';
	readonly content: string;
}

export interface SplitContext {
	/** Routed into the SDK `system` option: any `system` notes, then `prompt`. */
	readonly system: string;
	/** `user`/`assistant` turns only — never `system`. */
	readonly messages: GenerationTurn[];
}

/**
 * Route `system`-role notes into the `system` option and keep only `user`/
 * `assistant` turns in `messages`.
 *
 * `assembleContext` leads with `system`-role notes (the learning brief, and a
 * branch excerpt for forks). Several providers — notably Z.AI/GLM — reject any
 * `system` entry in the `messages` field with
 * "System messages are not allowed in the prompt or messages fields. Use the
 * instructions option instead." So those notes are joined (brief first) and
 * prefixed to the task `prompt`, preserving the learner framing without sending
 * a `system` message in the transcript. Mirrors the agent loop
 * (`agent/loop.ts`), which does the same split via `toCoreMessages` + `system`.
 */
export function splitContextForGeneration(
	messages: ChatMessage[],
	prompt: string,
	opts?: { includeSystemNotes?: boolean }
): SplitContext {
	const includeSystemNotes = opts?.includeSystemNotes !== false;
	const systemNotes = includeSystemNotes
		? messages.filter((m) => m.role === 'system').map((m) => m.content)
		: [];
	const system = [...systemNotes, prompt].join('\n\n');
	const turns: GenerationTurn[] = messages
		.filter((m) => m.role === 'user' || m.role === 'assistant')
		.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
	return { system, messages: turns };
}
