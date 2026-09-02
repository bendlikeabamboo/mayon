/**
 * Vision-capability resolution for the advisory image gate (spec 018,
 * `specs/018-image-chat-parts/contracts/provider-vision-flag.md`). Mirrors the
 * `toolCapability` precedent (`src/lib/agent/capability.ts`): `'on'`/`'off'`
 * override; `'auto'` (or absent) consults a static allowlist. Pure and
 * synchronous — no network probing (no standard vision-probe endpoint exists
 * across providers). Advisory by design: a vision model missing from the
 * allowlist still works — image-bearing sends go out regardless and the
 * dedicated error surfaces only when the provider rejects them.
 */
import type { ProviderConfig } from './types';

/**
 * Model-family prefixes advertised as vision-capable. Matched
 * case-insensitively as a prefix of the model ID's last `/` segment, so
 * gateway vendor-qualified IDs (`openai/gpt-4o-mini`) resolve the same way as
 * bare ones. `gpt-4o` covering `gpt-4o-mini` etc. is intended (prefix
 * semantics).
 */
const VISION_MODEL_PREFIXES: readonly string[] = [
	'gpt-4o',
	'gpt-4.1',
	'gpt-5',
	'chatgpt-4o',
	'o3',
	'o4',
	'claude-3',
	'claude-4',
	'gemini-1.5',
	'gemini-2',
	'gemini-3',
	'llama-3.2-vision',
	'llama-4',
	'qwen-vl',
	'qwen2-vl',
	'qwen2.5-vl',
	'qvq',
	'pixtral',
	'mistral-small-3'
];

/** True if the model ID's last `/` segment starts with a vision-family prefix. */
export function isVisionModelId(modelId: string): boolean {
	const segment = modelId.split('/').pop()?.toLowerCase() ?? '';
	return VISION_MODEL_PREFIXES.some((prefix) => segment.startsWith(prefix));
}

/**
 * Resolve whether `modelId` on `config` is advertised as accepting images:
 * `'on'` → true, `'off'` → false, `'auto'`/absent → static prefix allowlist.
 */
export function supportsVision(config: ProviderConfig, modelId: string): boolean {
	if (config.vision === 'on') return true;
	if (config.vision === 'off') return false;
	return isVisionModelId(modelId);
}
