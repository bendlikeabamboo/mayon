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
 */
import { getHttpTransport } from './http-transport';
import type { ProviderConfig } from './types';

export interface ModelDiscoveryDeps {
	/** True if an API key is configured for `id` (decides whether to attach auth). */
	hasKey: (id: string) => Promise<boolean>;
}

/** Shape of an OpenAI-compatible `/models` response (only the fields we read). */
interface ModelsListResponse {
	data?: Array<{ id?: unknown }>;
}

/**
 * Discover the available model IDs from a provider's `/models` endpoint. Returns
 * a de-duplicated, alphabetically-sorted list. Throws the same typed provider
 * errors as a chat request on HTTP/network failure (so the UI can format them
 * via `formatProviderError`).
 */
export async function discoverModels(
	config: ProviderConfig,
	deps: ModelDiscoveryDeps,
	signal?: AbortSignal
): Promise<string[]> {
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

	const candidates: unknown[] = Array.isArray(json)
		? json
		: Array.isArray((json as ModelsListResponse)?.data)
			? (json as ModelsListResponse).data!
			: [];

	const ids = new Set<string>();
	for (const entry of candidates) {
		let id: unknown;
		if (typeof entry === 'string') id = entry;
		else if (entry && typeof entry === 'object' && 'id' in entry)
			id = (entry as { id: unknown }).id;
		if (typeof id === 'string' && id.length > 0) ids.add(id);
	}
	return [...ids].sort((a, b) => a.localeCompare(b));
}

/** Join a base URL and a path, tolerating a trailing slash / leading slash. */
function joinUrl(base: string, path: string): string {
	return `${base.replace(/\/+$/, '')}${path}`;
}
