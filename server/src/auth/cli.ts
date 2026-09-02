import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSecret, generateURI } from 'otplib';
import type { AuthMode } from '@mayon/shared';
import { createPgPool, probePg } from '../pg';
import type { PgPoolLike } from '../pg';
import { hashPassword, unwrapSecret, wrapSecret } from './crypto';
import { resolveAuthSecretKey } from './secret-key';
import { createAuthStore, type AuthStore } from './store';

const SECURITY_MODE_KEY = 'security.mode';
const KEY_LENGTH = 32;
const KEY_FILE_NAME = 'auth-secret';
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 1024;
const DEFAULT_SANDBOX_DB_PATH = '/data/sandbox.sqlite';

export const COMMANDS = [
	'status',
	'reset-password',
	'reenroll-mfa',
	'wipe-sessions',
	'rotate-secret',
	'set-mode'
] as const;

export class CliError extends Error {
	constructor(
		message: string,
		readonly exitCode: number
	) {
		super(message);
	}
}

export interface CliContext {
	store: AuthStore;
	query: PgPoolLike['query'];
	key: () => Buffer;
	now: () => number;
	prompt: (query: string) => Promise<string>;
	confirm: (query: string) => Promise<boolean>;
	out: (line: string) => void;
	keyPath: string;
	envSecret?: string;
	writeKey?: (key: Buffer) => void;
}

export function usage(): string {
	return `mayon auth recovery CLI

Usage: node dist/auth-cli.js <command> [options]

Commands:
  status                          Show mode, identities, active sessions, key presence
  reset-password --label <label>  Set a new password (hidden prompt x2); revokes that
                                  identity's sessions; next login still needs a TOTP code
  reenroll-mfa --label <label>    Discard the current TOTP secret and print a fresh
                                  otpauth:// URI to scan; revokes that identity's sessions
  wipe-sessions                   Revoke every session
  rotate-secret                   Re-wrap all TOTP secrets under a new key; aborts with
                                  no writes if any secret fails to decrypt
  set-mode --mode open|locked [--force]
                                  Set security.mode directly; revokes all sessions when
                                  leaving locked; locking without an active owner needs --force

Exit codes: 0 success, 1 usage/refused, 2 database unreachable`;
}

export async function runCommand(name: string, args: string[], ctx: CliContext): Promise<number> {
	switch (name) {
		case 'status':
			return cmdStatus(ctx);
		case 'reset-password':
			return cmdResetPassword(ctx, flagValue(args, '--label'));
		case 'reenroll-mfa':
			return cmdReenrollMfa(ctx, flagValue(args, '--label'));
		case 'wipe-sessions':
			return cmdWipeSessions(ctx);
		case 'rotate-secret':
			return cmdRotateSecret(ctx);
		case 'set-mode': {
			const mode = flagValue(args, '--mode');
			if (mode !== 'open' && mode !== 'locked') {
				throw new CliError(`--mode must be "open" or "locked", got "${mode}"`, 1);
			}
			return cmdSetMode(ctx, mode, args.includes('--force'));
		}
		default:
			throw new CliError(`unknown command: ${name}`, 1);
	}
}

async function cmdStatus(ctx: CliContext): Promise<number> {
	const mode = await readSecurityMode(ctx.query);
	const identities = await ctx.query(
		'SELECT label, role, status, mfa_enrolled_at FROM auth_identities ORDER BY created_at, id',
		[]
	);
	const live = await ctx.query(
		'SELECT COUNT(*)::int AS count FROM auth_sessions WHERE revoked_at IS NULL AND expires_at > $1',
		[ctx.now()]
	);
	ctx.out(`mode: ${mode}`);
	ctx.out(`key: ${describeKey(ctx)}`);
	ctx.out(`active sessions: ${Number((live.rows[0] as { count: number }).count)}`);
	if (identities.rows.length === 0) {
		ctx.out('identities: none');
	} else {
		ctx.out('identities:');
		for (const raw of identities.rows) {
			const row = raw as {
				label: string;
				role: string;
				status: string;
				mfa_enrolled_at: unknown;
			};
			ctx.out(
				`  ${row.label} — role=${row.role} status=${row.status} mfa=${row.mfa_enrolled_at == null ? 'no' : 'yes'}`
			);
		}
	}
	return 0;
}

