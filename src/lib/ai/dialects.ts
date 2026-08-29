import type {
	HazardId,
	JSONValue,
	ProviderConfig,
	ProviderKind,
	ReasoningEffort,
	ResolvedRequestSettings,
	SamplingRequestDefaults
} from './types';

export type ProviderOptionsFragment = Record<string, unknown>;

export interface EndpointDialect {
	id: string;
	baseUrl: RegExp;
	effort: Record<ReasoningEffort, ProviderOptionsFragment>;
	hazards?: HazardId[];
	source: string;
	checked: string;
}

export interface ModelOverlay {
	id: string;
	model: RegExp;
	endpoints?: RegExp[];
	effort?: Record<ReasoningEffort, ProviderOptionsFragment>;
	locksSampling?: boolean;
	effortLevels?: ReasoningEffort[];
	hazards?: HazardId[];
	source: string;
	checked: string;
}

export type DialectDescription = {
	locksSampling: boolean;
	effortLevels: ReasoningEffort[];
	hazards: HazardId[];
};

export function namespaceKeyFor(config: ProviderConfig): string {
	return (config.name ?? 'openai-compatible').split('.')[0].trim();
}

export const EXTRA_BODY_ALLOWLISTS: Record<
	Exclude<ProviderKind, 'openai-compatible'>,
	ReadonlySet<string>
> = {
	anthropic: new Set([
		'thinking',
		'effort',
		'speed',
		'taskBudget',
		'inferenceGeo',
		'disableParallelToolUse',
		'structuredOutputMode',
		'toolStreaming'
	]),
	gemini: new Set([
		'thinkingConfig',
		'safetySettings',
		'responseModalities',
		'cachedContent',
		'structuredOutputs'
	]),
	ollama: new Set(['think', 'options']),
	'github-copilot': new Set<string>()
};

const EXTRA_BODY_MAX_BYTES = 16384;
const SECRET_KEY_RE =
	/^(authorization|api[-_]?key|x-api-key|apikey|headers?|cookies?|token|secret|password|bearer)/i;
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export function validateExtraBody(
	input: unknown
): { ok: true; value: Record<string, JSONValue> } | { ok: false; errors: string[] } {
	let candidate: unknown = input;
	if (typeof candidate === 'string') {
		try {
			candidate = JSON.parse(candidate);
		} catch {
			return { ok: false, errors: ['Extra body is not valid JSON'] };
		}
	}
	if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
		return { ok: false, errors: ['Extra body must be a JSON object'] };
	}
	if (JSON.stringify(candidate).length > EXTRA_BODY_MAX_BYTES) {
		return { ok: false, errors: ['Extra body exceeds 16 KiB limit'] };
	}
	const errors: string[] = [];
	for (const key of Object.keys(candidate)) {
		if (FORBIDDEN_KEYS.has(key)) {
			errors.push(`Key "${key}" is not allowed`);
		} else if (SECRET_KEY_RE.test(key)) {
			errors.push(`Key "${key}" looks like a secret; secrets never live in provider settings`);
		}
	}
	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, value: candidate as Record<string, JSONValue> };
}

const KIND_BASELINES: Record<ProviderKind, Record<ReasoningEffort, ProviderOptionsFragment>> = {
	'openai-compatible': { off: {}, on: {}, deep: {} },
	anthropic: {
		off: {},
		on: { thinking: { type: 'adaptive', display: 'summarized' }, effort: 'medium' },
		deep: { thinking: { type: 'adaptive', display: 'summarized' }, effort: 'high' }
	},
	gemini: { off: {}, on: {}, deep: {} },
	ollama: { off: {}, on: { think: true }, deep: { think: true } },
	'github-copilot': { off: {}, on: {}, deep: {} }
};

const KIND_DESCRIPTIONS: Record<ProviderKind, DialectDescription> = {
	'openai-compatible': { locksSampling: false, effortLevels: ['off', 'on', 'deep'], hazards: [] },
	anthropic: {
		locksSampling: false,
		effortLevels: ['off', 'on', 'deep'],
		hazards: ['thinking-rejects-sampling']
	},
	gemini: { locksSampling: false, effortLevels: ['off', 'on', 'deep'], hazards: [] },
	ollama: { locksSampling: false, effortLevels: ['off', 'on'], hazards: [] },
	'github-copilot': { locksSampling: false, effortLevels: ['off', 'on', 'deep'], hazards: [] }
};

