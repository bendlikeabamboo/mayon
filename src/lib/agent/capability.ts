import type { ProviderConfig } from '$lib/ai/types';

const KNOWN_GATEWAY_BASEURLS: ReadonlySet<string> = new Set([
	'https://api.z.ai/api/coding/paas/v4',
	'https://api.kilo.ai/api/gateway',
	'https://openrouter.ai/api/v1',
	'https://api.openai.com/v1'
]);

let sessionToolsDisabled = false;

export function disableToolsForSession(): void {
	sessionToolsDisabled = true;
}

export function isSessionDisabled(): boolean {
	return sessionToolsDisabled;
}

export function resolveToolCapability(config: ProviderConfig): boolean {
	if (config.toolCapability === 'on') return true;
	if (config.toolCapability === 'off') return false;

	const autoDefault = defaultForKind(config.kind, config.baseUrl);
	return autoDefault && !sessionToolsDisabled;
}

function defaultForKind(kind: ProviderConfig['kind'], baseUrl: string): boolean {
	switch (kind) {
		case 'anthropic':
		case 'gemini':
			return true;
		case 'ollama':
			return false;
		case 'openai-compatible':
			return KNOWN_GATEWAY_BASEURLS.has(baseUrl.replace(/\/+$/, ''));
		default:
			return false;
	}
}
