import type { APIRequestContext } from '@playwright/test';

import { MODEL_ID, MOCK_BASE_URL } from './kitchen-sink';

/** The provider seeded once by the setup project and reused by every spec. */
export const SHARED_PROVIDER_ID = 'e2e-litellm-mock';

function endpoint(baseURL: string, path: string): string {
	return new URL(path, baseURL).toString();
}

async function postQuery(
	request: APIRequestContext,
	baseURL: string,
	body: Record<string, unknown>,
	label: string
): Promise<void> {
	const res = await request.post(endpoint(baseURL, '/api/db/query'), { data: body });
	if (!res.ok()) {
		throw new Error(`e2e seed failed (${label}): ${res.status()} ${await res.text()}`);
	}
}

/**
 * Seed the exact settings the old UI onboarding journey produced: one
 * LiteLLM (self-hosted) card whose catalog holds the mock discovery merge,
 * made active. Written through the same `/api/db/query` seam the fixtures and
 * legacy provider-picker writes use; `settingsRepo.set` stores
 * `JSON.stringify(value)` under each key.
 */
export async function seedMockProvider(
	request: APIRequestContext,
	baseURL: string,
	providerId = SHARED_PROVIDER_ID
): Promise<void> {
	await postQuery(
		request,
		baseURL,
		{
			op: 'exec',
			sql: "DELETE FROM settings WHERE key IN ('providers', 'activeProvider')"
		},
		'delete'
	);

	const providers = {
		[providerId]: {
			id: providerId,
			kind: 'openai-compatible',
			name: 'LiteLLM (self-hosted)',
			baseUrl: MOCK_BASE_URL,
			defaultModel: MODEL_ID,
			models: [MODEL_ID, 'gpt-4o-mini', 'claude-sonnet-4-5'],
			discoverable: true,
			group: 'gateway',
			requiresKey: false,
			toolCapability: 'on'
		}
	};

	// op 'query' (not 'exec'): the server passes params only for the query op
	// — exec drops them, and request.post does not throw on 400, so an exec
	// INSERT would silently no-op and leave providers unseeded.
	await postQuery(
		request,
		baseURL,
		{
			op: 'query',
			sql: 'INSERT INTO settings (key, value) VALUES ($1, $2), ($3, $4)',
			params: ['providers', JSON.stringify(providers), 'activeProvider', JSON.stringify(providerId)]
		},
		'insert'
	);
}

/** Insert a root chat directly; the cheapest seam for per-test chat setup. */
export async function createChat(
	request: APIRequestContext,
	baseURL: string,
	title = 'E2E chat'
): Promise<string> {
	const chatId = crypto.randomUUID();
	const now = Date.now();
	await postQuery(
		request,
		baseURL,
		{
			op: 'query',
			sql: 'INSERT INTO chats (id, root_id, title, depth, created_at, updated_at) VALUES ($1, $1, $2, 0, $3, $3)',
			params: [chatId, title, now]
		},
		'chat'
	);
	return chatId;
}