export const ENDPOINT_DIALECTS: EndpointDialect[] = [
	{
		id: 'zai',
		baseUrl: /api\.z\.ai/i,
		effort: {
			off: { thinking: { type: 'disabled' } },
			on: { thinking: { type: 'enabled' }, reasoning_effort: 'high' },
			deep: { thinking: { type: 'enabled' }, reasoning_effort: 'max' }
		},
		hazards: ['thinking-ignores-sampling', 'reasoning-eats-token-cap'],
		source: 'research/005 §3 (Z.AI)',
		checked: '2026-08-22'
	},
	{
		id: 'deepseek',
		baseUrl: /api\.deepseek\.com/i,
		effort: {
			off: { thinking: { type: 'disabled' } },
			on: { thinking: { type: 'enabled' }, reasoning_effort: 'high' },
			deep: { thinking: { type: 'enabled' }, reasoning_effort: 'max' }
		},
		hazards: ['thinking-ignores-sampling', 'reasoning-eats-token-cap'],
		source: 'research/005 §3 (DeepSeek)',
		checked: '2026-08-22'
	},
	{
		id: 'groq',
		baseUrl: /api\.groq\.com/i,
		effort: {
			off: {},
			on: { reasoning_format: 'parsed' },
			deep: { reasoning_format: 'parsed' }
		},
		source: 'research/005 §3 (Groq)',
		checked: '2026-08-22'
	},
	{
		id: 'mistral',
		baseUrl: /api\.mistral\.ai/i,
		effort: { off: {}, on: {}, deep: {} },
		source: 'research/005 §3 (Mistral)',
		checked: '2026-08-22'
	},
	{
		id: 'moonshot',
		baseUrl: /api\.moonshot\.(ai|cn)|kimi\.moonshot\.cn/i,
		effort: { off: {}, on: {}, deep: {} },
		source: 'research/005 §3 (Moonshot Kimi)',
		checked: '2026-08-22'
	},
	{
		id: 'dashscope',
		baseUrl: /dashscope\.aliyuncs\.com/i,
		effort: {
			off: { enable_thinking: false },
			on: { enable_thinking: true },
			deep: { enable_thinking: true }
		},
		source: 'research/005 §3 (DashScope)',
		checked: '2026-08-22'
	}
];

