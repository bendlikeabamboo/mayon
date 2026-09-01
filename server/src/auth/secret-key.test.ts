import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveAuthSecretKey } from './secret-key';

let dir: string;

afterEach(() => {
	if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshDir(): string {
	dir = mkdtempSync(path.join(tmpdir(), 'mayon-auth-key-'));
	return dir;
}

describe('resolveAuthSecretKey', () => {
	it('derives a stable 32-byte key from a non-empty env secret without writing a file', () => {
		const keyPath = path.join(freshDir(), 'auth-secret');
		const key = resolveAuthSecretKey({ envSecret: 'infrastructure-secret', keyPath });
		expect(key).toHaveLength(32);
		expect(key).toEqual(createHash('sha256').update('infrastructure-secret', 'utf8').digest());
		expect(existsSync(keyPath)).toBe(false);
	});

	it('derives different keys for different env secrets', () => {
		const keyPath = path.join(freshDir(), 'auth-secret');
		const a = resolveAuthSecretKey({ envSecret: 'one', keyPath });
		const b = resolveAuthSecretKey({ envSecret: 'two', keyPath });
		expect(a.equals(b)).toBe(false);
	});

	it('generates a 0600 key file on first call and reuses it on the second', () => {
		const keyPath = path.join(freshDir(), 'auth-secret');
		const first = resolveAuthSecretKey({ keyPath });
		expect(first).toHaveLength(32);
		expect(statSync(keyPath).mode & 0o777).toBe(0o600);

		const second = resolveAuthSecretKey({ keyPath });
		expect(second.equals(first)).toBe(true);
		expect(readFileSync(keyPath, 'utf8')).toBe(first.toString('base64'));
	});

	it('creates missing parent directories', () => {
		const keyPath = path.join(freshDir(), 'nested', 'deeper', 'auth-secret');
		expect(resolveAuthSecretKey({ keyPath })).toHaveLength(32);
		expect(statSync(keyPath).mode & 0o777).toBe(0o600);
	});

	it('honors a pre-existing valid key file', () => {
		const keyPath = path.join(freshDir(), 'auth-secret');
		const existing = Buffer.alloc(32, 0xab);
		writeFileSync(keyPath, existing.toString('base64'));

		const key = resolveAuthSecretKey({ keyPath });
		expect(key.equals(existing)).toBe(true);
		expect(readFileSync(keyPath, 'utf8')).toBe(existing.toString('base64'));
	});

	it('surfaces a clear error when the key path is unusable', () => {
		const blocker = path.join(freshDir(), 'blocker');
		writeFileSync(blocker, 'not a directory');
		expect(() =>
			resolveAuthSecretKey({ envSecret: '', keyPath: path.join(blocker, 'sub') })
		).toThrow(/auth key file/);
	});

	it('surfaces a clear error for a key file that does not decode to 32 bytes', () => {
		const keyPath = path.join(freshDir(), 'auth-secret');
		writeFileSync(keyPath, Buffer.alloc(16).toString('base64'));
		expect(() => resolveAuthSecretKey({ keyPath })).toThrow(/32 bytes/);
	});
});
