import type { DbQueryResult } from '@mayon/shared';
import { serverClient } from '$lib/server/client';

async function post(body: unknown): Promise<unknown> {
	const res = await serverClient.http('/api/sandbox/query', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		const errBody = (await res.json().catch(() => ({ error: 'server DB request failed' }))) as {
			error: string;
			detail?: string;
		};
		throw new Error(errBody.detail ?? errBody.error);
	}
	return res.json();
}

export async function sandboxQuery(sql: string, params?: unknown[]): Promise<DbQueryResult> {
	return post({ op: 'query', sql, params }) as Promise<DbQueryResult>;
}

export async function sandboxExec(
	sql: string
): Promise<{ changes: number; lastInsertRowid: number | bigint | null }> {
	return post({ op: 'exec', sql }) as Promise<{
		changes: number;
		lastInsertRowid: number | bigint | null;
	}>;
}

export async function sandboxTables(): Promise<string[]> {
	const result = await sandboxQuery(
		"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
	);
	return result.rows.map((r) => r[0] as string);
}
