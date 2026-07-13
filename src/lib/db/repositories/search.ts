// FTS stub — search_fts table does not exist in PG (port deferred to P-pg-4).
// Pure helpers (SQL-agnostic) kept; FTS queries return [].

export type SearchKind = 'message' | 'chat' | 'lab' | 'quiz_question';

export interface SearchHit {
	kind: SearchKind;
	chatId: string;
	refId: string;
	quizId: string | null;
	title: string;
	chatTitle: string | null;
	rootId: string | null;
	snippetTitle: string;
	snippetBody: string;
	rank: number;
}

export function stripIndexNoise(md: string): string {
	return md
		.replace(/```mermaid[\s\S]*?```/g, '')
		.replace(/\$\$[\s\S]*?\$\$/g, '')
		.replace(/(?<!\$)\$(?!\$)[^$\n]+(?<!\$)\$(?!\$)/g, '');
}

export function buildMatchQuery(raw: string): string | null {
	const tokens = raw
		.split(/\s+/)
		.map((t) => t.trim())
		.filter(Boolean);
	if (!tokens.length) return null;
	return tokens.map((t) => `"${t}"`).join(' ');
}

export function renderSnippet(snip: string): { text: string; mark: boolean }[] {
	const segs: { text: string; mark: boolean }[] = [];
	let cur = '';
	let inMark = false;
	for (let i = 0; i < snip.length; i++) {
		const ch = snip[i];
		if (ch === '\x01') {
			if (cur) {
				segs.push({ text: cur, mark: false });
				cur = '';
			}
			inMark = true;
		} else if (ch === '\x02') {
			if (cur) {
				segs.push({ text: cur, mark: true });
				cur = '';
			}
			inMark = false;
		} else {
			cur += ch;
		}
	}
	if (cur) segs.push({ text: cur, mark: inMark });
	return segs;
}

export function deepLink(hit: SearchHit): string {
	switch (hit.kind) {
		case 'message':
			return `/chat/${hit.chatId}#m=${hit.refId}`;
		case 'chat':
			return `/chat/${hit.refId}`;
		case 'lab':
			return `/lab/${hit.refId}`;
		case 'quiz_question':
			return `/quiz/${hit.quizId}`;
	}
}

export const searchRepo = {
	async fts5Available(): Promise<boolean> {
		return false;
	},

	async search(
		_query: string,
		_opts?: { limit?: number; kinds?: SearchKind[] }
	): Promise<SearchHit[]> {
		return [];
	},

	async rebuildIndex(): Promise<void> {
		// no-op — FTS ported to tsvector/GIN/ts_headline in P-pg-4
	}
};
