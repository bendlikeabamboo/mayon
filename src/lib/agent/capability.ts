import type { ProviderConfig } from '$lib/ai/types';

const KNOWN_GATEWAY_BASEURLS: ReadonlySet<string> = new Set([
	'https://api.deepseek.com',
	'https://api.deepseek.com/v1',
	'https://api.x.ai/v1',
	'https://api.moonshot.ai/v1',
	'https://api.moonshot.cn/v1',
	'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
	'https://dashscope.aliyuncs.com/compatible-mode/v1',
	'https://api.groq.com/openai/v1',
	'https://api.mistral.ai/v1',
	'https://opencode.ai/zen/v1',
	'https://opencode.ai/zen/go/v1',
	'http://localhost:4000',
	'http://localhost:4000/v1',
	'https://ai-gateway.vercel.sh/v1',
	'https://router.requesty.ai/v1',
	'https://router.eu.requesty.ai/v1',
	'https://api.z.ai/api/coding/paas/v4',
	'https://api.kilo.ai/api/gateway',
	'https://openrouter.ai/api/v1',
	'https://api.openai.com/v1'
]);

/** Structural input for `legacyToolDefault`: the legacy stored config shape. */
export interface LegacyToolConfig {
	kind: ProviderConfig['kind'];
	baseUrl: string;
	/** Legacy stored value — the retired `'auto'` (or absence) resolves via the kind table. */
	toolCapability?: 'auto' | 'on' | 'off';
}

/**
 * The prior (pre-021) effective tool capability as an explicit `'on' | 'off'`:
 * an explicit stored value passes through; otherwise the legacy kind table
 * applies, with `openai-compatible` gated on the `KNOWN_GATEWAY_BASEURLS`
 * allowlist (trailing slashes stripped). Used only by read-time normalization
 * (`normalizeProviderConfig` in `registry.ts`) — never in the request path.
 */
export function legacyToolDefault(config: LegacyToolConfig): 'on' | 'off' {
	if (config.toolCapability === 'on') return 'on';
	if (config.toolCapability === 'off') return 'off';

	switch (config.kind) {
		case 'anthropic':
		case 'gemini':
		case 'github-copilot':
			return 'on';
		case 'ollama':
			return 'off';
		case 'openai-compatible':
			return KNOWN_GATEWAY_BASEURLS.has(config.baseUrl.replace(/\/+$/, '')) ? 'on' : 'off';
		default:
			return 'off';
	}
}

let sessionToolsDisabled = false;

export function disableToolsForSession(): void {
	sessionToolsDisabled = true;
}

export function isSessionDisabled(): boolean {
	return sessionToolsDisabled;
}

export function resolveToolCapability(config: ProviderConfig): boolean {
	return config.toolCapability !== 'off' && !sessionToolsDisabled;
}
