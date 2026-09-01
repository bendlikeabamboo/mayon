import { hash, verify } from '@node-rs/argon2';
import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	timingSafeEqual
} from 'node:crypto';

const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const ENVELOPE_VERSION = 'v1';

export async function hashPassword(plain: string): Promise<string> {
	return hash(plain);
}

export async function verifyPassword(encodedHash: string, plain: string): Promise<boolean> {
	return verify(encodedHash, plain);
}

export function randomToken(): string {
	return randomBytes(32).toString('base64url');
}

export function sha256Hex(input: string): string {
	return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function wrapSecret(plaintext: string, key: Buffer): string {
	assertKeyLength(key);
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	return [
		ENVELOPE_VERSION,
		iv.toString('base64'),
		ciphertext.toString('base64'),
		cipher.getAuthTag().toString('base64')
	].join('.');
}

export function unwrapSecret(envelope: string, key: Buffer): string {
	assertKeyLength(key);
	const parts = envelope.split('.');
	if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
		throw new Error('malformed secret envelope');
	}
	const iv = Buffer.from(parts[1], 'base64');
	const ciphertext = Buffer.from(parts[2], 'base64');
	const authTag = Buffer.from(parts[3], 'base64');
	const decipher = createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(authTag);
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function safeEqual(a: string, b: string): boolean {
	const digestA = createHash('sha256').update(a, 'utf8').digest();
	const digestB = createHash('sha256').update(b, 'utf8').digest();
	return timingSafeEqual(digestA, digestB);
}

function assertKeyLength(key: Buffer): void {
	if (key.length !== KEY_LENGTH) {
		throw new Error(`auth key must be ${KEY_LENGTH} bytes, got ${key.length}`);
	}
}
