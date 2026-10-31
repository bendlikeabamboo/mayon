/**
 * Headless real-LLM verification (no mocks): proves the production chat path —
 * `buildSdkModel` → keychain fetch → `getLlmFetch` → real endpoint — works
 * without a browser, with the key supplied via environment variables and read
 * through the env-backed key store. Skipped entirely unless all three env vars
 * are set. Run:
 *
 * 	MAYON_API_KEY=... MAYON_TEST_BASE_URL=... MAYON_TEST_MODEL=... \
 * 		pnpm vitest run src/lib/ai/real-provider.integration.test.ts
 */
import { describe, expect, it } from 'vitest';
import { streamText } from 'ai';
import { testProviderConnection } from './connection-test';
import { buildSdkModel } from './sdk-factory';
import type { ProviderConfig } from './types';

const hasEnv = Boolean(
	process.env.MAYON_API_KEY && process.env.MAYON_TEST_BASE_URL && process.env.MAYON_TEST_MODEL
);

const config: ProviderConfig = {
	id: 'real-provider',
	kind: 'openai-compatible',
	name: 'Headless test provider',
	baseUrl: process.env.MAYON_TEST_BASE_URL ?? '',
	defaultModel: process.env.MAYON_TEST_MODEL ?? '',
	models: process.env.MAYON_TEST_MODEL ? [process.env.MAYON_TEST_MODEL] : [],
	requiresKey: true
};

describe.skipIf(!hasEnv)('real provider (live endpoint, env-backed key)', () => {
	it('streams a real completion through buildSdkModel', async () => {
		const { model } = await buildSdkModel(config, { hasKey: async () => true });
		const result = streamText({
			model,
			messages: [{ role: 'user', content: 'Reply with exactly: OK' }]
		});
		let text = '';
		for await (const part of result.fullStream) {
			if (part.type === 'text-delta') text += part.text;
		}
		expect(text.trim().length).toBeGreaterThan(0);
	}, 60_000);

	it('testProviderConnection discovers models over the real transport', async () => {
		const result = await testProviderConnection(config, { timeoutMs: 30_000 });
		expect(result.ok).toBe(true);
	}, 60_000);
});
