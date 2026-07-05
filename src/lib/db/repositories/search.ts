import { getDriver } from '$lib/db/driver/client';
import type { BatchStatement } from '$lib/db/driver/types';

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

const BATCH_SIZE = 100;

function chunked<T>(items: T[], size: number, map: (item: T) => BatchStatement): BatchStatement[] {
	const stmts: BatchStatement[] = [];
	for (let i = 0; i < items.length; i += size) {
		stmts.push(...items.slice(i, i + size).map(map));
	}
	return stmts;
}

export const searchRepo = {
	async fts5Available(): Promise<boolean> {
		const d = getDriver();
		try {
			await d.exec('CREATE VIRTUAL TABLE _fts_probe USING fts5(x)');
			await d.exec("INSERT INTO _fts_probe VALUES('test')");
			await d.query("SELECT * FROM _fts_probe WHERE _fts_probe MATCH 'test'");
			await d.exec('DROP TABLE _fts_probe');
			return true;
		} catch {
			return false;
		}
	},

	async search(
		query: string,
		opts?: { limit?: number; kinds?: SearchKind[] }
	): Promise<SearchHit[]> {
		const match = buildMatchQuery(query);
		if (!match) return [];

		const limit = opts?.limit ?? 50;
		const kinds = opts?.kinds;

		let sql = `SELECT
  search_fts.kind, search_fts.chat_id, search_fts.ref_id, search_fts.quiz_id,
  search_fts.title, c.title AS chat_title, c.root_id,
  snippet(search_fts, 2, char(1), char(2), '…', 12) AS snippet_body,
  snippet(search_fts, 1, char(1), char(2), '…', 8) AS snippet_title,
  bm25(search_fts) AS rank
FROM search_fts
LEFT JOIN chats c ON c.id = search_fts.chat_id
WHERE search_fts MATCH ?1`;

		const params: unknown[] = [match];

		if (kinds?.length) {
			const placeholders = kinds.map(() => '?').join(', ');
			sql += ` AND search_fts.kind IN (${placeholders})`;
			params.push(...kinds);
		}

		sql += '\nORDER BY rank\nLIMIT ?2';
		params.push(limit);

		try {
			const { rows } = await getDriver().query<unknown[]>(sql, params);
			return rows.map((row) => ({
				kind: row[0] as SearchKind,
				chatId: row[1] as string,
				refId: row[2] as string,
				quizId: (row[3] as string) ?? null,
				title: (row[4] as string) ?? '',
				chatTitle: (row[5] as string) ?? null,
				rootId: (row[6] as string) ?? null,
				snippetBody: (row[7] as string) ?? '',
				snippetTitle: (row[8] as string) ?? '',
				rank: (row[9] as number) ?? 0
			}));
		} catch {
			return [];
		}
	},

	async rebuildIndex(): Promise<void> {
		const d = getDriver();

		await d.exec('DELETE FROM search_fts');

		const { rows: chatRows } = await d.query<unknown[]>('SELECT id, title FROM chats');
		await d.batch(
			chunked(chatRows, BATCH_SIZE, (r) => ({
				sql: 'INSERT INTO search_fts(kind,title,body,chat_id,ref_id,quiz_id) VALUES(?,?,?,?,?,?)',
				params: ['chat', stripIndexNoise(r[1] as string), '', r[0], r[0], null]
			}))
		);

		const { rows: msgRows } = await d.query<unknown[]>('SELECT id, chat_id, content FROM messages');
		await d.batch(
			chunked(msgRows, BATCH_SIZE, (r) => ({
				sql: 'INSERT INTO search_fts(kind,title,body,chat_id,ref_id,quiz_id) VALUES(?,?,?,?,?,?)',
				params: ['message', '', stripIndexNoise(r[2] as string), r[1], r[0], null]
			}))
		);

		const { rows: labRows } = await d.query<unknown[]>(
			'SELECT id, chat_id, title, content FROM labs'
		);
		await d.batch(
			chunked(labRows, BATCH_SIZE, (r) => ({
				sql: 'INSERT INTO search_fts(kind,title,body,chat_id,ref_id,quiz_id) VALUES(?,?,?,?,?,?)',
				params: [
					'lab',
					stripIndexNoise(r[2] as string),
					stripIndexNoise(r[3] as string),
					r[1],
					r[0],
					null
				]
			}))
		);

		const { rows: qqRows } = await d.query<unknown[]>(
			'SELECT qq.id, qq.quiz_id, qq.prompt, q.chat_id FROM quiz_questions qq JOIN quizzes q ON q.id = qq.quiz_id'
		);
		await d.batch(
			chunked(qqRows, BATCH_SIZE, (r) => ({
				sql: 'INSERT INTO search_fts(kind,title,body,chat_id,ref_id,quiz_id) VALUES(?,?,?,?,?,?)',
				params: ['quiz_question', '', stripIndexNoise(r[2] as string), r[3], r[0], r[1]]
			}))
		);
	}
};
