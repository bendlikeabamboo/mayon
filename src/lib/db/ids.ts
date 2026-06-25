/** Generate a text UUID (v4). `crypto.randomUUID()` exists in browser + Node 22. */
export function uuid(): string {
	return globalThis.crypto.randomUUID();
}

/** Epoch-milliseconds timestamp. */
export function now(): number {
	return Date.now();
}
