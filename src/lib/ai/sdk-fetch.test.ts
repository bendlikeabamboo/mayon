import { afterEach, describe, expect, it, vi } from 'vitest';

// The key store is created inside `createBrowserKeychainFetch`; hoisted mocking
// keeps the key-presence branching under test without IndexedDB.
let storedKey: string | null = null;
vi.mock('./keystore/browser', () => ({
	createBrowserKeyStore: () => ({
		get: () => Promise.resolve(storedKey),
		set: () => Promise.resolve(),
		delete: () => Promise.resolve(),
		has: () => Promise.resolve(storedKey !== null)
	})
}));

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();
});

async function withKeyStore(key: string | null): Promise<typeof import('./sdk-fetch')> {
	storedKey = key;
	const mod = await import('./sdk-fetch');
	globalThis.fetch = vi.fn(async () => new Response('ok')) as typeof globalThis.fetch;
	return mod;
}

describe('createKeychainFetch', () => {
	it('throws MissingKeyError when the key is absent and the auth is required', async () => {
		const { createKeychainFetch } = await withKeyStore(null);
		const fetchFn = createKeychainFetch({
			header: 'Authorization',
			scheme: 'Bearer',
			keyId: 'p1'
		});
		await expect(fetchFn('https://api.example.test/v1/chat')).rejects.toMatchObject({
			name: 'MissingKeyError'
		});
	});

	it('proceeds without the auth header when the key is absent and optionalKey is set', async () => {
		const { createKeychainFetch } = await withKeyStore(null);
		const fetchFn = createKeychainFetch({
			header: 'Authorization',
			scheme: 'Bearer',
			keyId: 'p1',
			optionalKey: true
		});
		await fetchFn('http://localhost:1234/v1/chat');
		const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(new Headers((init as RequestInit).headers).get('Authorization')).toBeNull();
	});

	it('attaches the key when one is stored, even with optionalKey set', async () => {
		const { createKeychainFetch } = await withKeyStore('sk-test');
		const fetchFn = createKeychainFetch({
			header: 'Authorization',
			scheme: 'Bearer',
			keyId: 'p1',
			optionalKey: true
		});
		await fetchFn('http://localhost:1234/v1/chat');
		const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(new Headers((init as RequestInit).headers).get('Authorization')).toBe('Bearer sk-test');
	});
});