export const MODEL_OVERLAYS: ModelOverlay[] = [
	{
		id: 'glm-5.3',
		model: /^glm-5\.3/i,
		effort: {
			off: { thinking: null },
			on: { thinking: { type: 'enabled' }, reasoning_effort: 'high' },
			deep: { reasoning_effort: 'max' }
		},
		hazards: ['cannot-disable-thinking', 'thinking-ignores-sampling'],
		source: 'research/005 §3 (GLM 5.3)',
		checked: '2026-08-22'
	},
	{
		id: 'glm-5.x',
		model: /^glm-5/i,
		effort: {
			off: { thinking: { type: 'disabled' } },
			on: { thinking: { type: 'enabled' }, reasoning_effort: 'high' },
			deep: { reasoning_effort: 'max' }
		},
		hazards: ['thinking-ignores-sampling'],
		source: 'research/005 §3 (GLM 5.x)',
		checked: '2026-08-22'
	},
	{
		id: 'kimi-k2.6',
		model: /^kimi-k2\.6/i,
		effort: {
			off: { thinking: { type: 'disabled' } },
			on: { thinking: { type: 'enabled' } },
			deep: { thinking: { type: 'enabled' } }
		},
		locksSampling: true,
		effortLevels: ['off', 'on'],
		hazards: ['locks-sampling'],
		source: 'research/005 §3 (Kimi K2.6)',
		checked: '2026-08-22'
	},
	{
		id: 'kimi-k3',
		model: /^kimi-k3/i,
		effort: {
			off: { thinking: null },
			on: { reasoning_effort: 'high' },
			deep: { reasoning_effort: 'max' }
		},
		locksSampling: true,
		hazards: ['cannot-disable-thinking', 'locks-sampling'],
		source: 'research/005 §3 (Kimi K3)',
		checked: '2026-08-22'
	},
	{
		id: 'deepseek-v4',
		model: /^deepseek-(chat|reasoner|v4)/i,
		effort: {
			off: { thinking: { type: 'disabled' } },
			on: { thinking: { type: 'enabled' }, reasoning_effort: 'high' },
			deep: { reasoning_effort: 'max' }
		},
		hazards: ['thinking-ignores-sampling', 'reasoning-eats-token-cap'],
		source: 'research/005 §3 (DeepSeek V4)',
		checked: '2026-08-22'
	},
	{
		id: 'groq-gpt-oss',
		model: /^gpt-oss/i,
		endpoints: [/^groq$/],
		effort: {
			off: {},
			on: { reasoning_effort: 'medium' },
			deep: { reasoning_effort: 'high' }
		},
		source: 'research/005 §3 (Groq gpt-oss)',
		checked: '2026-08-22'
	},
	{
		id: 'groq-qwen3',
		model: /^qwen3/i,
		endpoints: [/^groq$/],
		effort: {
			off: { reasoning_effort: 'none' },
			on: { reasoning_effort: 'default' },
			deep: { reasoning_effort: 'default' }
		},
		source: 'research/005 §3 (Groq Qwen3)',
		checked: '2026-08-22'
	},
	{
		id: 'mistral-reasoning',
		model: /^mistral-(small|medium-3)/i,
		endpoints: [/^mistral$/],
		effort: {
			off: { reasoning_effort: 'none' },
			on: { reasoning_effort: 'high' },
			deep: { reasoning_effort: 'high' }
		},
		effortLevels: ['off', 'on'],
		source: 'research/005 §3 (Mistral reasoning)',
		checked: '2026-08-22'
	},
	{
		id: 'dashscope-thinking-only',
		model: /^kimi-k2\.7-code|^qwen3/i,
		endpoints: [/^dashscope$/],
		effort: {
			off: { enable_thinking: null },
			on: { enable_thinking: true },
			deep: { enable_thinking: true }
		},
		hazards: ['cannot-disable-thinking'],
		source: 'research/005 §3 (DashScope thinking-only)',
		checked: '2026-08-22'
	},
	{
		id: 'gemini-3',
		model: /^gemini-3/i,
		endpoints: [/^gemini$/],
		effort: {
			off: { thinkingConfig: null },
			on: { thinkingConfig: { thinkingLevel: 'medium', includeThoughts: true } },
			deep: { thinkingConfig: { thinkingLevel: 'high', includeThoughts: true } }
		},
		hazards: ['cannot-disable-thinking'],
		source: 'research/005 §3 (Gemini 3)',
		checked: '2026-08-22'
	},
	{
		id: 'gemini-2.5-pro',
		model: /^gemini-2\.5-pro/i,
		endpoints: [/^gemini$/],
		effort: {
			off: { thinkingConfig: null },
			on: { thinkingConfig: { thinkingBudget: 2048, includeThoughts: true } },
			deep: { thinkingConfig: { thinkingBudget: 32768, includeThoughts: true } }
		},
		hazards: ['cannot-disable-thinking'],
		source: 'research/005 §3 (Gemini 2.5 Pro)',
		checked: '2026-08-22'
	},
	{
		id: 'gemini-2.5',
		model: /^gemini-2\.5/i,
		endpoints: [/^gemini$/],
		effort: {
			off: { thinkingConfig: { thinkingBudget: 0 } },
			on: { thinkingConfig: { thinkingBudget: 2048, includeThoughts: true } },
			deep: { thinkingConfig: { thinkingBudget: 32768, includeThoughts: true } }
		},
		source: 'research/005 §3 (Gemini 2.5)',
		checked: '2026-08-22'
	}
];

function endpointDialectFor(config: ProviderConfig): EndpointDialect | null {
	if (config.kind !== 'openai-compatible') return null;
	return ENDPOINT_DIALECTS.find((dialect) => dialect.baseUrl.test(config.baseUrl)) ?? null;
}

