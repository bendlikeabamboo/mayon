import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { generateSync } from 'otplib';
import { buildApp } from './server';
import { createAuthStore, type AuthStore } from './auth/store';
import { hashPassword, unwrapSecret, wrapSecret } from './auth/crypto';
import { runCommand, type CliContext } from './auth/cli';
import type { PgPoolLike } from './pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../../drizzle');

async function createPglitePool(): Promise<PgPoolLike> {
	const client = new PGlite();
	let closed = false;
	await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
	const runQuery = async (text: string, params?: unknown[]) => {
		const res = await client.query(text, params as unknown[]);
		return {
			rows: res.rows as Record<string, unknown>[],
			fields: res.fields as { name: string }[],
			rowCount: res.affectedRows ?? res.rows.length
		};
	};
	return {
		query: runQuery,
		connect: async () => ({
			query: runQuery,
			release: () => undefined
		}),
		end: async () => {
			if (closed) {
				return;
			}
			closed = true;
			await client.close();
		}
	};
}

const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'replacement horse battery';
const STEP_MS = 30_000;

function codeFor(secret: string, atMs: number): string {
	return generateSync({ secret, epoch: Math.floor(atMs / 1000) });
}

function secretFromUri(uri: string): string {
	const secret = new URL(uri).searchParams.get('secret');
	expect(secret).toBeTruthy();
	return secret as string;
}

function sessionCookieHeader(res: { headers: Record<string, unknown> }): string | undefined {
	const raw = res.headers['set-cookie'];
	const list = raw == null ? [] : Array.isArray(raw) ? raw : [String(raw)];
	return list.find((c) => c.startsWith('mayon_session='));
}

function cookieToken(header: string): string {
	return header.split(';')[0].slice('mayon_session='.length);
}

interface TestApp {
	app: ReturnType<typeof buildApp>;
	pool: PgPoolLike;
	store: AuthStore;
	clock: { now: number };
	keyFile: string;
	close: () => Promise<void>;
}

async function startApp(): Promise<TestApp> {
	const pool = await createPglitePool();
	const clock = { now: Date.now() };
	const keyFile = path.join(mkdtempSync(path.join(tmpdir(), 'mayon-auth-cli-')), 'auth-secret');
	const app = buildApp(':memory:', {
		pgPool: pool,
		authNow: () => clock.now,
		authKeyPath: keyFile
	});
	await app.listen({ port: 0, host: '0.0.0.0' });
	return {
		app,
		pool,
		store: createAuthStore(pool, () => clock.now),
		clock,
		keyFile,
		close: async () => {
			await app.close();
		}
	};
}

function keyFromFile(keyFile: string): () => Buffer {
	return () => Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64');
}

interface CliHarness {
	ctx: CliContext;
	outputs: string[];
	keyWrites: Buffer[];
}

function makeCliContext(
	testApp: TestApp,
	opts: { key?: () => Buffer; answers?: string[]; confirm?: boolean } = {}
): CliHarness {
	const outputs: string[] = [];
	const keyWrites: Buffer[] = [];
	let answerIndex = 0;
	const ctx: CliContext = {
		store: createAuthStore(testApp.pool, () => testApp.clock.now),
		query: (text, params) => testApp.pool.query(text, params),
		connect: () => testApp.pool.connect(),
		key: opts.key ?? keyFromFile(testApp.keyFile),
		now: () => testApp.clock.now,
		prompt: async () => {
			const answer = opts.answers?.[answerIndex++];
			if (answer === undefined) {
				throw new Error('unexpected extra password prompt');
			}
			return answer;
		},
		confirm: async () => opts.confirm ?? true,
		out: (line) => outputs.push(line),
		keyPath: testApp.keyFile,
		writeKey: (key) => {
			keyWrites.push(key);
			writeFileSync(testApp.keyFile, key.toString('base64'), 'utf8');
		}
	};
	return { ctx, outputs, keyWrites };
}

async function loginPost(
	ctx: TestApp,
	body: Record<string, unknown>
): Promise<{
	statusCode: number;
	json: () => Record<string, unknown>;
	headers: Record<string, unknown>;
}> {
	const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', body });
	return { statusCode: res.statusCode, json: res.json(), headers: res.headers };
}

async function sessionStatus(ctx: TestApp, token: string): Promise<Record<string, unknown>> {
	const res = await ctx.app.inject({
		method: 'POST',
		url: '/api/auth/session',
		body: {},
		headers: { cookie: `mayon_session=${token}` }
	});
	expect(res.statusCode).toBe(200);
	return res.json();
}

