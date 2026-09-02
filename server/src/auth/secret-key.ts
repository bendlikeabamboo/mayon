import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const KEY_LENGTH = 32;

export interface ResolveAuthSecretKeyOptions {
	envSecret?: string;
	keyPath: string;
}

export function resolveAuthSecretKey(opts: ResolveAuthSecretKeyOptions): Buffer {
	if (opts.envSecret && opts.envSecret.length > 0) {
		return createHash('sha256').update(opts.envSecret, 'utf8').digest();
	}
	try {
		const raw = readFileSync(opts.keyPath, 'utf8').trim();
		const key = Buffer.from(raw, 'base64');
		if (key.length !== KEY_LENGTH) {
			throw new Error(`auth key file ${opts.keyPath} must decode to ${KEY_LENGTH} bytes`);
		}
		return key;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw new Error(`failed to read auth key file ${opts.keyPath}: ${(err as Error).message}`, {
				cause: err
			});
		}
	}
	const key = randomBytes(KEY_LENGTH);
	try {
		mkdirSync(path.dirname(opts.keyPath), { recursive: true });
		writeFileSync(opts.keyPath, key.toString('base64'), { encoding: 'utf8', mode: 0o600 });
		chmodSync(opts.keyPath, 0o600);
	} catch (err) {
		throw new Error(`failed to write auth key file ${opts.keyPath}: ${(err as Error).message}`, {
			cause: err
		});
	}
	return key;
}
