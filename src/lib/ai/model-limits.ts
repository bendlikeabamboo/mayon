const LIMITS: [string, number][] = [
	['glm-5.2', 128000],
	['glm-5.1', 128000],
	['glm-4', 128000],
	['gpt-4o', 128000],
	['gpt-4', 128000],
	['gpt-3.5', 16384],
	['claude-3-5-sonnet', 200000],
	['claude-3-opus', 200000],
	['claude-3-sonnet', 200000],
	['claude-3-haiku', 200000],
	['gemini-1.5-pro', 1000000],
	['gemini-1.5-flash', 1000000],
	['gemini-2.0', 1000000],
	['gemini-2.5', 1000000]
];

export function estimateContextLimit(modelId: string | undefined): number | null {
	if (!modelId) return null;
	const normalized = modelId
		.replace(/\[.*?\]/g, '')
		.trim()
		.toLowerCase();
	for (const [prefix, limit] of LIMITS) {
		if (normalized.startsWith(prefix)) return limit;
	}
	return null;
}
