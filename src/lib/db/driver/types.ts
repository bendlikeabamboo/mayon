/**
 * The single storage seam. Drizzle + schema + repositories live on the main thread;
 * drivers are dumb SQL executors (the OPFS worker literally only runs SQL over
 * `postMessage`). The same contract is satisfied by two runtimes:
 *   - browser: sqlite-wasm + OPFS (in a Web Worker)
 *   - tests:   in-memory sql.js
 */
export interface QueryResult<T = unknown> {
	columns?: string[];
	rows: T[];
}

export interface BatchStatement {
	sql: string;
	params?: unknown[];
}

export interface StorageDriver {
	/** Run a statement that returns rows (SELECT). Params use SQLite `?` placeholders. */
	query<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
	/** Run many statements in one round-trip; returns per-statement row sets. */
	batch(stmts: BatchStatement[]): Promise<QueryResult[]>;
	/** Run a statement that returns no rows (DDL / INSERT / UPDATE / DELETE). */
	exec(sql: string): Promise<void>;
	/** Whole-DB snapshot as bytes (browser + in-memory). */
	snapshot?(): Promise<Uint8Array>;
	/** Replace the live DB with `bytes` (browser + in-memory). */
	restore?(bytes: Uint8Array): Promise<void>;
	/** Release the underlying connection/worker so a fresh driver can replace it. */
	dispose?(): Promise<void>;
	/** One-time init (e.g. connect + create schema + run migrations). */
	init?(): Promise<void>;
}

/** A migration as bundled at build time (mirrors drizzle's on-disk format, minus `fs`). */
export interface MigrationMeta {
	/** Statements, pre-split on drizzle's `--> statement-breakpoint` marker. */
	sql: string[];
	/** Origin timestamp from the journal (`when`) — used to order/track applied migrations. */
	folderMillis: number;
	/** sha256 of the raw migration SQL (parity with drizzle's `__drizzle_migrations.hash`). */
	hash: string;
}
