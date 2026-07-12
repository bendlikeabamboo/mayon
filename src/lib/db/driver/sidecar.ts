import type { BatchStatement, QueryResult, StorageDriver } from './types';
import { sidecarClient } from '$lib/sidecar/client';

export function createSidecarDriver(): StorageDriver {
	async function post(body: unknown): Promise<unknown> {
		const res = await sidecarClient.http('/api/db/query', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) {
			const errBody = (await res.json().catch(() => ({ error: 'sidecar DB request failed' }))) as {
				error: string;
			};
			throw new Error(errBody.error);
		}
		return res.json();
	}

	return {
		async query<T = unknown>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
			const body = (await post({ op: 'query', sql, params })) as { rows: unknown[] };
			return { rows: body.rows as T[] };
		},

		async batch(stmts: BatchStatement[]): Promise<QueryResult[]> {
			const body = (await post({ op: 'batch', stmts })) as { results: { rows: unknown[] }[] };
			return body.results.map((r) => ({ rows: r.rows }));
		},

		async exec(sql: string): Promise<void> {
			await post({ op: 'exec', sql });
		}
	};
}
