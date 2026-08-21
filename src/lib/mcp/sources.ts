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

export function extractSources(detail: unknown): ToolSource[] {
	const out = new Map<string, ToolSource>();
	if (!detail || typeof detail !== 'object') return [];
	const content = (detail as { content?: unknown }).content;
	if (!Array.isArray(content)) return [];

	for (const item of content) {
		if (!item || typeof item !== 'object') continue;
		const text = (item as { text?: unknown }).text;
		if (typeof text !== 'string') continue;
		try {
			collect(JSON.parse(text), out);
		} catch {
			scanText(text, out);
		}
	}
	return [...out.values()].slice(0, MAX_SOURCES);
}
