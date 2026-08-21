/**
 * Extract cited web sources ({title, url}) from a persisted MCP tool-result
 * detail object — `{ serverId, toolName, content: McpContent[] }` as stored by
 * mount.ts. Brave Search MCP tools return JSON (in text) whose result items
 * carry `title`/`url` fields. Pure, never throws; unusable input yields [].
 */
export interface ToolSource {
	title: string;
	url: string;
}

const MAX_SOURCES = 10;
const URL_RE = /https?:\/\/[^\s"'<>)]+/g;

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

function isHttpUrl(value: unknown): value is string {
	return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function collect(value: unknown, out: Map<string, ToolSource>): void {
	if (out.size >= MAX_SOURCES) return;
	if (Array.isArray(value)) {
		for (const item of value) collect(item, out);
		return;
	}
	if (value && typeof value === 'object') {
		const obj = value as Record<string, unknown>;
		if (isHttpUrl(obj.url)) {
			const url = obj.url;
			if (!out.has(url)) {
				const title =
					typeof obj.title === 'string' && obj.title.trim()
						? obj.title.trim().slice(0, 120)
						: hostOf(url);
				out.set(url, { title, url });
			}
		}
		// Brave image/video results carry the page (not the media) in `source`/`origin`.
		for (const key of ['source', 'origin']) {
			const linked = obj[key];
			if (isHttpUrl(linked) && linked !== obj.url && !out.has(linked)) {
				out.set(linked, { title: hostOf(linked), url: linked });
			}
		}
		for (const [key, child] of Object.entries(obj)) {
			if (out.size >= MAX_SOURCES) return;
			if (key === 'url' || key === 'title' || key === 'source' || key === 'origin') continue;
			collect(child, out);
		}
	}
}

function scanText(text: string, out: Map<string, ToolSource>): void {
	for (const match of text.matchAll(URL_RE)) {
		if (out.size >= MAX_SOURCES) return;
		const url = match[0];
		if (!out.has(url)) out.set(url, { title: hostOf(url), url });
	}
}

const SCALAR_RE = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/;

/**
 * Tolerant scan of a stored text part into its top-level JSON values.
 * Multi-part MCP results are stored as concatenated JSON (mount.ts joins
 * content parts with ''), so a whole-string parse is tried first; on
 * failure a string/escape-aware bracket-depth scan splits the values apart.
 * A partial trailing value is dropped; unparseable input yields [].
 * Never throws.
 */
export function scanJsonValues(text: string): unknown[] {
	const trimmed = text.trim();
	if (!trimmed) return [];
	try {
		return [JSON.parse(trimmed)];
	} catch {
		// fall through to the tolerant scan
	}
	const values: unknown[] = [];
	const len = trimmed.length;
	let i = 0;
	while (i < len) {
		while (i < len && /[\s,]/.test(trimmed[i]!)) i++;
		if (i >= len) break;
		const start = i;
		const c = trimmed[i]!;
		let end = -1;
		if (c === '{' || c === '[') {
			let depth = 0;
			let inString = false;
			let escaped = false;
			for (; i < len; i++) {
				const ch = trimmed[i]!;
				if (inString) {
					if (escaped) escaped = false;
					else if (ch === '\\') escaped = true;
					else if (ch === '"') inString = false;
					continue;
				}
				if (ch === '"') inString = true;
				else if (ch === '{' || ch === '[') depth++;
				else if (ch === '}' || ch === ']') {
					depth--;
					if (depth === 0) {
						end = ++i;
						break;
					}
				}
			}
		} else if (c === '"') {
			i++;
			let escaped = false;
			for (; i < len; i++) {
				const ch = trimmed[i]!;
				if (escaped) {
					escaped = false;
					continue;
				}
				if (ch === '\\') escaped = true;
				else if (ch === '"') {
					end = ++i;
					break;
				}
			}
		} else {
			const match = SCALAR_RE.exec(trimmed.slice(i));
			if (match) {
				end = i + match[0].length;
				i = end;
			} else {
				i++; // garbage char: skip so the scan always progresses
				continue;
			}
		}
		if (end > start) {
			try {
				values.push(JSON.parse(trimmed.slice(start, end)));
			} catch {
				// unparseable segment: drop it
			}
		} else if (end === -1) {
			break; // unterminated value: drop the tail
		}
	}
	return values;
}

export function extractSources(detail: unknown): ToolSource[] {
	const out = new Map<string, ToolSource>();
	if (!detail || typeof detail !== 'object') return [];
	const content = (detail as { content?: unknown }).content;
	if (!Array.isArray(content)) return [];

	for (const item of content) {
		if (!item || typeof item !== 'object') continue;
		const text = (item as { text?: unknown }).text;
		if (typeof text !== 'string') continue;
		const values = scanJsonValues(text);
		if (values.length > 0) {
			for (const value of values) collect(value, out);
		} else {
			scanText(text, out);
		}
	}
	return [...out.values()].slice(0, MAX_SOURCES);
}

/** Presentation card projected from a parsed result value (never persisted). */
export interface LinkCard {
	url: string;
	title: string;
	host: string;
	description?: string;
	snippet?: string;
}

/** Scan bound for card projection — pathological payloads must not loop long. */
const MAX_CARD_SCAN = 50;

function oneLine(text: string): string {
	return text
		.replace(/<[^>]*>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = obj[key];
		if (typeof value === 'string' && value.trim()) return oneLine(value);
	}
	return undefined;
}

function collectCard(value: unknown, out: Map<string, LinkCard>): void {
	if (out.size >= MAX_CARD_SCAN) return;
	if (typeof value === 'string') {
		if (isHttpUrl(value) && !out.has(value)) {
			out.set(value, { url: value, title: hostOf(value), host: hostOf(value) });
		}
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectCard(item, out);
		return;
	}
	if (value && typeof value === 'object') {
		const obj = value as Record<string, unknown>;
		if (isHttpUrl(obj.url) && !out.has(obj.url)) {
			const url = obj.url;
			const host = hostOf(url);
			const title =
				typeof obj.title === 'string' && obj.title.trim() ? oneLine(obj.title).slice(0, 120) : host;
			const description = firstString(obj, ['description', 'text']);
			const snippet = firstString(obj, ['snippet', 'extra_snippets']);
			out.set(url, { url, title, host, description, snippet });
		}
		// Page urls carried alongside media urls (Brave image/video shape).
		for (const key of ['source', 'origin']) {
			const linked = obj[key];
			if (isHttpUrl(linked) && linked !== obj.url && !out.has(linked)) {
				out.set(linked, { url: linked, title: hostOf(linked), host: hostOf(linked) });
			}
		}
		for (const [key, child] of Object.entries(obj)) {
			if (out.size >= MAX_CARD_SCAN) return;
			if (key === 'url' || key === 'title' || key === 'source' || key === 'origin') continue;
			collectCard(child, out);
		}
	}
}

/**
 * Project parsed result values into presentation link cards. Shares the
 * url primitives (and the scan) with extractSources so cards and sources
 * can never disagree about the payload. Dedupes by URL; bounded scan.
 */
export function collectCards(values: unknown[]): LinkCard[] {
	const out = new Map<string, LinkCard>();
	for (const value of values) collectCard(value, out);
	return [...out.values()];
}
