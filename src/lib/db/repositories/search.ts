import { getDriver } from '$lib/db/driver/client';

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

const HEADLINE_BODY = 'MaxWords=12 MinWords=5 ShortWord=2 StartSel=\\x01 StopSel=\\x02';
const HEADLINE_TITLE = 'MaxWords=8 MinWords=3 ShortWord=2 StartSel=\\x01 StopSel=\\x02';

function buildSearchSql(kinds?: SearchKind[]): { sql: string; params: unknown[] } {
	const parts: string[] = [];
	const params: unknown[] = [];

	let pIdx = 1;
	parts.push(`WITH tsq AS (SELECT websearch_to_tsquery('simple', $${pIdx}) AS q)`);
	params.push(pIdx === 1 ? undefined : undefined);
	params.length = 0;
	parts.length = 0;

	pIdx = 1;
	const paramSlots: unknown[] = [];

	parts.push(`WITH tsq AS (SELECT websearch_to_tsquery('simple', $${pIdx}) AS q)`);
	paramSlots.push(null as unknown);
	pIdx++;

	parts.push(
		`SELECT kind, chat_id, ref_id, quiz_id, title, chat_title, root_id, snippet_body, snippet_title, rank FROM (`
	);
	parts.push(
		`SELECT 'message'::text AS kind, m.chat_id, m.id AS ref_id, NULL::text AS quiz_id, ''::text AS title, c.title AS chat_title, c.root_id, ts_headline('simple', m.content, tsq.q, E'${HEADLINE_BODY}') AS snippet_body, ''::text AS snippet_title, ts_rank_cd(m.search_vec, tsq.q) AS rank FROM messages m CROSS JOIN tsq JOIN chats c ON c.id = m.chat_id WHERE m.search_vec @@ tsq.q`
	);
	parts.push(
		`UNION ALL SELECT 'chat'::text, c.id, c.id, NULL::text, c.title, c.title, c.root_id, ''::text, ts_headline('simple', c.title, tsq.q, E'${HEADLINE_TITLE}'), ts_rank_cd(c.search_vec, tsq.q) FROM chats c CROSS JOIN tsq WHERE c.search_vec @@ tsq.q`
	);
	parts.push(
		`UNION ALL SELECT 'lab'::text, l.chat_id, l.id, NULL::text, l.title, c.title, c.root_id, ts_headline('simple', l.content, tsq.q, E'${HEADLINE_BODY}'), ts_headline('simple', l.title, tsq.q, E'${HEADLINE_TITLE}'), ts_rank_cd(l.search_vec, tsq.q) FROM labs l CROSS JOIN tsq JOIN chats c ON c.id = l.chat_id WHERE l.search_vec @@ tsq.q`
	);
	parts.push(
		`UNION ALL SELECT 'quiz_question'::text, qz.chat_id, qq.id, qq.quiz_id, ''::text, c.title, c.root_id, ts_headline('simple', qq.prompt, tsq.q, E'${HEADLINE_BODY}'), ''::text, ts_rank_cd(qq.search_vec, tsq.q) FROM quiz_questions qq CROSS JOIN tsq JOIN quizzes qz ON qz.id = qq.quiz_id JOIN chats c ON c.id = qz.chat_id WHERE qq.search_vec @@ tsq.q`
	);
	parts.push(`) AS hits`);

	const kindPlaceholders: string[] = [];
	if (kinds && kinds.length > 0) {
		for (const k of kinds) {
			kindPlaceholders.push(`$${pIdx}`);
			paramSlots.push(k);
			pIdx++;
		}
		parts.push(`WHERE hits.kind IN (${kindPlaceholders.join(', ')})`);
	}

	parts.push(`ORDER BY rank DESC`);
	parts.push(`LIMIT $${pIdx}`);
	paramSlots.push(null as unknown);

	return { sql: parts.join('\n'), params: paramSlots };
}

export const searchRepo = {
	async searchAvailable(): Promise<boolean> {
		try {
			const { rows } = await getDriver().query<unknown[]>(
				"SELECT EXISTS(SELECT 1 FROM pg_ts_config WHERE cfgname='simple') AS ok"
			);
			return Boolean(rows[0]?.[0]);
		} catch {
			return false;
		}
	},

	async search(
		query: string,
		opts?: { limit?: number; kinds?: SearchKind[] }
	): Promise<SearchHit[]> {
		if (!query.trim()) return [];
		const limit = opts?.limit ?? 50;
		const { sql, params } = buildSearchSql(opts?.kinds);
		params[0] = query;
		params[params.length - 1] = limit;

		try {
			const { rows } = await getDriver().query<unknown[]>(sql, params);
			return rows.map((row) => ({
				kind: row[0] as SearchKind,
				chatId: String(row[1]),
				refId: String(row[2]),
				quizId: row[3] != null ? String(row[3]) : null,
				title: String(row[4]),
				chatTitle: row[5] != null ? String(row[5]) : null,
				rootId: row[6] != null ? String(row[6]) : null,
				snippetBody: String(row[7]),
				snippetTitle: String(row[8]),
				rank: Number(row[9])
			}));
		} catch {
			return [];
		}
	},

	async rebuildIndex(): Promise<void> {
		// No-op — search_vec GENERATED columns self-maintain (P-pg-4).
	}
};
