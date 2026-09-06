import { describe, expect, it } from 'vitest';
import { PROVIDER_TEMPLATES } from '$lib/ai/registry';

describe('DeepSeek template', () => {
	const t = PROVIDER_TEMPLATES[0];

	it('is at position 0', () => {
		expect(t.label).toBe('DeepSeek');
	});

	it('has correct shape', () => {
		expect(t.kind).toBe('openai-compatible');
		expect(t.baseUrl).toBe('https://api.deepseek.com');
		expect(t.requiresKey).toBe(true);
		expect(t.discoverable).toBe(true);
		expect(t.toolCapability).toBe('on');
		expect(t.models).toEqual(['deepseek-chat', 'deepseek-reasoner']);
		expect(t.defaultModel).toBe('deepseek-chat');
	});
});

describe('xAI (Grok) template', () => {
	const t = PROVIDER_TEMPLATES[1];

	it('is at position 1', () => {
		expect(t.label).toBe('xAI (Grok)');
	});

	it('has correct shape', () => {
		expect(t.kind).toBe('openai-compatible');
		expect(t.baseUrl).toBe('https://api.x.ai/v1');
		expect(t.requiresKey).toBe(true);
		expect(t.discoverable).toBe(true);
		expect(t.toolCapability).toBe('on');
		expect(t.models).toContain(t.defaultModel);
		expect(t.defaultModel).toBe('grok-4.6');
	});
});

describe('Moonshot Kimi template', () => {
	const t = PROVIDER_TEMPLATES[2];

	it('is at position 2', () => {
		expect(t.label).toBe('Moonshot Kimi');
	});

	it('has correct shape', () => {
		expect(t.kind).toBe('openai-compatible');
		expect(t.baseUrl).toBe('https://api.moonshot.ai/v1');
		expect(t.requiresKey).toBe(true);
		expect(t.discoverable).toBe(true);
		expect(t.toolCapability).toBe('on');
		expect(t.models).toContain(t.defaultModel);
		expect(t.models.length).toBe(2);
	});
});

describe('Qwen (DashScope) template', () => {
	const t = PROVIDER_TEMPLATES[3];

	it('is at position 3', () => {
		expect(t.label).toBe('Qwen (DashScope)');
	});

	it('has correct shape', () => {
		expect(t.kind).toBe('openai-compatible');
		expect(t.baseUrl).toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
		expect(t.requiresKey).toBe(true);
		expect(t.discoverable).toBe(false);
		expect(t.toolCapability).toBe('on');
		expect(t.models).toContain(t.defaultModel);
		expect(t.models.length).toBe(2);
	});
});

describe('Groq template', () => {
	const t = PROVIDER_TEMPLATES[4];

	it('is at position 4', () => {
		expect(t.label).toBe('Groq');
	});

	it('has correct shape', () => {
		expect(t.kind).toBe('openai-compatible');
		expect(t.baseUrl).toBe('https://api.groq.com/openai/v1');
		expect(t.requiresKey).toBe(true);
		expect(t.discoverable).toBe(true);
		expect(t.toolCapability).toBe('on');
		expect(t.models).toContain(t.defaultModel);
		expect(t.models.length).toBeGreaterThanOrEqual(2);
		expect(t.models.length).toBeLessThanOrEqual(3);
	});
});

describe('Mistral template', () => {
	const t = PROVIDER_TEMPLATES[5];

	it('is at position 5', () => {
		expect(t.label).toBe('Mistral');
	});

	it('has correct shape', () => {
		expect(t.kind).toBe('openai-compatible');
		expect(t.baseUrl).toBe('https://api.mistral.ai/v1');
		expect(t.requiresKey).toBe(true);
		expect(t.discoverable).toBe(true);
		expect(t.toolCapability).toBe('on');
		expect(t.models).toContain(t.defaultModel);
		expect(t.models.length).toBe(2);
	});
});

