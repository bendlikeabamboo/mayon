/**
 * Image-output-capability resolution for the advisory image flag (spec 030,
 * `specs/030-image-generation/contracts/image-output-capability.md`). Verbatim
 * sibling of the 018 vision module (`src/lib/ai/vision-capability.ts`):
 * `'on'`/`'off'` override; `'auto'` (or absent) consults a static allowlist.
 * Pure and synchronous — no network probing. Advisory by design: the flag and
 * the allowlist MUST NOT gate, block, strip, or rewrite any request or
 * response payload; they drive UI indication only, and a model wrongly
 * believed incapable must still have its delivered images rendered.
 */
import type { ProviderConfig } from './types';

/**
 * Model-family prefixes advertised as image-output-capable. Matched
 * case-insensitively as a prefix of the model ID's last `/` segment. Static,
 * manually curated — updated by release, never at runtime.
 *
 * Entries:
 * - `gpt-image-` — OpenAI's image generation model family (`gpt-image-1`,
 *   `gpt-image-1-mini`), exposed through chat/gateway model listings.
 * - `dall-e-` — OpenAI's legacy image models (`dall-e-2/3`), still listed by
 *   gateways that surface the Images API catalog.
 * - `imagen-` — Google's Imagen family via Gemini API/Vertex (`imagen-3.0-*`,
 *   `imagen-4.0-*`).
 * - `gemini-2.0-flash-exp-image` — Gemini 2.0 experimental image generation.
 * - `gemini-2.5-flash-image` — Gemini 2.5 Flash Image (nano-banana) family,
 *   incl. `-preview` variants; the flagship chat-native image-output model.
 * - `gemini-3-pro-image-preview` — Gemini 3 Pro image preview variant.
 */
const IMAGE_OUTPUT_MODEL_PREFIXES: readonly string[] = [
	'gpt-image-',
	'dall-e-',
	'imagen-',
	'gemini-2.0-flash-exp-image',
	'gemini-2.5-flash-image',
	'gemini-3-pro-image-preview'
];

/** True if the model ID's last `/` segment starts with an image-output-family prefix. */
export function isImageOutputModelId(modelId: string): boolean {
	const segment = modelId.split('/').pop()?.toLowerCase() ?? '';
	return IMAGE_OUTPUT_MODEL_PREFIXES.some((prefix) => segment.startsWith(prefix));
}

/**
 * Resolve whether `modelId` on `config` is advertised as producing images:
 * `'on'` → true, `'off'` → false, `'auto'`/absent → static prefix allowlist.
 */
export function supportsImageOutput(config: ProviderConfig, modelId: string): boolean {
	if (config.imageOutput === 'on') return true;
	if (config.imageOutput === 'off') return false;
	return isImageOutputModelId(modelId);
}
