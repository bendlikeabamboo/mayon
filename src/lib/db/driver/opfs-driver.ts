import type { QueryResult, StorageDriver } from './types';

interface WorkerMsg {
	id: number;
	ok: boolean;
	rows?: unknown[];
	results?: QueryResult[];
	bytes?: ArrayBuffer;
	validate?: { ok: boolean; reason?: string };
	error?: string;
}

interface Pending {
	resolve: (v: WorkerMsg) => void;
	reject: (e: Error) => void;
}

export function createOpfsDriver(): StorageDriver {
	const worker = new Worker(new URL('./opfs-worker.ts', import.meta.url), { type: 'module' });

	const pending = new Map<number, Pending>();
	let nextId = 1;

	const ready = new Promise<void>((resolve, reject) => {
		const onReady = (e: MessageEvent<WorkerMsg>) => {
			if (e.data?.id !== -1) return;
			worker.removeEventListener('message', onReady);
			if (e.data.ok) {
				resolve();
			} else {
				reject(new Error(e.data.error ?? 'OPFS init failed'));
			}
		};
		worker.addEventListener('message', onReady);
	});

	worker.addEventListener('error', (e) => {
		const err = new Error(e.message || 'OPFS worker failed to load');
		for (const p of pending.values()) p.reject(err);
		pending.clear();
	});

	worker.addEventListener('message', (e: MessageEvent<WorkerMsg>) => {
		const msg = e.data;
		if (!msg || msg.id === -1) return;
		const p = pending.get(msg.id);
		if (!p) return;
		pending.delete(msg.id);
		if (msg.ok) {
			p.resolve(msg);
		} else {
			p.reject(new Error(msg.error ?? 'unknown error'));
		}
	});

	async function send(
		op: 'query' | 'exec' | 'batch' | 'snapshot' | 'restore' | 'validate',
		payload: Record<string, unknown>,
		transfer?: Transferable[]
	): Promise<WorkerMsg> {
		await ready;
		const id = nextId++;
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
			worker.postMessage({ id, op, ...payload }, transfer as unknown as StructuredSerializeOptions);
		});
	}

	return {
		async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
			const r = await send('query', { sql, params });
			return { rows: (r.rows ?? []) as T[] };
		},
		async exec(sql: string): Promise<void> {
			await send('exec', { sql });
		},
		async batch(stmts): Promise<QueryResult[]> {
			const r = await send('batch', { stmts });
			return r.results ?? [];
		},
		async snapshot(): Promise<Uint8Array> {
			const r = await send('snapshot', {});
			return new Uint8Array(r.bytes!);
		},
		async restore(bytes: Uint8Array): Promise<void> {
			await send('restore', { bytes: bytes.buffer as ArrayBuffer }, [bytes.buffer]);
		},
		async dispose(): Promise<void> {
			worker.terminate();
		}
	};
}
