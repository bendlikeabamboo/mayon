/**
 * Model discovery for OpenAI-compatible gateways with large, frequently-updated
 * catalogs (OpenRouter, Kilo Gateway, Z.AI). Fetches the `/models` list through
 * the shared transport seam — so the API key is resolved exactly like a chat
 * request (keychain on desktop, IndexedDB in browser) and desktop avoids CORS
 * via the Rust reqwest bridge. Auth is attached only when a key is configured,
 * so public model lists (e.g. OpenRouter's) work before a key is saved too.
 *
 * The transport yields a `ReadableStream` even for one-shot JSON responses, so
 * `discoverModels` drains it fully before parsing. Providers speak the standard
 * OpenAI shape `{ data: [{ id }] }`; a bare array (and a bare array of strings)
 * is also tolerated. Unknown/empty shapes contribute nothing — discovery is
 * best-effort and never throws a *new* error class: on failure it surfaces the
 * same typed provider errors as a chat request (see `errors.ts`).
 *
 * Auth is resolved per kind. Keyed gateways attach a static Bearer descriptor
 * (transport resolves the secret); `github-copilot` cannot — the KeyStore grant
 * is not usable against `/models` — so discovery resolves a short-lived session
 * descriptor first and calls the session's endpoint with the mandatory Copilot
 * header set (constants owned by `copilot-fetch.ts`), filtering the parsed
 * entries to chat-capable, policy-enabled models (research D5).
 */
import { COPILOT_HEADERS } from './copilot-fetch';
import { getCopilotSession } from './copilot-session';
import { getHttpTransport } from './http-transport';
import { createBrowserKeyStore } from './keystore/browser';
import { MissingKeyError, type ProviderConfig } from './types';

export interface ModelDiscoveryDeps {
	/** True if an API key is configured for `id` (decides whether to attach auth). */
	hasKey: (id: string) => Promise<boolean>;
}

/** Shape of an OpenAI-compatible `/models` response (only the fields we read). */
interface ModelsListResponse {
	data?: Array<{ id?: unknown; type?: unknown }>;
}

/** Shape of a Copilot `/models` entry (only the fields the filter reads). */
interface CopilotModelEntry {
	id?: unknown;
	object?: unknown;
	capabilities?: { type?: unknown };
	policy?: { state?: unknown };
}

/**
 * Discover the available model IDs from a provider's `/models` endpoint. Returns
 * a de-duplicated, alphabetically-sorted list. Auth is resolved per kind (static
 * Bearer from the KeyStore, or the Copilot session for `github-copilot`). Throws
 * the same typed provider errors as a chat request on HTTP/network failure (so
 * the UI can format them via `formatProviderError`).
 */
export async function discoverModels(
	config: ProviderConfig,
	deps: ModelDiscoveryDeps,
	signal?: AbortSignal
): Promise<string[]> {
	if (config.kind === 'github-copilot') {
		return discoverCopilotModels(config, signal);
	}

	const url = joinUrl(config.baseUrl, '/models');
	const req: { method: string; auth?: { header: string; scheme: string; keyId: string } } = {
		method: 'GET'
	};
	if (await deps.hasKey(config.id)) {
		req.auth = { header: 'Authorization', scheme: 'Bearer', keyId: config.id };
	}

	const body = await getHttpTransport().request(
		{ url, method: req.method, auth: req.auth },
		signal
	);
	return parseModelIds(await readAll(body));
}

/**
 * Copilot discovery: the KeyStore grant is not itself usable against `/models` —
 * the endpoint requires the short-lived session token plus the mandatory Copilot
 * header set, on the session's authoritative endpoint host (research D5). A
 * missing grant throws `MissingKeyError`, the same typed error the transport's
 * auth resolution produces; session and HTTP failures surface as the usual
 * typed provider errors since the request still routes through the shared
 * transport seam.
 */
async function discoverCopilotModels(
	config: ProviderConfig,
	signal?: AbortSignal
): Promise<string[]> {
	const grant = await createBrowserKeyStore().get(config.id);
	if (!grant) throw new MissingKeyError(undefined, config.id);

	const session = await getCopilotSession(config.id, grant, signal);
	const url = joinUrl(session.endpoint || config.baseUrl, '/models');
	const body = await getHttpTransport().request(
		{
			url,
			method: 'GET',
			headers: { Authorization: `Bearer ${session.token}`, ...COPILOT_HEADERS }
		},
		signal
	);
	return parseCopilotModelIds(await readAll(body));
}

/**
 * Read a `ReadableStream<Uint8Array>` fully into a UTF-8 string. Exported so the
 * transport's streamed response can be consumed for one-shot JSON calls.
 */
export async function readAll(body: ReadableStream<Uint8Array>): Promise<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let out = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			out += decoder.decode(value, { stream: true });
		}
		out += decoder.decode();
	} finally {
		try {
			reader.releaseLock();
		} catch {
			/* already released */
		}
	}
	return out;
}

/** Pull the entry array out of a `/models` body: the OpenAI `{ data: [...] }`
 *  shape or a bare array; anything else contributes nothing. */
function extractCandidates(json: unknown): unknown[] {
	return Array.isArray(json)
		? json
		: Array.isArray((json as ModelsListResponse)?.data)
			? (json as ModelsListResponse).data!
			: [];
}

/**
 * Extract model IDs from a `/models` response body. Tolerates the OpenAI shape
 * (`{ data: [{ id }] }`) as well as a bare array of `{ id }` objects or strings.
 * Unparseable / unrecognized shapes yield an empty list.
 */
export function parseModelIds(body: string): string[] {
	let json: unknown;
	try {
		json = JSON.parse(body);
	} catch {
		return [];
	}

	const ids = new Set<string>();
	for (const entry of extractCandidates(json)) {
		let id: unknown;
		if (typeof entry === 'string') id = entry;
		else if (entry && typeof entry === 'object') {
			if ((entry as { type?: unknown }).type === 'embedding') continue;
			if ('id' in entry) id = (entry as { id: unknown }).id;
		}
		if (typeof id === 'string' && id.length > 0) ids.add(id);
	}
	return [...ids].sort((a, b) => a.localeCompare(b));
}

/**
 * Extract model IDs from a Copilot `/models` response body. Deliberately
 * stricter than `parseModelIds`: Copilot's catalog mixes in embeddings and
 * internal router objects, so an entry is kept only when `object === 'model'`
 * && `capabilities.type === 'chat'` && `policy.state !== 'disabled'` — and
 * never filtered on `model_picker_enabled` (known to report false for working
 * models). Unparseable / unrecognized shapes yield an empty list.
 */
export function parseCopilotModelIds(body: string): string[] {
	let json: unknown;
	try {
		json = JSON.parse(body);
	} catch {
		return [];
	}

	const ids = new Set<string>();
	for (const entry of extractCandidates(json)) {
		if (!entry || typeof entry !== 'object') continue;
		const model = entry as CopilotModelEntry;
		if (model.object !== 'model') continue;
		if (model.capabilities?.type !== 'chat') continue;
		if (model.policy?.state === 'disabled') continue;
		if (typeof model.id === 'string' && model.id.length > 0) ids.add(model.id);
	}
	return [...ids].sort((a, b) => a.localeCompare(b));
}

/** Join a base URL and a path, tolerating a trailing slash / leading slash. */
function joinUrl(base: string, path: string): string {
	return `${base.replace(/\/+$/, '')}${path}`;
}
