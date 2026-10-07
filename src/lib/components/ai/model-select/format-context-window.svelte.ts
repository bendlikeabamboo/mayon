export function formatContextWindow(tokens: number): string {
	if (tokens >= 1_000_000) {
		const m = Math.round(tokens / 100_000) / 10;
		return `${m % 1 === 0 ? m : m.toFixed(1)}M`;
	}
	if (tokens >= 1_000) {
		const k = Math.round(tokens / 100) / 10;
		return `${k % 1 === 0 ? k : k.toFixed(1)}K`;
	}
	return String(tokens);
}