describe('OpenCode Zen template', () => {
	const t = PROVIDER_TEMPLATES[6];

	it('is at position 6', () => {
		expect(t.label).toBe('OpenCode Zen');
	});

	it('has correct shape', () => {
		expect(t.kind).toBe('openai-compatible');
		expect(t.baseUrl).toBe('https://opencode.ai/zen/v1');
		expect(t.requiresKey).toBe(true);
		expect(t.discoverable).toBe(true);
		expect(t.toolCapability).toBe('on');
		expect(t.models).toContain(t.defaultModel);
		expect(t.models.length).toBe(2);
	});
});

describe('LiteLLM (self-hosted) template', () => {
	const t = PROVIDER_TEMPLATES[7];

	it('is at position 7', () => {
		expect(t.label).toBe('LiteLLM (self-hosted)');
	});

	it('has correct shape', () => {
		expect(t.kind).toBe('openai-compatible');
		expect(t.baseUrl).toBe('http://localhost:4000');
		expect(t.requiresKey).toBe(false);
		expect(t.discoverable).toBe(true);
		expect(t.toolCapability).toBe('on');
		expect(t.models).toContain(t.defaultModel);
		expect(t.models.length).toBe(2);
	});
});

describe('Vercel AI Gateway template', () => {
	const t = PROVIDER_TEMPLATES[8];

	it('is at position 8', () => {
		expect(t.label).toBe('Vercel AI Gateway');
	});

	it('has correct shape', () => {
		expect(t.kind).toBe('openai-compatible');
		expect(t.baseUrl).toBe('https://ai-gateway.vercel.sh/v1');
		expect(t.requiresKey).toBe(true);
		expect(t.discoverable).toBe(true);
		expect(t.toolCapability).toBe('on');
		expect(t.models).toContain(t.defaultModel);
		expect(t.models.length).toBe(2);
	});
});

describe('Requesty template', () => {
	const t = PROVIDER_TEMPLATES[9];

	it('is at position 9', () => {
		expect(t.label).toBe('Requesty');
	});

	it('has correct shape', () => {
		expect(t.kind).toBe('openai-compatible');
		expect(t.baseUrl).toBe('https://router.requesty.ai/v1');
		expect(t.requiresKey).toBe(true);
		expect(t.discoverable).toBe(true);
		expect(t.toolCapability).toBe('on');
		expect(t.models).toContain(t.defaultModel);
		expect(t.models.length).toBe(2);
	});
});

describe('PROVIDER_TEMPLATES catalog order and length', () => {
	const labels = PROVIDER_TEMPLATES.map((t) => t.label);

	it('first eleven labels are the first-class providers and routers', () => {
		expect(labels.slice(0, 11)).toEqual([
			'DeepSeek',
			'xAI (Grok)',
			'Moonshot Kimi',
			'Qwen (DashScope)',
			'Groq',
			'Mistral',
			'OpenCode Zen',
			'LiteLLM (self-hosted)',
			'Vercel AI Gateway',
			'Requesty',
			'Z.AI (GLM)'
		]);
	});

	it('total catalog length is 20', () => {
		expect(labels).toHaveLength(20);
	});

	it('Ollama stays at index 16; LM Studio and vLLM complete the Local group; GitHub Copilot is pinned last', () => {
		expect(labels[16]).toBe('Ollama (local)');
		expect(labels[17]).toBe('LM Studio (local)');
		expect(labels[18]).toBe('vLLM (local)');
		expect(labels[19]).toBe('GitHub Copilot');
	});
});

describe('GitHub Copilot template', () => {
	const t = PROVIDER_TEMPLATES[19];

	it('is at position 17 (last)', () => {
		expect(t.label).toBe('GitHub Copilot');
	});

	it('has correct shape', () => {
		expect(t.kind).toBe('github-copilot');
		expect(t.baseUrl).toBe('https://api.githubcopilot.com');
		expect(t.requiresKey).toBe(true);
		expect(t.discoverable).toBe(true);
		expect(t.toolCapability).toBe('on');
		expect(t.defaultModel).toBe('gpt-5.4');
		expect(t.models).toEqual([
			'gpt-5.4',
			'gpt-5.3-codex',
			'gpt-5-mini',
			'claude-sonnet-4.6',
			'claude-opus-4.6',
			'gemini-3.7-flash'
		]);
	});
});

