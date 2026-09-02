import { describe, expect, it } from 'vitest';
import {
	hashPassword,
	randomToken,
	safeEqual,
	sha256Hex,
	unwrapSecret,
	verifyPassword,
	wrapSecret
} from './crypto';

const KEY = Buffer.alloc(32, 7);

describe('password hashing', () => {
	it('round-trips a correct password', async () => {
		const encoded = await hashPassword('correct horse battery staple');
		expect(encoded.startsWith('$argon2id$')).toBe(true);
		await expect(verifyPassword(encoded, 'correct horse battery staple')).resolves.toBe(true);
	});

	it('rejects a wrong password', async () => {
		const encoded = await hashPassword('hunter2');
		await expect(verifyPassword(encoded, 'hunter3')).resolves.toBe(false);
	});
});

describe('randomToken', () => {
	it('produces unique 256-bit base64url tokens', () => {
		const tokens = new Set<string>();
		for (let i = 0; i < 64; i++) {
			const token = randomToken();
			expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
			tokens.add(token);
		}
		expect(tokens.size).toBe(64);
	});
});

describe('sha256Hex', () => {
	it('matches the known vector', () => {
		expect(sha256Hex('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});
});

describe('wrapSecret / unwrapSecret', () => {
	it('round-trips plaintext', () => {
		const envelope = wrapSecret('totp-secret-JBSWY3DPEHPK3PXP', KEY);
		expect(unwrapSecret(envelope, KEY)).toBe('totp-secret-JBSWY3DPEHPK3PXP');
	});

	it('round-trips unicode plaintext', () => {
		const envelope = wrapSecret('säkra-hemligheter-🔐', KEY);
		expect(unwrapSecret(envelope, KEY)).toBe('säkra-hemligheter-🔐');
	});

	it('emits the v1.<iv>.<ct>.<tag> envelope shape', () => {
		const parts = wrapSecret('x', KEY).split('.');
		expect(parts).toHaveLength(4);
		expect(parts[0]).toBe('v1');
		expect(Buffer.from(parts[1], 'base64')).toHaveLength(12);
		expect(Buffer.from(parts[2], 'base64')).toHaveLength(1);
		expect(Buffer.from(parts[3], 'base64')).toHaveLength(16);
	});

	it('uses a unique IV per wrap', () => {
		const ivs = new Set<string>();
		for (let i = 0; i < 20; i++) {
			ivs.add(wrapSecret('same plaintext', KEY).split('.')[1]);
		}
		expect(ivs.size).toBe(20);
	});

	it('throws when the ciphertext is tampered', () => {
		const parts = wrapSecret('tamper target', KEY).split('.');
		const ct = Buffer.from(parts[2], 'base64');
		ct[0] ^= 0xff;
		parts[2] = ct.toString('base64');
		expect(() => unwrapSecret(parts.join('.'), KEY)).toThrow();
	});

	it('throws when the auth tag is tampered', () => {
		const parts = wrapSecret('tamper target', KEY).split('.');
		const tag = Buffer.from(parts[3], 'base64');
		tag[0] ^= 0xff;
		parts[3] = tag.toString('base64');
		expect(() => unwrapSecret(parts.join('.'), KEY)).toThrow();
	});

	it('throws under the wrong key', () => {
		const envelope = wrapSecret('for other eyes', KEY);
		expect(() => unwrapSecret(envelope, Buffer.alloc(32, 8))).toThrow();
	});

	it('rejects malformed envelopes', () => {
		expect(() => unwrapSecret('v1.only-three', KEY)).toThrow();
		expect(() => unwrapSecret('v2.a.b.c', KEY)).toThrow();
	});

	it('rejects keys that are not 32 bytes', () => {
		expect(() => wrapSecret('x', Buffer.alloc(16))).toThrow(/32 bytes/);
		expect(() => unwrapSecret('v1.a.b.c', Buffer.alloc(31))).toThrow(/32 bytes/);
	});
});

describe('safeEqual', () => {
	it('accepts equal strings', () => {
		expect(safeEqual('same', 'same')).toBe(true);
		expect(safeEqual('', '')).toBe(true);
	});

	it('rejects differing strings of equal length', () => {
		expect(safeEqual('same', 'sane')).toBe(false);
	});

	it('rejects differing lengths', () => {
		expect(safeEqual('short', 'shorter')).toBe(false);
	});
});
