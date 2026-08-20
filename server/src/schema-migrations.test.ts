import { describe, expect, it, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { drizzle } from 'drizzle-orm/pglite';
import { SCHEMA_MIGRATIONS } from './schema-migrations';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../../drizzle');

interface MockClient {
	query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
	release(): void;
}

function makeClient(pgl: PGlite): MockClient {
	return {
		async query(text: string, params?: unknown[]) {
			const res = await pgl.query(text, params);
			return { rows: res.rows as Record<string, unknown>[] };
		},
		release() {}
	};
}

async function setupDb(): Promise<PGlite> {
	const pgl = new PGlite();
	const db = drizzle(pgl);
	await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
	await pgl.query(
		`INSERT INTO chats (id, root_id, title, depth, created_at, updated_at)
		 VALUES ('c1', 'c1', 'test chat', 0, 1, 1)`
	);
	return pgl;
}

async function insertRow(
	pgl: PGlite,
	row: {
		id: string;
		chatId: string;
		role: string;
		content: string;
		ord: number;
		toolCallId?: string | null;
		toolName?: string | null;
		metadata?: string | null;
		kind?: string | null;
	}
): Promise<void> {
	const cols: string[] = ['id', 'chat_id', 'role', 'content', 'ord', 'created_at'];
	const vals: unknown[] = [row.id, row.chatId, row.role, row.content, row.ord, 1];
	const placeholders: string[] = ['$1', '$2', '$3', '$4', '$5', '$6'];

	if (row.toolCallId !== undefined) {
		cols.push('tool_call_id');
		vals.push(row.toolCallId);
		placeholders.push(`$${vals.length}`);
	}
	if (row.toolName !== undefined) {
		cols.push('tool_name');
		vals.push(row.toolName);
		placeholders.push(`$${vals.length}`);
	}
	if (row.metadata !== undefined) {
		cols.push('metadata');
		vals.push(row.metadata);
		placeholders.push(`$${vals.length}`);
	}
	if (row.kind !== undefined) {
		cols.push('kind');
		vals.push(row.kind);
		placeholders.push(`$${vals.length}`);
	}

	await pgl.query(
		`INSERT INTO messages (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
		vals
	);
}

describe('backfillKinds migration', () => {
	let pgl: PGlite;
	let client: MockClient;

	beforeEach(async () => {
		pgl = await setupDb();
		client = makeClient(pgl);
	});

	it('classifies rule 1: role=user → user_message', async () => {
		await insertRow(pgl, { id: 'm1', chatId: 'c1', role: 'user', content: 'hi', ord: 0 });
		await SCHEMA_MIGRATIONS[0].migrate!(client);
		const { rows } = await pgl.query(`SELECT kind FROM messages WHERE id = 'm1'`);
		expect(rows[0].kind).toBe('user_message');
	});

	it('classifies rule 2: assistant + toolCallId + present_choices → choices', async () => {
		await insertRow(pgl, {
			id: 'm2',
			chatId: 'c1',
			role: 'assistant',
			content: '',
			ord: 0,
			toolCallId: 'tc1',
			toolName: 'present_choices'
		});
		await SCHEMA_MIGRATIONS[0].migrate!(client);
		const { rows } = await pgl.query(`SELECT kind FROM messages WHERE id = 'm2'`);
		expect(rows[0].kind).toBe('choices');
	});

	it('classifies rule 3: assistant + toolCallId (not present_choices) → tool_call', async () => {
		await insertRow(pgl, {
			id: 'm3',
			chatId: 'c1',
			role: 'assistant',
			content: '',
			ord: 0,
			toolCallId: 'tc2',
			toolName: 'read_file'
		});
		await SCHEMA_MIGRATIONS[0].migrate!(client);
		const { rows } = await pgl.query(`SELECT kind FROM messages WHERE id = 'm3'`);
		expect(rows[0].kind).toBe('tool_call');
	});

	it('classifies rule 4: tool + present_choices → tool_result', async () => {
		await insertRow(pgl, {
			id: 'm4',
			chatId: 'c1',
			role: 'tool',
			content: 'result',
			ord: 0,
			toolCallId: 'tc1',
			toolName: 'present_choices'
		});
		await SCHEMA_MIGRATIONS[0].migrate!(client);
		const { rows } = await pgl.query(`SELECT kind FROM messages WHERE id = 'm4'`);
		expect(rows[0].kind).toBe('tool_result');
	});

	it('classifies rule 5: tool (not present_choices) → tool_result', async () => {
		await insertRow(pgl, {
			id: 'm5',
			chatId: 'c1',
			role: 'tool',
			content: 'file contents',
			ord: 0,
			toolCallId: 'tc2',
			toolName: 'read_file'
		});
		await SCHEMA_MIGRATIONS[0].migrate!(client);
		const { rows } = await pgl.query(`SELECT kind FROM messages WHERE id = 'm5'`);
		expect(rows[0].kind).toBe('tool_result');
	});

	it('classifies rule 6: assistant + no toolCallId → assistant_message', async () => {
		await insertRow(pgl, {
			id: 'm6',
			chatId: 'c1',
			role: 'assistant',
			content: 'hello',
			ord: 0
		});
		await SCHEMA_MIGRATIONS[0].migrate!(client);
		const { rows } = await pgl.query(`SELECT kind FROM messages WHERE id = 'm6'`);
		expect(rows[0].kind).toBe('assistant_message');
	});

	it('classifies rule 7: system → assistant_message', async () => {
		await insertRow(pgl, {
			id: 'm7',
			chatId: 'c1',
			role: 'system',
			content: 'system note',
			ord: 0
		});
		await SCHEMA_MIGRATIONS[0].migrate!(client);
		const { rows } = await pgl.query(`SELECT kind FROM messages WHERE id = 'm7'`);
		expect(rows[0].kind).toBe('assistant_message');
	});

	it('throws on unclassifiable row (FR-013)', async () => {
		await insertRow(pgl, { id: 'm8', chatId: 'c1', role: 'user', content: 'ok', ord: 0 });
		await pgl.query(`UPDATE messages SET role = 'bogus' WHERE id = 'm8'`);
		await expect(SCHEMA_MIGRATIONS[0].migrate!(client)).rejects.toThrow(
			/1 message\(s\) could not be classified/
		);
	});

	it('is idempotent: second run is no-op', async () => {
		await insertRow(pgl, { id: 'm1', chatId: 'c1', role: 'user', content: 'hi', ord: 0 });
		await insertRow(pgl, {
			id: 'm2',
			chatId: 'c1',
			role: 'assistant',
			content: 'hey',
			ord: 1
		});
		await SCHEMA_MIGRATIONS[0].migrate!(client);
		const first = await pgl.query(`SELECT kind FROM messages ORDER BY ord`);
		await SCHEMA_MIGRATIONS[0].migrate!(client);
		const second = await pgl.query(`SELECT kind FROM messages ORDER BY ord`);
		expect(second.rows).toEqual(first.rows);
	});

	it('enforces NOT NULL after backfill', async () => {
		await insertRow(pgl, { id: 'm1', chatId: 'c1', role: 'user', content: 'hi', ord: 0 });
		await SCHEMA_MIGRATIONS[0].migrate!(client);
		await expect(
			pgl.query(
				`INSERT INTO messages (id, chat_id, role, content, ord, created_at) VALUES ('m2', 'c1', 'user', 'x', 1, 1)`
			)
		).rejects.toThrow(/null value in column.*kind/i);
	});

	it('preserves id, content, ord, metadata untouched', async () => {
		await insertRow(pgl, {
			id: 'm-keep',
			chatId: 'c1',
			role: 'assistant',
			content: 'original text',
			ord: 42,
			metadata: '{"reasoning":"some thoughts"}'
		});
		await SCHEMA_MIGRATIONS[0].migrate!(client);
		const { rows } = await pgl.query(
			`SELECT id, content, ord, metadata, kind FROM messages WHERE id = 'm-keep'`
		);
		const r = rows[0]!;
		expect(r.id).toBe('m-keep');
		expect(r.content).toBe('original text');
		expect(Number(r.ord)).toBe(42);
		expect(r.metadata).toBe('{"reasoning":"some thoughts"}');
		expect(r.kind).toBe('assistant_message');
	});
});
