/**
 * Starter chips — the home screen's "begin" invitations (feature 012 US4).
 *
 * Pure, DOM-free module: `deriveStarters(context)` turns whatever curriculum
 * context the home page already has in hand (the latest root chat's parsed
 * learning brief, recent artifact titles) into 3–5 starter seeds. Chips send
 * their `prompt` as the visible first message of a freshly created chat —
 * they never perform silent writes.
 *
 * With no usable context (fresh instance), a small stable generic study-seed
 * set is returned, aligned with Mayon's artifact world (chat tree · quiz ·
 * lab). Deterministic ordering; dedupe by prompt text; never throws.
 */
import type { LearningBrief } from './brief';

export interface Starter {
	/** Stable slug used as the keyed-each id. */
	id: string;
	/** Short chip text. */
	label: string;
	/** Full first-message text sent when the chip is activated. */
	prompt: string;
}

/**
 * Curriculum hints derivable from what the home page has already fetched.
 * Every field optional; an absent/empty context yields the generic seed set.
 */
export interface StarterContext {
	/** Parsed brief of the most relevant root chat (via `parseBrief`). */
	brief?: LearningBrief | null;
	/** Titles of recent labs. */
	labTitles?: string[];
	/** Titles of recent chats. */
	chatTitles?: string[];
}

const GENERIC_SEEDS: Starter[] = [
	{
		id: 'explore',
		label: 'Explore a new topic',
		prompt:
			"Help me explore a new topic today. Ask me what I'm curious about, then give me an overview suited to my level."
	},
	{
		id: 'quiz-me',
		label: 'Quiz me',
		prompt:
			'Run a quick quiz session. Ask me which subject to test, then drill me one question at a time and score me at the end.'
	},
	{
		id: 'plan-session',
		label: 'Plan a study session',
		prompt:
			"Help me plan a study session. Ask what I'm working toward, then lay out a realistic plan with checkpoints."
	}
];

const GOAL_LABEL_MAX = 28;

function truncateLabel(text: string): string {
	const t = text.trim().replace(/\s+/g, ' ');
	return t.length > GOAL_LABEL_MAX ? t.slice(0, GOAL_LABEL_MAX - 1).trimEnd() + '…' : t;
}

/**
 * Curriculum-derived seeds from a parsed brief's goal. Seed ORDER is flavored
 * by the brief's teaching mode: socratic leads with recall (quiz), build leads
 * with hands-on practice — deterministic either way.
 */
function goalSeeds(brief: LearningBrief): Starter[] {
	const goal = brief.goal;
	const deepen: Starter = {
		id: 'deepen-goal',
		label: `Continue: ${truncateLabel(goal)}`,
		prompt: `My learning goal is "${goal}". Pick the trickiest part and help me work through it step by step.`
	};
	const quiz: Starter = {
		id: 'quiz-goal',
		label: 'Quiz me on it',
		prompt: `Quiz me on what I know toward my learning goal, "${goal}". One question at a time, then tell me how I did.`
	};
	const practice: Starter = {
		id: 'practice-goal',
		label: 'Turn it into practice',
		prompt: `Design a hands-on exercise that practices "${goal}", with a short checklist I can tick off like a lab.`
	};

	const ordered =
		brief.mode === 'socratic'
			? [quiz, deepen, practice]
			: brief.mode === 'build'
				? [practice, deepen, quiz]
				: [deepen, practice, quiz];
	return ordered;
}

/** True when the context object carries any usable curriculum signal at all. */
function hasContext(context: StarterContext): boolean {
	return Boolean(
		context.brief ||
		(context.chatTitles?.some((t) => t.trim().length > 0) ?? false) ||
		(context.labTitles?.some((t) => t.trim().length > 0) ?? false)
	);
}

/**
 * Derive 3–5 starter seeds from available curriculum context, falling back to
 * the generic study-seed set. Curriculum-derived seeds come FIRST when present;
 * generic seeds pad to the cap so every result stays within `[3, 5]`. Deduped
 * by prompt text; same input → same output, always.
 */
export function deriveStarters(context?: StarterContext | null): Starter[] {
	const ctx = context && hasContext(context) ? context : null;
	if (!ctx || !ctx.brief) return [...GENERIC_SEEDS];

	const derived = goalSeeds(ctx.brief);
	const seenPrompts = new Set<string>();
	const merged: Starter[] = [];
	for (const seed of [...derived, ...GENERIC_SEEDS]) {
		if (seenPrompts.has(seed.prompt)) continue;
		seenPrompts.add(seed.prompt);
		merged.push(seed);
		if (merged.length >= 5) break;
	}
	return merged;
}
