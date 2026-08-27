/**
 * Starter chip — the home screen's "begin" invitation (feature 012 US4).
 *
 * Owner ruling (2026-08-27): Home shows ONLY the "Explore a new topic" chip;
 * the quiz/study-session seeds and brief-derived seeds were removed because
 * they duplicate affordances that already exist elsewhere (quiz/lab launchers,
 * continue-learning card) and cluttered the invitation row.
 *
 * Pure, DOM-free module. The chip sends its `prompt` as the visible first
 * message of a freshly created chat — never a silent write.
 */

export interface Starter {
	/** Stable slug used as the keyed-each id. */
	id: string;
	/** Short chip text. */
	label: string;
	/** Full first-message text sent when the chip is activated. */
	prompt: string;
}

export const EXPLORE_STARTER: Starter = {
	id: 'explore',
	label: 'Explore a new topic',
	prompt:
		"Help me explore a new topic today. Ask me what I'm curious about, then give me an overview suited to my level."
};

/**
 * The home screen's starter set: exactly the explore seed, always. Kept as a
 * function so callers and tests retain a stable seam if seeding ever needs
 * context again.
 */
export function deriveStarters(): Starter[] {
	return [EXPLORE_STARTER];
}