function lastSegmentOf(modelId: string): string {
	return modelId.split('/').pop()?.toLowerCase() ?? '';
}

function modelOverlayFor(
	config: ProviderConfig,
	modelId: string,
	endpoint: EndpointDialect | null
): ModelOverlay | null {
	const segment = lastSegmentOf(modelId);
	if (!segment) return null;
	const scopes: string[] = [];
	if (endpoint) scopes.push(endpoint.id);
	if (config.kind !== 'openai-compatible') scopes.push(config.kind);
	scopes.push(config.baseUrl);
	return (
		MODEL_OVERLAYS.find(
			(overlay) =>
				overlay.model.test(segment) &&
				(!overlay.endpoints ||
					overlay.endpoints.some((scope) => scopes.some((candidate) => scope.test(candidate))))
		) ?? null
	);
}

function mergeFragment(target: ProviderOptionsFragment, fragment: ProviderOptionsFragment): void {
	for (const key of Object.keys(fragment)) {
		if (fragment[key] === null) {
			delete target[key];
		} else {
			target[key] = fragment[key];
		}
	}
}

export function namespaceFor(config: ProviderConfig): string {
	switch (config.kind) {
		case 'anthropic':
			return 'anthropic';
		case 'gemini':
			return 'google';
		case 'ollama':
			return 'ollama';
		case 'github-copilot':
			return 'github-copilot';
		default:
			return namespaceKeyFor(config);
	}
}

export function resolveRequestSettings(
	config: ProviderConfig,
	modelId: string,
	effort: ReasoningEffort
): ResolvedRequestSettings {
	const fragment: ProviderOptionsFragment = {};
	mergeFragment(fragment, KIND_BASELINES[config.kind][effort]);
	const endpoint = endpointDialectFor(config);
	if (endpoint) mergeFragment(fragment, endpoint.effort[effort]);
	const overlay = modelOverlayFor(config, modelId, endpoint);
	if (overlay?.effort) mergeFragment(fragment, overlay.effort[effort]);
	const providerOptions: Record<string, unknown> = {};
	if (Object.keys(fragment).length > 0) {
		providerOptions[namespaceFor(config)] = fragment;
	}
	const callSettings: SamplingRequestDefaults = Object.fromEntries(
		Object.entries(config.requestDefaults ?? {}).filter(([, value]) => value !== undefined)
	);
	const droppedExtraKeys: string[] = [];
	if (config.extraBody !== undefined && validateExtraBody(config.extraBody).ok) {
		const namespace = namespaceFor(config);
		const allowlist =
			config.kind === 'openai-compatible' ? null : EXTRA_BODY_ALLOWLISTS[config.kind];
		const merged: ProviderOptionsFragment = {};
		for (const [key, value] of Object.entries(config.extraBody)) {
			if (allowlist === null || allowlist.has(key)) merged[key] = value;
			else droppedExtraKeys.push(key);
		}
		if (Object.keys(merged).length > 0) {
			const existing = providerOptions[namespace] as ProviderOptionsFragment | undefined;
			providerOptions[namespace] = { ...(existing ?? {}), ...merged };
		}
		droppedExtraKeys.sort();
	}
	return { callSettings, providerOptions, droppedExtraKeys };
}

export function describeDialect(
	config: ProviderConfig,
	modelId: string
): DialectDescription | null {
	const endpoint = endpointDialectFor(config);
	const overlay = modelOverlayFor(config, modelId, endpoint);
	if (!overlay && !endpoint) {
		if (config.kind === 'openai-compatible') return null;
		const kind = KIND_DESCRIPTIONS[config.kind];
		return {
			locksSampling: kind.locksSampling,
			effortLevels: [...kind.effortLevels],
			hazards: [...kind.hazards]
		};
	}
	const hazards: HazardId[] = [...(endpoint?.hazards ?? [])];
	for (const hazard of overlay?.hazards ?? []) {
		if (!hazards.includes(hazard)) hazards.push(hazard);
	}
	return {
		locksSampling: overlay?.locksSampling ?? false,
		effortLevels: [...(overlay?.effortLevels ?? ['off', 'on', 'deep'])],
		hazards
	};
}
