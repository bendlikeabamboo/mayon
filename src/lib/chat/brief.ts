/**
 * Learning Brief — goal-calibrated tutoring intake (learning-brief-epic plan).
 *
 * Pure, DOM-free module (mirrors `expound.ts`): owns the brief data shape, the
 * option/label tables, a total (never-throwing) JSON parser, the system-note
 * builder consumed by `assembleContext`, and the one-line summary used by the
 * collapsed card chip.
 *
 * The brief is authored on the **root** chat only and stored as a JSON string
 * in `chats.brief`; every branch inherits it via the root→target walk in
 * `assembleContext` (no re-intake, no per-branch storage).
 */
import type { ChatMessage } from '$lib/ai/types';
import {
	type ScopeStrategyId,
	isScopeStrategyId,
	resolveStrategy,
	strategyForBrief
} from './strategies';

export type { ScopeStrategy, ScopeStrategyId } from './strategies';
export {
	SCOPE_STRATEGIES,
	strategiesForMode,
	defaultStrategyFor,
	resolveStrategy,
	strategyForBrief
} from './strategies';

// ─────────────────────────── types ────────────────────────────

/** Prior knowledge — the biggest tutor lever (Ausubel / ZPD). */
export type BriefLevel = 'novice' | 'some' | 'regular' | 'practitioner';

/** How the tutor should teach: questioning, direct explanation, or build-together. */
export type BriefMode = 'socratic' | 'explainer' | 'build';

/**
 * A small structured intake capturing *what the learner wants to be able to do,
 * at what level, in what context, taught how, over what scope*. `goal` is the
 * only required field; the rest are optional with sensible defaults.
 */
export interface LearningBrief {
	/** REQUIRED — a doable verb ("be able to … / decide …"), not a noun. */
	goal: string;
	/** Role / situation ("engineer with a real bug", "student cramming"). */
	context?: string;
	/** Prior knowledge. Defaults to {@link DEFAULT_LEVEL}. */
	level?: BriefLevel;
	/** Teaching style. Defaults to {@link DEFAULT_MODE}. */
	mode?: BriefMode;
	/** Depth / time budget ("orient me in 10 min", "mastery over days"). */
	scope?: string;
	/** Teaching structure. Defaults to {@link defaultStrategyFor} for the mode. */
	scopeStrategy?: ScopeStrategyId;
}

// ─────────────────────────── consts ───────────────────────────

export const LEVEL_OPTIONS: BriefLevel[] = ['novice', 'some', 'regular', 'practitioner'];

export const MODE_OPTIONS: BriefMode[] = ['socratic', 'explainer', 'build'];

export const LEVEL_LABELS: Record<BriefLevel, string> = {
	novice: 'Novice — brand new to this',
	some: 'Some exposure',
	regular: 'Regular practice',
	practitioner: 'Practitioner — I know my way around'
};

export const MODE_LABELS: Record<BriefMode, string> = {
	socratic: 'Socratic — question me, use active recall',
	explainer: 'Explainer — teach me directly',
	build: 'Build together — work side-by-side'
};

export const DEFAULT_LEVEL: BriefLevel = 'some';
export const DEFAULT_MODE: BriefMode = 'socratic';

/** Topic-agnostic defaults reused across chats; snapshotted into a brief at intake. */
export interface LearnerProfile {
	context?: string;
	level?: BriefLevel;
	mode?: BriefMode;
	scopeStrategy?: ScopeStrategyId;
}

export const DEFAULT_PROFILE: LearnerProfile = { level: 'some', mode: 'socratic' };

/**
 * Resolved brief fields after applying a profile. `level`/`mode` are always
 * present (precedence: brief > profile > defaults); `goal`/`scope`/`context`
 * pass through from `brief` unchanged.
 */
export interface ResolvedBriefFields {
	goal?: string;
	context?: string;
	level: BriefLevel;
	mode: BriefMode;
	scope?: string;
	scopeStrategy: ScopeStrategyId;
}

/**
 * Fill `context`/`level`/`mode` from `profile` where `brief` omits them, then
 * fill any still-missing level/mode with the defaults. Explicit `brief` fields
 * ALWAYS win; the profile only fills gaps; defaults fill the rest. `goal` and
 * `scope` are passed through untouched (not profile fields).
 */
export function applyProfile(
	profile: LearnerProfile,
	brief: Partial<LearningBrief>
): ResolvedBriefFields {
	const level = brief.level ?? profile.level ?? DEFAULT_LEVEL;
	const mode = brief.mode ?? profile.mode ?? DEFAULT_MODE;
	return {
		goal: brief.goal,
		context: brief.context ?? profile.context,
		level,
		mode,
		scope: brief.scope,
		scopeStrategy: resolveStrategy({ ...brief, mode }, profile).id
	};
}

/** Max length of the goal fragment shown in the collapsed summary chip. */
const SUMMARY_GOAL_MAX = 60;