async function enrollOwner(ctx: TestApp): Promise<string> {
	const setup = await ctx.app.inject({
		method: 'POST',
		url: '/api/auth/setup',
		body: { label: 'owner', password: PASSWORD }
	});
	expect(setup.statusCode).toBe(200);
	const secret = secretFromUri(setup.json().otpauthUri as string);
	const confirm = await ctx.app.inject({
		method: 'POST',
		url: '/api/auth/setup/confirm',
		body: { code: codeFor(secret, ctx.clock.now) }
	});
	expect(confirm.statusCode).toBe(200);
	return secret;
}

async function loginToken(ctx: TestApp, secret: string): Promise<string> {
	ctx.clock.now += STEP_MS;
	const res = await loginPost(ctx, { password: PASSWORD, code: codeFor(secret, ctx.clock.now) });
	expect(res.statusCode).toBe(200);
	return cookieToken(sessionCookieHeader(res) as string);
}

async function readMode(pool: PgPoolLike): Promise<string> {
	const res = await pool.query(`SELECT value FROM settings WHERE key = 'security.mode'`, []);
	const raw = res.rows[0]?.value as string | undefined;
	return raw === undefined ? 'open' : (JSON.parse(raw) as string);
}

describe('auth-cli reset-password', () => {
	let testApp: TestApp;
	beforeAll(async () => {
		testApp = await startApp();
	});
	afterAll(async () => {
		await testApp.close();
	});

	it('swaps the password, keeps MFA, and revokes existing sessions', async () => {
		const secret = await enrollOwner(testApp);
		const token = await loginToken(testApp, secret);
		testApp.clock.now += STEP_MS;

		const cli = makeCliContext(testApp, { answers: [NEW_PASSWORD, NEW_PASSWORD] });
		expect(await runCommand('reset-password', ['--label', 'owner'], cli.ctx)).toBe(0);

		expect(await sessionStatus(testApp, token)).toMatchObject({ authenticated: false });

		const atRetry = testApp.clock.now;
		const oldPw = await loginPost(testApp, { password: PASSWORD, code: codeFor(secret, atRetry) });
		expect(oldPw.statusCode).toBe(401);

		const newPw = await loginPost(testApp, {
			password: NEW_PASSWORD,
			code: codeFor(secret, atRetry)
		});
		expect(newPw.statusCode).toBe(200);
		expect(newPw.json).toMatchObject({ authenticated: true, identity: { label: 'owner' } });
		expect(cli.outputs.join('\n')).toContain('valid TOTP code');
	});

	it('refuses unknown labels, revoked identities, and bad password input', async () => {
		await expect(
			runCommand('reset-password', ['--label', 'ghost'], makeCliContext(testApp).ctx)
		).rejects.toMatchObject({ exitCode: 1 });

		await testApp.store.createIdentity({
			id: randomUUID(),
			label: 'gone',
			role: 'invitee',
			status: 'revoked',
			passwordHash: 'x'
		});
		await expect(
			runCommand('reset-password', ['--label', 'gone'], makeCliContext(testApp).ctx)
		).rejects.toMatchObject({ exitCode: 1 });

		await expect(
			runCommand(
				'reset-password',
				['--label', 'owner'],
				makeCliContext(testApp, { answers: [NEW_PASSWORD, 'different horse battery'] }).ctx
			)
		).rejects.toMatchObject({ exitCode: 1 });

		await expect(
			runCommand(
				'reset-password',
				['--label', 'owner'],
				makeCliContext(testApp, { answers: ['short', 'short'] }).ctx
			)
		).rejects.toMatchObject({ exitCode: 1 });

		await expect(
			runCommand('reset-password', [], makeCliContext(testApp).ctx)
		).rejects.toMatchObject({ exitCode: 1 });
	});
});

describe('auth-cli reenroll-mfa', () => {
	let testApp: TestApp;
	beforeAll(async () => {
		testApp = await startApp();
	});
	afterAll(async () => {
		await testApp.close();
	});

	it('invalidates the old secret and revokes sessions', async () => {
		const oldSecret = await enrollOwner(testApp);
		const token = await loginToken(testApp, oldSecret);
		testApp.clock.now += STEP_MS;

		const cli = makeCliContext(testApp);
		expect(await runCommand('reenroll-mfa', ['--label', 'owner'], cli.ctx)).toBe(0);

		const uri = cli.outputs.find((line) => line.startsWith('otpauth://'));
		expect(uri).toBeDefined();
		const newSecret = secretFromUri(uri as string);
		expect(newSecret).not.toBe(oldSecret);

		expect(await sessionStatus(testApp, token)).toMatchObject({ authenticated: false });

		const atRetry = testApp.clock.now;
		const oldCode = await loginPost(testApp, {
			password: PASSWORD,
			code: codeFor(oldSecret, atRetry)
		});
		expect(oldCode.statusCode).toBe(401);

		const newCode = await loginPost(testApp, {
			password: PASSWORD,
			code: codeFor(newSecret, atRetry)
		});
		expect(newCode.statusCode).toBe(200);
	});

	it('refuses revoked identities and missing labels', async () => {
		await expect(
			runCommand('reenroll-mfa', ['--label', 'ghost'], makeCliContext(testApp).ctx)
		).rejects.toMatchObject({ exitCode: 1 });

		await testApp.store.createIdentity({
			id: randomUUID(),
			label: 'gone',
			role: 'invitee',
			status: 'revoked',
			passwordHash: 'x'
		});
		await expect(
			runCommand('reenroll-mfa', ['--label', 'gone'], makeCliContext(testApp).ctx)
		).rejects.toMatchObject({ exitCode: 1 });
	});
});

