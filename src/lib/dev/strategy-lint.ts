import { SCOPE_STRATEGIES, type ScopeStrategyId } from '$lib/chat/strategies';
import { stripGateFence } from '$lib/ai/generate/generate-gate';

export interface LintCheck {
	name: string;
	ok: boolean;
	detail?: string;
}

export interface LintResult {
	pass: boolean;
	strategy: ScopeStrategyId;
	words: number;
	checks: LintCheck[];
}

interface DensityContract {
	skeletonParts: { name: string; pattern: RegExp }[];
	wordFloor?: number;
	calloutBudget?: number;
}

const CONTRACTS: Partial<Record<ScopeStrategyId, DensityContract>> = {
	'guided-curriculum': {
		skeletonParts: [
			{ name: 'advance organizer', pattern: /advance organizer|goal is|why it matters/i },
			{ name: 'table of contents', pattern: /(?:table of contents|unit \d)/i },
			{ name: 'concept', pattern: /(?:concept|define|in your own words)/i }
		],
		wordFloor: 250,
		calloutBudget: 3
	},
	'deep-dive': {
		skeletonParts: [
			{ name: 'concept', pattern: /(?:concept|core idea)/i },
			{ name: 'first example', pattern: /example|instance|worked/i },
			{ name: 'edge cases', pattern: /(?:edge case|gotcha|caveat|caution)/i },
			{ name: 'tie-back', pattern: /(?:goal|objective|outcome)/i }
		],
		wordFloor: 450,
		calloutBudget: 3
	},
	'quick-orientation': {
		skeletonParts: [
			{ name: 'advance organizer', pattern: /(?:organizer|goal is|overview)/i },
			{ name: 'unit list', pattern: /(?:unit \d)/i },
			{ name: 'example', pattern: /example|instance/i }
		],
		wordFloor: 120,
		calloutBudget: 2
	},
	'reference-manual': {
		skeletonParts: [{ name: 'structured format', pattern: /(?:table|list|param|field|option)/i }],
		calloutBudget: 5
	},
	'guided-inquiry': {
		skeletonParts: [
			{ name: 'anchor', pattern: /(?:here|last attempt|your last|where you are)/i },
			{
				name: 'framing',
				pattern: /(?:however|but the|consider|contrast|tension|analogy|paradox)/i
			},
			{ name: 'probe', pattern: /\?/ }
		],
		wordFloor: 120,
		calloutBudget: 3
	},
	'devils-advocate': {
		skeletonParts: [
			{
				name: 'counter',
				pattern: /(?:however|on the other hand|counter|opposing|against|weakness)/i
			},
			{ name: 'pressure', pattern: /\?/ }
		],
		wordFloor: 120,
		calloutBudget: 2
	},
	'case-based': {
		skeletonParts: [
			{ name: 'scenario', pattern: /(?:imagine|scenario|suppose|case|situation|example)/i },
			{ name: 'analysis', pattern: /(?:because|reason|approach|here's|the key)/i },
			{ name: 'transfer probe', pattern: /\?/ }
		],
		wordFloor: 120,
		calloutBudget: 2
	},
	workshop: {
		skeletonParts: [
			{ name: 'concept', pattern: /(?:we're adding|what we|concept|this step)/i },
			{ name: 'code block', pattern: /```/ },
			{ name: 'why', pattern: /(?:why|goal|this (?:is|gets us|connects)|so that)/i }
		],
		calloutBudget: 3
	},
	tutorial: {
		skeletonParts: [
			{ name: 'step header', pattern: /(?:step \d|Step \d)/i },
			{ name: 'action', pattern: /```/ },
			{ name: 'verify', pattern: /(?:verify|check|confirm|expected|test|should see)/i }
		],
		calloutBudget: 3
	},
	'pair-programming': {
		skeletonParts: [
			{ name: 'plan', pattern: /(?:we're going|next we|plan|about to)/i },
			{ name: 'implement', pattern: /```/ },
			{ name: 'review', pattern: /(?:review|this (?:code|does|works)|why|tradeoff|decision)/i }
		],
		calloutBudget: 3
	}
};

export function lintTurn(strategyId: ScopeStrategyId, raw: string): LintResult {
	const entry = SCOPE_STRATEGIES.find((s) => s.id === strategyId);
	if (!entry) {
		return { pass: true, strategy: strategyId, words: 0, checks: [] };
	}

	const stripped = stripGateFence(raw);
	const words = stripped.split(/\s+/).filter((w) => w.length > 0).length;
	const contract = CONTRACTS[strategyId];
	const checks: LintCheck[] = [];

	if (contract) {
		for (const part of contract.skeletonParts) {
			const ok = part.pattern.test(stripped);
			checks.push({ name: part.name, ok });
		}

		if (contract.wordFloor !== undefined) {
			checks.push({
				name: `word floor (${contract.wordFloor})`,
				ok: words >= contract.wordFloor,
				detail: `${words} words`
			});
		}

		if (contract.calloutBudget !== undefined) {
			const calloutCount = (stripped.match(/> \[![A-Z][A-Z-]*\]/g) ?? []).length;
			checks.push({
				name: `callout budget (≤${contract.calloutBudget})`,
				ok: calloutCount <= contract.calloutBudget,
				detail: `${calloutCount} callouts`
			});
		}
	}

	const pass = checks.length === 0 || checks.every((c) => c.ok);
	return { pass, strategy: strategyId, words, checks };
}