async function cmdResetPassword(ctx: CliContext, label: string): Promise<number> {
	const identity = await requireMutableIdentity(ctx, label);
	const password = await ctx.prompt(`New password for "${label}" (input hidden): `);
	const confirmed = await ctx.prompt('Confirm new password (input hidden): ');
	if (password !== confirmed) {
		throw new CliError('passwords do not match', 1);
	}
	if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
		throw new CliError(`password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters`, 1);
	}
	await ctx.store.setIdentityPasswordHash(identity.id, await hashPassword(password));
	const revoked = await ctx.store.revokeSessionsByIdentity(identity.id, ctx.now());
	ctx.out(`password reset for "${label}"; ${revoked} session(s) revoked`);
	ctx.out('next login requires the new password plus a valid TOTP code');
	return 0;
}

async function cmdReenrollMfa(ctx: CliContext, label: string): Promise<number> {
	const identity = await requireMutableIdentity(ctx, label);
	const confirmed = await ctx.confirm(
		`Re-enroll MFA for "${label}"? The current TOTP secret is discarded and all their sessions are revoked [y/N]: `
	);
	if (!confirmed) {
		return 1;
	}
	const secret = generateSecret();
	let secretEnc: string;
	try {
		secretEnc = wrapSecret(secret, ctx.key());
	} catch (err) {
		throw new CliError(`cannot wrap the new TOTP secret: ${errorMessage(err)}`, 1);
	}
	await ctx.store.setIdentityMfa(identity.id, {
		totpSecretEnc: secretEnc,
		totpLastStep: null,
		mfaEnrolledAt: ctx.now()
	});
	const revoked = await ctx.store.revokeSessionsByIdentity(identity.id, ctx.now());
	ctx.out(`MFA re-enrolled for "${label}"; ${revoked} session(s) revoked`);
	ctx.out('scan this URI in your authenticator app:');
	ctx.out(generateURI({ issuer: 'mayon', label: identity.label, secret }));
	return 0;
}

async function cmdWipeSessions(ctx: CliContext): Promise<number> {
	if (!(await ctx.confirm('Revoke ALL active sessions? [y/N]: '))) {
		return 1;
	}
	const revoked = await ctx.store.revokeAllSessions(ctx.now());
	ctx.out(`revoked ${revoked} session(s)`);
	return 0;
}