// ─────────────────────────── parsing ──────────────────────────

function isBriefLevel(v: unknown): v is BriefLevel {
	return v === 'novice' || v === 'some' || v === 'regular' || v === 'practitioner';
}

function isBriefMode(v: unknown): v is BriefMode {
	return v === 'socratic' || v === 'explainer' || v === 'build';
}

/**
 * Total (never-throwing) JSON parser for a stored brief. Bad/empty input →
 * `null`. A brief without a non-empty `goal` is rejected (`null`), since goal
 * is the one required field — this keeps a corrupted/partial value from
 * reaching `assembleContext`. Unknown extra keys are ignored.
 */
export function parseBrief(raw: string | null | undefined): LearningBrief | null {
	if (raw == null || raw.trim().length === 0) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null) return null;
	const obj = parsed as Record<string, unknown>;

	const goal = typeof obj.goal === 'string' ? obj.goal.trim() : '';
	if (goal.length === 0) return null;

	const brief: LearningBrief = { goal };
	if (typeof obj.context === 'string' && obj.context.trim().length > 0) {
		brief.context = obj.context;
	}
	if (typeof obj.scope === 'string' && obj.scope.trim().length > 0) {
		brief.scope = obj.scope;
	}
	if (isBriefLevel(obj.level)) brief.level = obj.level;
	if (isBriefMode(obj.mode)) brief.mode = obj.mode;
	if (isScopeStrategyId(obj.scopeStrategy)) brief.scopeStrategy = obj.scopeStrategy;
	return brief;
}

// ─────────────────────── system-note builder ──────────────────

/**
 * Render the brief as a leading `system` {@link ChatMessage} that calibrates
 * the tutor. Omitted optional fields are substituted with their defaults (or a
 * "(not given)"/"(open)" placeholder) so the note always reads well. This is
 * the single prompt that reaches chat, labs, quizzes, and grading via
 * `assembleContext` — tuning it reaches all four flows.
 */
export function buildBriefSystemNote(brief: LearningBrief): ChatMessage {
	const level = brief.level ?? DEFAULT_LEVEL;
	const mode = brief.mode ?? DEFAULT_MODE;
	const context =
		brief.context && brief.context.trim().length > 0 ? brief.context.trim() : '(not given)';
	const scope = brief.scope && brief.scope.trim().length > 0 ? brief.scope.trim() : '(open)';

	const strat = strategyForBrief(brief);

	const lines: string[] = [
		"You are a personal learning tutor. Calibrate to this learner's brief:",
		`- Goal: ${brief.goal}`,
		`- Level: ${level}  · Context: ${context}  · Mode: ${mode}  · Scope: ${scope}`,
		`- Structure: ${strat.label}  (unless scope overrides the budget)`
	];

	if (brief.scope && brief.scope.trim().length > 0) {
		lines.push(
			`The learner set this budget: ${brief.scope.trim()}. Honor it when it tightens density or unit count below the structure's defaults.`
		);
	}

	lines.push(
		'',
		strat.block,
		'',
		'Teach to the goal at the stated level; stay within scope.',
		'When the learner can do the goal, say so.'
	);

	return { role: 'system', content: lines.join('\n') };
}

// ─────────────── capabilities preamble (AG3) ──────────────────

/**
 * Standalone system note appended whenever tools are live. Covers brief-less
 * "Just start chatting" chats too. Pure string; the loop joins it into `system`.
 */
export function buildCapabilitiesPreamble(): string {
	return [
		"You have access to tools that let you inspect the learner's context (checklist progress, artifacts, summaries).",
		'Use them when they clearly help the lesson — e.g. to check where the learner is before giving feedback.',
		'Prefer continuing the lesson over invoking tools. Use them judiciously, not every turn.',
		"You can also act on the learner's behalf: branch a deeper dive, adjust the learning brief, draft a lab or quiz skeleton, toggle a checklist step.",
		"Actions that create or change artifacts require the learner's approval — you will be asked and should wait.",
		'Do not re-request an action the learner has declined. Respect their choice and continue the lesson.',
		'When it would help the learner solidify the material, you may offer to create a quiz or lab from the current unit — but always ask before creating anything, and create at most one artifact per turn.'
	].join('\n');
}

// ─────────────────────────── summary ──────────────────────────

/**
 * One-line chip text for the collapsed brief card, e.g.
 * `"Goal: build a Makefile · level: some · socratic"`. The goal is truncated so
 * the chip stays compact; field order is stable.
 */
export function summarizeBrief(brief: LearningBrief): string {
	const goal =
		brief.goal.length > SUMMARY_GOAL_MAX
			? brief.goal.slice(0, SUMMARY_GOAL_MAX - 1).trimEnd() + '…'
			: brief.goal;
	return [
		`Goal: ${goal}`,
		`level: ${brief.level ?? DEFAULT_LEVEL}`,
		brief.mode ?? DEFAULT_MODE
	].join(' · ');
}
