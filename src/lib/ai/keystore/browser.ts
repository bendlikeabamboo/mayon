/**
 * Browser secret store backed by a hand-rolled IndexedDB database (no new dep).
 *
 * Browsers have no secure enclave, so this store — unlike the desktop one — CAN
 * read a key back via `get`: the fetch transport needs the plaintext to inject
 * it into the `Authorization` / `x-api-key` header. The key never leaves the
 * origin (it lives in this origin's IndexedDB, not the settings SQLite table).
 *
 * Schema: db `"mayon"` v1, object store `"providerKeys"` with inline key `id`,
 * value shape `{ id, key }`.
 */
import type { KeyStore } from './types';

/**
 * `KeyStore` plus `get` — the extra capability the browser fetch transport
 * needs because it must resolve the secret into a request header in JS.
 */
export interface BrowserKeyStore extends KeyStore {
	/** Read the stored key for `id` (null if unset). Browser-only: no secure enclave. */
	get(id: string): Promise<string | null>;
}

const DB_NAME = 'mayon';
const DB_VERSION = 1;
const STORE = 'providerKeys';

interface KeyRecord {
	id: string;
	key: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open (and upgrade) the IndexedDB database. Cached for the lifetime of the
 * document. The `indexedDB` availability check is deferred to call time (not
 * import time) so headless/test environments without IDB don't blow up on
 * module load — only when a key operation is actually attempted.
 */
function openDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
		if (typeof indexedDB === 'undefined') {
			reject(
				new Error(
					'IndexedDB is unavailable in this environment; provider keys cannot be stored. Use the Mayon desktop app.'
				)
			);
			return;
		}
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE, { keyPath: 'id' });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () =>
			reject(req.error ?? new Error('Failed to open the Mayon IndexedDB database.'));
		req.onblocked = () => reject(new Error('IndexedDB upgrade was blocked by another tab.'));
	});
	// Don't cache a rejection: a later retry should get a fresh attempt.
	dbPromise.catch(() => {
		dbPromise = null;
	});
	return dbPromise;
}

function readKey(id: string): Promise<string | null> {
	return openDb().then(
		(db) =>
			new Promise<string | null>((resolve, reject) => {
				const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
				req.onsuccess = () => {
					const rec = req.result as KeyRecord | undefined;
					resolve(rec ? rec.key : null);
				};
				req.onerror = () => reject(req.error ?? new Error(`Failed to read key "${id}".`));
			})
	);
}

function writeKey(id: string, key: string): Promise<void> {
	return openDb().then(
		(db) =>
			new Promise<void>((resolve, reject) => {
				const req = db
					.transaction(STORE, 'readwrite')
					.objectStore(STORE)
					.put({ id, key } satisfies KeyRecord);
				req.onsuccess = () => resolve();
				req.onerror = () => reject(req.error ?? new Error(`Failed to store key "${id}".`));
			})
	);
}

function removeKey(id: string): Promise<void> {
	return openDb().then(
		(db) =>
			new Promise<void>((resolve, reject) => {
				const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
				req.onsuccess = () => resolve();
				req.onerror = () => reject(req.error ?? new Error(`Failed to delete key "${id}".`));
			})
	);
}

/** Build the browser (IndexedDB-backed) key store. */
export function createBrowserKeyStore(): BrowserKeyStore {
	return {
		get: (id) => readKey(id),
		has: (id) => readKey(id).then((k) => k != null),
		set: (id, key) => writeKey(id, key),
		delete: (id) => removeKey(id)
	};
}