async function cmdRotateSecret(ctx: CliContext): Promise<number> {
	const rows = await ctx.query(
		'SELECT id, label, totp_secret_enc FROM auth_identities WHERE totp_secret_enc IS NOT NULL ORDER BY created_at, id',
		[]
	);
	const oldKey = ctx.key();
	const newEnvSecret = randomBytes(KEY_LENGTH).toString('base64url');
	const newKey = resolveAuthSecretKey({ envSecret: newEnvSecret, keyPath: ctx.keyPath });
	const rewrapped: { id: string; label: string; secretEnc: string }[] = [];
	for (const raw of rows.rows) {
		const row = raw as { id: string; label: string; totp_secret_enc: string };
		try {
			rewrapped.push({
				id: row.id,
				label: row.label,
				secretEnc: wrapSecret(unwrapSecret(row.totp_secret_enc, oldKey), newKey)
			});
		} catch (err) {
			throw new CliError(
				`rotation aborted: cannot decrypt the TOTP secret for "${row.label}" (${errorMessage(err)}); nothing was written`,
				1
			);
		}
	}
	if (
		!(await ctx.confirm(
			`Rotate the TOTP wrapping key? ${rewrapped.length} secret(s) will be re-encrypted [y/N]: `
		))
	) {
		return 1;
	}
	await ctx.query('BEGIN', []);
	try {
		for (const row of rewrapped) {
			await ctx.query('UPDATE auth_identities SET totp_secret_enc = $1 WHERE id = $2', [
				row.secretEnc,
				row.id
			]);
		}
		await ctx.query('COMMIT', []);
	} catch (err) {
		await ctx.query('ROLLBACK', []).catch(() => undefined);
		throw err;
	}
	if (ctx.writeKey) {
		try {
			ctx.writeKey(newKey);
			ctx.out(`rotated ${rewrapped.length} TOTP secret(s); new key written to ${ctx.keyPath}`);
		} catch (err) {
			throw new CliError(
				`the database was re-wrapped but writing the new key file failed (${errorMessage(err)}); ` +
					`if ${ctx.keyPath}.new exists, move it to ${ctx.keyPath} and restart the server`,
				1
			);
		}
	} else {
		ctx.out(`rotated ${rewrapped.length} TOTP secret(s).`);
		ctx.out('MAYON_AUTH_SECRET is provided via the environment; the key file was NOT written.');
		ctx.out('Set MAYON_AUTH_SECRET to the following value, then restart the server immediately:');
		ctx.out(`  MAYON_AUTH_SECRET=${newEnvSecret}`);
	}
	for (const row of rewrapped) {
		ctx.out(`  re-wrapped: ${row.label}`);
	}
	return 0;
}

async function cmdSetMode(ctx: CliContext, mode: AuthMode, force: boolean): Promise<number> {
	const current = await readSecurityMode(ctx.query);
	if (current === mode) {
		ctx.out(`mode is already ${mode}`);
		return 0;
	}
	if (mode === 'locked' && !force && (await ctx.store.findActiveOwner()) === null) {
		throw new CliError(
			'refusing to lock: no active owner exists, so nobody could sign in (use --force to override)',
			1
		);
	}
	const revokeNote = current === 'locked' ? ' All sessions will be revoked.' : '';
	if (!(await ctx.confirm(`Set security mode to "${mode}"?${revokeNote} [y/N]: `))) {
		return 1;
	}
	await writeSecurityMode(ctx.query, mode);
	if (current === 'locked') {
		const revoked = await ctx.store.revokeAllSessions(ctx.now());
		ctx.out(`mode set to ${mode}; ${revoked} session(s) revoked`);
	} else {
		ctx.out(`mode set to ${mode}`);
	}
	return 0;
}

async function requireMutableIdentity(ctx: CliContext, label: string) {
	const identity = await ctx.store.findIdentityByLabel(label);
	if (!identity) {
		throw new CliError(`unknown identity label: ${label}`, 1);
	}
	if (identity.status === 'revoked') {
		throw new CliError(`identity "${label}" is revoked; create a new invite instead`, 1);
	}
	return identity;
}

async function readSecurityMode(query: PgPoolLike['query']): Promise<AuthMode> {
	try {
		const res = await query('SELECT value FROM settings WHERE key = $1', [SECURITY_MODE_KEY]);
		const raw = res.rows[0]?.value;
		if (typeof raw === 'string') {
			const parsed: unknown = JSON.parse(raw);
			if (parsed === 'open' || parsed === 'locked') {
				return parsed;
			}
		}
		return 'open';
	} catch (err) {
		if (isMissingSettingsRelation(err)) {
			return 'open';
		}
		return 'locked';
	}
}

