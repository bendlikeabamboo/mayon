import sqlite3InitModule, { type SqlValue } from '@sqlite.org/sqlite-wasm';
import type { QueryResult, StorageDriver } from './types';

type Mod = Awaited<ReturnType<typeof sqlite3InitModule>>;
type Db = InstanceType<Mod['oo1']['DB']>;

let modulePromise: Promise<Mod> | null = null;

async function loadModule() {
	if (modulePromise) return modulePromise;
	modulePromise = sqlite3InitModule();
	return modulePromise;
}

function takeSnapshot(mod: Mod, db: Db): Uint8Array {
	const capi = mod.capi as unknown as Record<string, (...args: unknown[]) => unknown>;
	const state = (mod.wasm as unknown as { scopedAllocPush(): unknown }).scopedAllocPush();
	try {
		const piSize = (mod.wasm as unknown as { scopedAllocPtr(): number }).scopedAllocPtr();
		const dataPtr = capi.sqlite3_serialize(db.pointer as number, 'main', piSize, 0) as number;
		const size = (mod.wasm as unknown as { getPtrValue(p: number): number }).getPtrValue(piSize);
		if (dataPtr && size > 0) {
			const heap = (mod.wasm as unknown as { heap8u(): Uint8Array }).heap8u();
			return new Uint8Array(heap.buffer, dataPtr, size).slice();
		}
	} finally {
		(mod.wasm as unknown as { scopedAllocPop(s: unknown): void }).scopedAllocPop(state);
	}
	return new Uint8Array(0);
}

export async function createMemoryDriver(): Promise<StorageDriver> {
	const mod = await loadModule();
	const { oo1, capi, wasm } = mod;
	let db: Db = new oo1.DB(':memory:');
	db.exec('PRAGMA foreign_keys = ON');

	return {
		async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
			const rows = db.exec({
				sql,
				bind: params as SqlValue[],
				rowMode: 'array',
				returnValue: 'resultRows'
			}) as SqlValue[][];
			return { rows: rows as T[] };
		},
		async exec(sql: string): Promise<void> {
			db.exec({ sql });
		},
		async batch(stmts): Promise<QueryResult[]> {
			db.exec('BEGIN');
			try {
				const out = stmts.map((s) => {
					const rows = db.exec({
						sql: s.sql,
						bind: (s.params ?? []) as SqlValue[],
						rowMode: 'array',
						returnValue: 'resultRows'
					}) as SqlValue[][];
					return { rows };
				});
				db.exec('COMMIT');
				return out;
			} catch (err) {
				try {
					db.exec('ROLLBACK');
				} catch {
					// ignore rollback errors
				}
				throw err;
			}
		},
		async snapshot(): Promise<Uint8Array> {
			return takeSnapshot(mod, db);
		},
		async restore(bytes: Uint8Array): Promise<void> {
			db.close();
			db = new oo1.DB(':memory:');
			db.exec('PRAGMA foreign_keys = ON');
			const dataPtr = wasm.alloc(bytes.byteLength);
			wasm.heap8u().set(bytes, dataPtr);
			const rc = capi.sqlite3_deserialize(
				db.pointer as number,
				'main',
				dataPtr,
				bytes.byteLength,
				bytes.byteLength,
				2
			);
			if (rc !== 0) {
				wasm.dealloc(dataPtr);
				throw new Error(`sqlite3_deserialize failed: ${capi.sqlite3_errstr(rc)}`);
			}
		},
		async dispose(): Promise<void> {
			db.close();
			db = new oo1.DB(':memory:');
			db.exec('PRAGMA foreign_keys = ON');
		}
	};
}
