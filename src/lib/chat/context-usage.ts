import { estimateContextLimit } from '$lib/ai/model-limits';

export type ContextUsageTriple = {
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
	modelId: string;
};

export type ContextGaugeCandidate = {
	id: string;
	kind: string;
	ord: number;
	tokens: number | null;
	usage: ContextUsageTriple | null;
};

export type ContextGauge = {
	usedTokens: number;
	provenance: 'reported' | 'estimated';
	anchorMessageId: string | null;
	anchorModelId: string | null;
	anchorUsage: ContextUsageTriple | null;
	limit: number | null;
	limitSource: 'provider-declared' | 'model-listing' | 'catalog' | 'unknown';
	remainingPct: number | null;
	state: 'normal' | 'low' | 'critical' | 'no-limit';
};

export const LOW_REMAINING = 0.25;
export const CRITICAL_REMAINING = 0.1;

function usedOf(candidate: ContextGaugeCandidate): number {
	const { usage, tokens } = candidate;
	if (usage) {
		if (usage.totalTokens != null) return usage.totalTokens;
		if (usage.promptTokens != null && usage.completionTokens != null)
			return usage.promptTokens + usage.completionTokens;
	}
	return tokens ?? 0;
}

function positiveInt(value: number | null | undefined): value is number {
	return Number.isInteger(value) && (value as number) > 0;
}

export function deriveContextGauge(input: {
	candidates: ContextGaugeCandidate[];
	assembledChars: number;
	activeModelId: string | null;
	declaredWindow: number | null;
	// Provider-listed context window for the active model; positive integer or null/absent.
	listedWindow?: number | null;
}): ContextGauge {
	const eligible = input.candidates.filter(
		(c) => c.kind === 'assistant_message' && (c.usage != null || c.tokens != null)
	);
	const anchor = eligible.length > 0 ? eligible.reduce((a, b) => (b.ord > a.ord ? b : a)) : null;

	let usedTokens: number;
	let provenance: 'reported' | 'estimated';
	let anchorMessageId: string | null = null;
	let anchorModelId: string | null = null;
	let anchorUsage: ContextUsageTriple | null = null;
	if (anchor) {
		usedTokens = usedOf(anchor);
		anchorMessageId = anchor.id;
		anchorModelId = anchor.usage?.modelId ?? null;
		anchorUsage = anchor.usage;
		const mismatched = anchor.usage != null && anchor.usage.modelId !== input.activeModelId;
		provenance = mismatched ? 'estimated' : 'reported';
	} else {
		usedTokens = Math.ceil(input.assembledChars / 4);
		provenance = 'estimated';
	}

	let limit: number | null = null;
	let limitSource: ContextGauge['limitSource'] = 'unknown';
	if (positiveInt(input.declaredWindow)) {
		limit = input.declaredWindow;
		limitSource = 'provider-declared';
	} else if (positiveInt(input.listedWindow)) {
		limit = input.listedWindow;
		limitSource = 'model-listing';
	} else {
		const catalog = estimateContextLimit(input.activeModelId ?? undefined);
		if (catalog != null) {
			limit = catalog;
			limitSource = 'catalog';
		}
	}

	const remainingPct = limit != null ? Math.min(1, Math.max(0, 1 - usedTokens / limit)) : null;

	let state: ContextGauge['state'];
	if (limit == null || remainingPct == null) state = 'no-limit';
	else if (remainingPct <= CRITICAL_REMAINING) state = 'critical';
	else if (remainingPct <= LOW_REMAINING) state = 'low';
	else state = 'normal';

	return {
		usedTokens,
		provenance,
		anchorMessageId,
		anchorModelId,
		anchorUsage,
		limit,
		limitSource,
		remainingPct,
		state
	};
}