describe('PROVIDER_TEMPLATES catalog integrity', () => {
	const labels = PROVIDER_TEMPLATES.map((t) => t.label);

	it('every template has a unique label', () => {
		expect(new Set(labels).size).toBe(labels.length);
	});

	PROVIDER_TEMPLATES.forEach((t) => {
		describe(`template "${t.label}"`, () => {
			it('has a non-empty description', () => {
				expect(t.description).toBeTruthy();
			});

			it('has a valid group and toolCapability on', () => {
				expect(['local', 'cloud', 'gateway', 'custom']).toContain(t.group);
				expect(t.toolCapability).toBe('on');
			});

			it('defaultModel is a member of models (unless discovery-first)', () => {
				if (!t.discoverable) {
					expect(t.models).toContain(t.defaultModel);
				}
			});

			it('baseUrl starts with https:// or is a localhost exemption (Ollama / LiteLLM / LM Studio / vLLM)', () => {
				const localhostExemptions = [
					'http://localhost:11434/api',
					'http://localhost:4000',
					'http://localhost:1234/v1',
					'http://localhost:8000/v1'
				];
				const valid = t.baseUrl.startsWith('https://') || localhostExemptions.includes(t.baseUrl);
				expect(valid).toBe(true);
			});

			it('requiresKey is true (except the keyless Local runtimes and LiteLLM self-hosted)', () => {
				const keylessLabels = [
					'Ollama (local)',
					'LiteLLM (self-hosted)',
					'LM Studio (local)',
					'vLLM (local)'
				];
				if (keylessLabels.includes(t.label)) {
					expect(t.requiresKey).toBe(false);
				} else {
					expect(t.requiresKey).toBe(true);
				}
			});
		});
	});
});

describe('per-group ordering (data-model assignment table)', () => {
	it('groups appear in registry order matching the table', () => {
		const expected: [string, string[]][] = [
			['local', ['Ollama (local)', 'LM Studio (local)', 'vLLM (local)']],
			[
				'cloud',
				[
					'DeepSeek',
					'xAI (Grok)',
					'Moonshot Kimi',
					'Qwen (DashScope)',
					'Groq',
					'Mistral',
					'Z.AI (GLM)',
					'OpenAI',
					'Anthropic (Claude)',
					'Google Gemini',
					'GitHub Copilot'
				]
			],
			[
				'gateway',
				[
					'OpenCode Zen',
					'LiteLLM (self-hosted)',
					'Vercel AI Gateway',
					'Requesty',
					'Kilo Gateway',
					'OpenRouter'
				]
			]
		];
		for (const [group, expectedLabels] of expected) {
			expect(PROVIDER_TEMPLATES.filter((t) => t.group === group).map((t) => t.label)).toEqual(
				expectedLabels
			);
		}
	});

	it('no built-in template lands in custom', () => {
		expect(PROVIDER_TEMPLATES.filter((t) => t.group === 'custom')).toHaveLength(0);
	});
});

describe('LM Studio (local) template', () => {
	const t = PROVIDER_TEMPLATES.find((x) => x.label === 'LM Studio (local)');

	it('is a discovery-first keyless local openai-compatible entry', () => {
		expect(t).toBeDefined();
		expect(t!.kind).toBe('openai-compatible');
		expect(t!.group).toBe('local');
		expect(t!.baseUrl).toBe('http://localhost:1234/v1');
		expect(t!.requiresKey).toBe(false);
		expect(t!.discoverable).toBe(true);
		expect(t!.models).toEqual([]);
		expect(t!.defaultModel).toBe('');
		expect(t!.toolCapability).toBe('on');
	});
});

describe('vLLM (local) template', () => {
	const t = PROVIDER_TEMPLATES.find((x) => x.label === 'vLLM (local)');

	it('is a discovery-first keyless local openai-compatible entry', () => {
		expect(t).toBeDefined();
		expect(t!.kind).toBe('openai-compatible');
		expect(t!.group).toBe('local');
		expect(t!.baseUrl).toBe('http://localhost:8000/v1');
		expect(t!.requiresKey).toBe(false);
		expect(t!.discoverable).toBe(true);
		expect(t!.models).toEqual([]);
		expect(t!.defaultModel).toBe('');
		expect(t!.toolCapability).toBe('on');
	});
});