describe('auth-cli wipe-sessions', () => {
	let testApp: TestApp;
	beforeAll(async () => {
		testApp = await startApp();
	});
	afterAll(async () => {
		await testApp.close();
	});

	it('revokes every live session and reports the count', async () => {
		const secret = await enrollOwner(testApp);
		const tokenA = await loginToken(testApp, secret);
		const tokenB = await loginToken(testApp, secret);

		const cli = makeCliContext(testApp);
		expect(await runCommand('wipe-sessions', [], cli.ctx)).toBe(0);
		expect(cli.outputs.join('\n')).toContain('revoked 3 session(s)');

		expect(await sessionStatus(testApp, tokenA)).toMatchObject({ authenticated: false });
		expect(await sessionStatus(testApp, tokenB)).toMatchObject({ authenticated: false });
	});
});

describe('auth-cli rotate-secret', () => {
	let testApp: TestApp;
	beforeAll(async () => {
		testApp = await startApp();
	});
	afterAll(async () => {
		await testApp.close();
	});

	it('re-wraps every secret under a new key and identities still verify', async () => {
		const secret = await enrollOwner(testApp);
		testApp.clock.now += STEP_MS;

		const cli = makeCliContext(testApp);
		expect(await runCommand('rotate-secret', [], cli.ctx)).toBe(0);
		expect(cli.keyWrites).toHaveLength(1);
		const newKey = cli.keyWrites[0];
		expect(newKey).toHaveLength(32);

		const row = await testApp.pool.query(
			`SELECT totp_secret_enc FROM auth_identities WHERE label = 'owner'`,
			[]
		);
		expect(unwrapSecret(row.rows[0]?.totp_secret_enc as string, newKey)).toBe(secret);

		const freshApp = buildApp(':memory:', {
			pgPool: { ...testApp.pool, end: async () => undefined },
			authNow: () => testApp.clock.now,
			authKeyPath: testApp.keyFile
		});
		await freshApp.listen({ port: 0, host: '0.0.0.0' });
		const res = await freshApp.inject({
			method: 'POST',
			url: '/api/auth/login',
			body: { password: PASSWORD, code: codeFor(secret, testApp.clock.now) }
		});
		expect(res.statusCode).toBe(200);
		await freshApp.close();
	});

	it('aborts without writing when any row fails to decrypt', async () => {
		const key = keyFromFile(testApp.keyFile)();
		const victimEnvelope = wrapSecret('victim-totp-secret', key);
		await testApp.store.createIdentity({
			id: randomUUID(),
			label: 'victim',
			role: 'owner',
			status: 'active',
			passwordHash: await hashPassword(PASSWORD),
			totpSecretEnc: victimEnvelope
		});
		await testApp.store.createIdentity({
			id: randomUUID(),
			label: 'corrupt',
			role: 'invitee',
			status: 'active',
			passwordHash: 'x',
			totpSecretEnc: 'v1.AAAA.AAAA.AAAA'
		});

		const cli = makeCliContext(testApp);
		await expect(runCommand('rotate-secret', [], cli.ctx)).rejects.toThrow(
			/cannot decrypt the TOTP secret for "corrupt"/
		);
		expect(cli.keyWrites).toHaveLength(0);
		expect(cli.outputs).toEqual([]);

		const after = await testApp.pool.query(
			`SELECT totp_secret_enc FROM auth_identities WHERE label = 'victim'`,
			[]
		);
		expect(after.rows[0]?.totp_secret_enc).toBe(victimEnvelope);
	});

	it('runs BEGIN, the re-wraps, and COMMIT on one checked-out client', async () => {
		const cli = makeCliContext(testApp);
		const key = keyFromFile(testApp.keyFile)();
		const liveRow = {
			id: randomUUID(),
			label: 'single-client',
			totp_secret_enc: wrapSecret('single-client-secret', key)
		};
		cli.ctx.query = async (text) => {
			if (text.startsWith('SELECT id, label, totp_secret_enc')) {
				return { rows: [liveRow], fields: [], rowCount: 1 };
			}
			throw new Error(`unexpected pool query: ${text}`);
		};
		const queries: string[] = [];
		let released = false;
		cli.ctx.connect = async () => ({
			query: async (text) => {
				queries.push(text);
				return { rows: [], fields: [], rowCount: text.startsWith('UPDATE') ? 1 : 0 };
			},
			release: () => {
				released = true;
			}
		});

		expect(await runCommand('rotate-secret', [], cli.ctx)).toBe(0);
		expect(queries[0]).toBe('BEGIN');
		expect(queries[queries.length - 1]).toBe('COMMIT');
		expect(queries.filter((q) => q.startsWith('UPDATE'))).toHaveLength(1);
		expect(queries).not.toContain('ROLLBACK');
		expect(released).toBe(true);
	});

	it('rolls back on the same client when an update fails and still releases it', async () => {
		const cli = makeCliContext(testApp);
		const key = keyFromFile(testApp.keyFile)();
		cli.ctx.query = async (text) => {
			if (text.startsWith('SELECT id, label, totp_secret_enc')) {
				return {
					rows: [
						{
							id: randomUUID(),
							label: 'rollback-victim',
							totp_secret_enc: wrapSecret('rollback-secret', key)
						}
					],
					fields: [],
					rowCount: 1
				};
			}
			throw new Error(`unexpected pool query: ${text}`);
		};
		const queries: string[] = [];
		let released = false;
		cli.ctx.connect = async () => ({
			query: async (text) => {
				queries.push(text);
				if (text.startsWith('UPDATE')) {
					throw new Error('connection reset mid-transaction');
				}
				return { rows: [], fields: [], rowCount: 0 };
			},
			release: () => {
				released = true;
			}
		});

		await expect(runCommand('rotate-secret', [], cli.ctx)).rejects.toThrow(
			/connection reset mid-transaction/
		);
		expect(queries[0]).toBe('BEGIN');
		expect(queries).toContain('ROLLBACK');
		expect(queries).not.toContain('COMMIT');
		expect(released).toBe(true);
		expect(cli.keyWrites).toHaveLength(0);
	});
});