async function writeSecurityMode(query: PgPoolLike['query'], mode: AuthMode): Promise<void> {
	await query(
		`INSERT INTO settings(key,value) VALUES($1,$2)
		 ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
		[SECURITY_MODE_KEY, JSON.stringify(mode)]
	);
}

function isMissingSettingsRelation(err: unknown): boolean {
	if ((err as { code?: string } | null)?.code === '42P01') {
		return true;
	}
	return /relation\s+"?settings"?\s+does not exist/i.test(errorMessage(err));
}

function describeKey(ctx: CliContext): string {
	if (ctx.envSecret) {
		return 'MAYON_AUTH_SECRET (environment)';
	}
	return existsSync(ctx.keyPath) ? `file ${ctx.keyPath}` : `file ${ctx.keyPath} (missing)`;
}

function flagValue(args: string[], flag: string): string {
	const index = args.indexOf(flag);
	if (index === -1 || index + 1 >= args.length) {
		throw new CliError(`missing ${flag} <value>`, 1);
	}
	return args[index + 1];
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function authKeyPath(): string {
	const sandboxPath = process.env.SANDBOX_DB_PATH ?? DEFAULT_SANDBOX_DB_PATH;
	return path.join(path.dirname(sandboxPath), KEY_FILE_NAME);
}

function memoizeKey(envSecret: string | undefined, keyPath: string): () => Buffer {
	let key: Buffer | undefined;
	return () => {
		key ??= resolveAuthSecretKey({ envSecret, keyPath });
		return key;
	};
}

function writeKeyFile(keyPath: string, key: Buffer): void {
	const tmpPath = `${keyPath}.new`;
	mkdirSync(path.dirname(keyPath), { recursive: true });
	writeFileSync(tmpPath, key.toString('base64'), { encoding: 'utf8', mode: 0o600 });
	chmodSync(tmpPath, 0o600);
	renameSync(tmpPath, keyPath);
}

function promptHidden(query: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const stdout = process.stdout;
		const emit = stdout.write.bind(stdout) as typeof stdout.write;
		emit(query);
		const silence = (() => true) as unknown as typeof stdout.write;
		stdout.write = silence;
		const restore = () => {
			stdout.write = emit;
		};
		const rl = createInterface({ input: process.stdin, output: stdout, terminal: true });
		rl.once('close', restore);
		rl.once('error', (err) => {
			restore();
			reject(err);
		});
		rl.question('', (answer) => {
			restore();
			rl.close();
			emit('\n');
			resolve(answer);
		});
	});
}

async function confirmInteractive(query: string): Promise<boolean> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise<string>((resolve) => rl.question(query, resolve));
	rl.close();
	return /^\s*(y|yes)\s*$/i.test(answer);
}

export async function main(argv: string[]): Promise<number> {
	if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
		console.log(usage());
		return 0;
	}
	const name = argv[0];
	if (!(COMMANDS as readonly string[]).includes(name)) {
		console.error(`unknown command: ${name}\n${usage()}`);
		return 1;
	}
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		console.error('DATABASE_URL is not set');
		return 2;
	}
	const pool = createPgPool(databaseUrl);
	try {
		if (!(await probePg(pool, { retries: 20, delayMs: 1000 }))) {
			console.error('database unreachable');
			return 2;
		}
		const schemaOk = await pool.query(
			`SELECT to_regclass('public.__drizzle_migrations') IS NOT NULL
			  AND to_regclass('public.auth_identities') IS NOT NULL AS ok`,
			[]
		);
		if (!(schemaOk.rows[0] as { ok: boolean } | undefined)?.ok) {
			console.error('database schema not initialized — run the server once first');
			return 2;
		}
		const envSecret = process.env.MAYON_AUTH_SECRET || undefined;
		const keyPath = authKeyPath();
		const ctx: CliContext = {
			store: createAuthStore(pool),
			query: (text, params) => pool.query(text, params),
			key: memoizeKey(envSecret, keyPath),
			now: () => Date.now(),
			prompt: promptHidden,
			confirm: confirmInteractive,
			out: (line) => console.log(line),
			keyPath,
			envSecret,
			writeKey: envSecret ? undefined : (key) => writeKeyFile(keyPath, key)
		};
		return await runCommand(name, argv.slice(1), ctx);
	} finally {
		await pool.end();
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2))
		.then((code) => process.exit(code))
		.catch((err) => {
			if (err instanceof CliError) {
				console.error(err.message);
				process.exit(err.exitCode);
			}
			console.error(err instanceof Error ? err.message : err);
			process.exit(1);
		});
}
