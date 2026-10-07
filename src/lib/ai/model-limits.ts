const LIMITS: [string, number][] = [
	['glm-5.3', 1000000],
	['glm-5.2', 1000000],
	['glm-5.1', 200000],
	['glm-5', 200000],
	['glm-4.7', 200000],
	['glm-4.6', 200000],
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
	['gemini-2.5', 1000000],
	['deepseek-chat', 128000],
	['deepseek-reasoner', 128000],
	['grok-4.6', 500000],
	['mistral-large-latest', 256000],
	['claude-sonnet-4', 1000000],
	['claude-sonnet-5', 1000000],
	['mistral-large-4', 524288],
	['claude-haiku-4', 200000],
	['claude-fable-5', 1000000],
	['claude-opus-5', 1000000],
	['muse-spark-1', 1048576],
	['grok-build-0', 256000],
	['qwen3.6-plus', 1000000],
	['deepseek-v4', 1048576],
	['gemini-3', 1048576],
	['kimi-k3', 1048576],
	['ling-3', 262144],
	['gpt-6', 1050000]
];

export function estimateContextLimit(modelId: string | undefined): number | null {
	if (!modelId) return null;
	const normalized =
		modelId
			.split('/')
			.pop()
			?.replace(/\[.*?\]/g, '')
			.trim()
			.toLowerCase() ?? '';
	for (const [prefix, limit] of LIMITS) {
		if (normalized.startsWith(prefix)) return limit;
	}
	return null;
}