describe('auth-cli set-mode', () => {
	let testApp: TestApp;
	beforeAll(async () => {
		testApp = await startApp();
	});
	afterAll(async () => {
		await testApp.close();
	});

	it('leaving locked revokes all sessions; entering locked works with an active owner', async () => {
		const secret = await enrollOwner(testApp);
		const token = await loginToken(testApp, secret);
		expect(await readMode(testApp.pool)).toBe('locked');

		const cli = makeCliContext(testApp);
		expect(await runCommand('set-mode', ['--mode', 'open'], cli.ctx)).toBe(0);
		expect(await readMode(testApp.pool)).toBe('open');
		expect(await sessionStatus(testApp, token)).toMatchObject({ authenticated: false });

		expect(await runCommand('set-mode', ['--mode', 'locked'], cli.ctx)).toBe(0);
		expect(await readMode(testApp.pool)).toBe('locked');
	});

	it('refuses to lock an identity-less deployment unless forced', async () => {
		const bare = await startApp();
		try {
			expect(await readMode(bare.pool)).toBe('open');
			await expect(
				runCommand('set-mode', ['--mode', 'locked'], makeCliContext(bare).ctx)
			).rejects.toMatchObject({ exitCode: 1 });
			expect(await readMode(bare.pool)).toBe('open');

			expect(
				await runCommand('set-mode', ['--mode', 'locked', '--force'], makeCliContext(bare).ctx)
			).toBe(0);
			expect(await readMode(bare.pool)).toBe('locked');
		} finally {
			await bare.close();
		}
	});

	it('rejects invalid mode values and missing flags', async () => {
		await expect(
			runCommand('set-mode', ['--mode', 'ajar'], makeCliContext(testApp).ctx)
		).rejects.toMatchObject({ exitCode: 1 });
		await expect(runCommand('set-mode', [], makeCliContext(testApp).ctx)).rejects.toMatchObject({
			exitCode: 1
		});
	});
});

describe('auth-cli status', () => {
	let testApp: TestApp;
	beforeAll(async () => {
		testApp = await startApp();
	});
	afterAll(async () => {
		await testApp.close();
	});

	it('prints mode, key presence, session count, and identities', async () => {
		const secret = await enrollOwner(testApp);
		await loginToken(testApp, secret);

		const cli = makeCliContext(testApp);
		expect(await runCommand('status', [], cli.ctx)).toBe(0);

		const text = cli.outputs.join('\n');
		expect(text).toContain('mode: locked');
		expect(text).toContain(`file ${testApp.keyFile}`);
		expect(text).toContain('active sessions: 2');
		expect(text).toContain('owner — role=owner status=active mfa=yes');
	});
});
