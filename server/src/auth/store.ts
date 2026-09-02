import { randomUUID } from 'node:crypto';
import type {
	AuthIdentity,
	AuthIdentityRole,
	AuthIdentityStatus,
	AuthLoginOutcome
} from '@mayon/schema';
import type { PgPoolLike } from '../pg';

const ATTEMPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface CreateIdentityInput {
	id: string;
	label: string;
	role: AuthIdentityRole;
	status: AuthIdentityStatus;
	passwordHash: string;
	totpSecretEnc?: string | null;
}

export interface SetIdentityMfaInput {
	totpSecretEnc: string;
	totpLastStep?: number | null;
	mfaEnrolledAt?: number | null;
}

export interface CreateSessionInput {
	id: string;
	identityId: string;
	tokenHash: string;
	expiresAt: number;
	label?: string;
}

export interface RecordAttemptInput {
	identityLabel?: string | null;
	source: string;
	outcome: AuthLoginOutcome;
	at: number;
}

export interface ValidSessionLookup {
	session: {
		id: string;
		identityId: string;
		createdAt: number;
		expiresAt: number;
		lastSeenAt: number | null;
		label: string | null;
	};
	identity: {
		id: string;
		label: string;
		role: AuthIdentityRole;
		status: AuthIdentityStatus;
	};
}

export interface SessionListItem {
	id: string;
	identityId: string;
	identityLabel: string;
	label: string | null;
	createdAt: number;
	expiresAt: number;
	lastSeenAt: number | null;
}

export interface InviteListItem {
	id: string;
	label: string;
	status: AuthIdentityStatus;
	createdAt: number;
}

export interface SessionRecordById {
	id: string;
	identityId: string;
	expiresAt: number;
	revokedAt: number | null;
}

export interface LoginAttemptListItem {
	identityLabel: string | null;
	source: string;
	outcome: AuthLoginOutcome;
	at: number;
}

export interface AuthStore {
	createIdentity(input: CreateIdentityInput): Promise<void>;
	findIdentityByLabel(label: string): Promise<AuthIdentity | null>;
	findIdentityById(id: string): Promise<AuthIdentity | null>;
	findActiveOwner(): Promise<AuthIdentity | null>;
	listNonRevokedIdentities(): Promise<AuthIdentity[]>;
	countNonRevokedIdentities(): Promise<number>;
	listInvites(): Promise<InviteListItem[]>;
	setIdentityMfa(id: string, input: SetIdentityMfaInput): Promise<void>;
	setIdentityStatus(id: string, status: AuthIdentityStatus): Promise<void>;
	setIdentityPasswordHash(id: string, passwordHash: string): Promise<void>;
	createSession(input: CreateSessionInput): Promise<void>;
	findValidSessionByTokenHash(tokenHash: string, nowMs: number): Promise<ValidSessionLookup | null>;
	revokeSession(id: string, nowMs: number): Promise<void>;
	revokeAllSessions(nowMs: number): Promise<void>;
	deleteSessionsByIdentity(identityId: string): Promise<void>;
	touchSession(id: string, nowMs: number): Promise<void>;
	getSessionById(id: string): Promise<SessionRecordById | null>;
	listSessions(nowMs: number): Promise<SessionListItem[]>;
	recordAttempt(input: RecordAttemptInput): Promise<void>;
	countRecentFailures(source: string, sinceMs: number): Promise<number>;
	listRecentAttempts(limit: number): Promise<LoginAttemptListItem[]>;
}

export function createAuthStore(
	pool: PgPoolLike | undefined,
	now: () => number = Date.now
): AuthStore {
	function db(): PgPoolLike {
		if (!pool) {
			throw new Error('auth store requires a configured pg pool');
		}
		return pool;
	}

	return {
		async createIdentity(input) {
			const ts = now();
			await db().query(
				`INSERT INTO auth_identities
				 (id, label, role, status, password_hash, totp_secret_enc, totp_last_step, mfa_enrolled_at, created_at, updated_at)
				 VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, $7, $7)`,
				[
					input.id,
					input.label,
					input.role,
					input.status,
					input.passwordHash,
					input.totpSecretEnc ?? null,
					ts
				]
			);
		},

		async findIdentityByLabel(label) {
			const res = await db().query('SELECT * FROM auth_identities WHERE label = $1', [label]);
			return res.rows[0] ? toIdentity(res.rows[0] as IdentityRow) : null;
		},

		async findIdentityById(id) {
			const res = await db().query('SELECT * FROM auth_identities WHERE id = $1', [id]);
			return res.rows[0] ? toIdentity(res.rows[0] as IdentityRow) : null;
		},

		async listInvites() {
			const res = await db().query(
				`SELECT id, label, status, created_at FROM auth_identities WHERE role = 'invitee'
				 ORDER BY created_at, id`
			);
			return res.rows.map((raw) => {
				const row = raw as InviteRow;
				return {
					id: row.id,
					label: row.label,
					status: row.status as AuthIdentityStatus,
					createdAt: Number(row.created_at)
				};
			});
		},

		async findActiveOwner() {
			const res = await db().query(
				`SELECT * FROM auth_identities WHERE role = 'owner' AND status = 'active'
				 ORDER BY created_at LIMIT 1`
			);
			return res.rows[0] ? toIdentity(res.rows[0] as IdentityRow) : null;
		},

		async listNonRevokedIdentities() {
			const res = await db().query(
				"SELECT * FROM auth_identities WHERE status <> 'revoked' ORDER BY created_at, id"
			);
			return res.rows.map((row) => toIdentity(row as IdentityRow));
		},

		async countNonRevokedIdentities() {
			const res = await db().query(
				"SELECT COUNT(*)::int AS count FROM auth_identities WHERE status <> 'revoked'"
			);
			return Number((res.rows[0] as { count: number }).count);
		},

		async setIdentityMfa(id, input) {
			await db().query(
				`UPDATE auth_identities
				 SET totp_secret_enc = $1, totp_last_step = $2, mfa_enrolled_at = $3, updated_at = $4
				 WHERE id = $5`,
				[input.totpSecretEnc, input.totpLastStep ?? null, input.mfaEnrolledAt ?? null, now(), id]
			);
		},

		async setIdentityStatus(id, status) {
			await db().query('UPDATE auth_identities SET status = $1, updated_at = $2 WHERE id = $3', [
				status,
				now(),
				id
			]);
		},

		async setIdentityPasswordHash(id, passwordHash) {
			await db().query(
				'UPDATE auth_identities SET password_hash = $1, updated_at = $2 WHERE id = $3',
				[passwordHash, now(), id]
			);
		},

		async createSession(input) {
			await db().query(
				`INSERT INTO auth_sessions
				 (id, identity_id, token_hash, created_at, expires_at, revoked_at, label, last_seen_at)
				 VALUES ($1, $2, $3, $4, $5, NULL, $6, NULL)`,
				[input.id, input.identityId, input.tokenHash, now(), input.expiresAt, input.label ?? null]
			);
		},

		async findValidSessionByTokenHash(tokenHash, nowMs) {
			const res = await db().query(
				`SELECT s.id AS session_id, s.created_at, s.expires_at, s.last_seen_at, s.label AS session_label,
				        i.id AS identity_id, i.label AS identity_label, i.role, i.status
				 FROM auth_sessions s
				 JOIN auth_identities i ON i.id = s.identity_id
				 WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2 AND i.status = 'active'
				 LIMIT 1`,
				[tokenHash, nowMs]
			);
			const row = res.rows[0] as SessionJoinRow | undefined;
			if (!row) {
				return null;
			}
			return {
				session: {
					id: row.session_id,
					identityId: row.identity_id,
					createdAt: Number(row.created_at),
					expiresAt: Number(row.expires_at),
					lastSeenAt: row.last_seen_at == null ? null : Number(row.last_seen_at),
					label: row.session_label
				},
				identity: {
					id: row.identity_id,
					label: row.identity_label,
					role: row.role as AuthIdentityRole,
					status: row.status as AuthIdentityStatus
				}
			};
		},

		async revokeSession(id, nowMs) {
			await db().query(
				'UPDATE auth_sessions SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL',
				[nowMs, id]
			);
		},

		async revokeAllSessions(nowMs) {
			await db().query('UPDATE auth_sessions SET revoked_at = $1 WHERE revoked_at IS NULL', [
				nowMs
			]);
		},

		async deleteSessionsByIdentity(identityId) {
			await db().query('DELETE FROM auth_sessions WHERE identity_id = $1', [identityId]);
		},

		async touchSession(id, nowMs) {
			await db().query('UPDATE auth_sessions SET last_seen_at = $1 WHERE id = $2', [nowMs, id]);
		},

		async getSessionById(id) {
			const res = await db().query(
				'SELECT id, identity_id, expires_at, revoked_at FROM auth_sessions WHERE id = $1',
				[id]
			);
			const row = res.rows[0] as SessionIdRow | undefined;
			if (!row) {
				return null;
			}
			return {
				id: row.id,
				identityId: row.identity_id,
				expiresAt: Number(row.expires_at),
				revokedAt: row.revoked_at == null ? null : Number(row.revoked_at)
			};
		},

		async listSessions(nowMs) {
			const res = await db().query(
				`SELECT s.id, s.identity_id, s.created_at, s.expires_at, s.last_seen_at, s.label, i.label AS identity_label
				 FROM auth_sessions s
				 JOIN auth_identities i ON i.id = s.identity_id
				 WHERE s.revoked_at IS NULL AND s.expires_at > $1
				 ORDER BY s.created_at, s.id`,
				[nowMs]
			);
			return res.rows.map((raw) => {
				const row = raw as SessionListRow;
				return {
					id: row.id,
					identityId: row.identity_id,
					identityLabel: row.identity_label,
					label: row.label,
					createdAt: Number(row.created_at),
					expiresAt: Number(row.expires_at),
					lastSeenAt: row.last_seen_at == null ? null : Number(row.last_seen_at)
				};
			});
		},

		async recordAttempt(input) {
			const dbh = db();
			await dbh.query(
				'INSERT INTO auth_login_attempts (id, identity_label, source, outcome, at) VALUES ($1, $2, $3, $4, $5)',
				[randomUUID(), input.identityLabel ?? null, input.source, input.outcome, input.at]
			);
			await dbh.query('DELETE FROM auth_login_attempts WHERE at < $1', [
				now() - ATTEMPT_RETENTION_MS
			]);
		},

		async countRecentFailures(source, sinceMs) {
			const res = await db().query(
				`SELECT COUNT(*)::int AS count FROM auth_login_attempts
				 WHERE source = $1 AND at >= $2 AND outcome <> 'success'`,
				[source, sinceMs]
			);
			return Number((res.rows[0] as { count: number }).count);
		},

		async listRecentAttempts(limit) {
			const res = await db().query(
				'SELECT identity_label, source, outcome, at FROM auth_login_attempts ORDER BY at DESC LIMIT $1',
				[limit]
			);
			return res.rows.map((raw) => {
				const row = raw as AttemptRow;
				return {
					identityLabel: row.identity_label,
					source: row.source,
					outcome: row.outcome as AuthLoginOutcome,
					at: Number(row.at)
				};
			});
		}
	};
}

interface IdentityRow {
	id: string;
	label: string;
	role: string;
	status: string;
	password_hash: string;
	totp_secret_enc: string | null;
	totp_last_step: string | number | null;
	mfa_enrolled_at: string | number | null;
	created_at: string | number;
	updated_at: string | number;
}

interface SessionJoinRow {
	session_id: string;
	created_at: string | number;
	expires_at: string | number;
	last_seen_at: string | number | null;
	session_label: string | null;
	identity_id: string;
	identity_label: string;
	role: string;
	status: string;
}

interface SessionListRow {
	id: string;
	identity_id: string;
	created_at: string | number;
	expires_at: string | number;
	last_seen_at: string | number | null;
	label: string | null;
	identity_label: string;
}

interface InviteRow {
	id: string;
	label: string;
	status: string;
	created_at: string | number;
}

interface SessionIdRow {
	id: string;
	identity_id: string;
	expires_at: string | number;
	revoked_at: string | number | null;
}

interface AttemptRow {
	identity_label: string | null;
	source: string;
	outcome: string;
	at: string | number;
}

function toIdentity(row: IdentityRow): AuthIdentity {
	return {
		id: row.id,
		label: row.label,
		role: row.role as AuthIdentityRole,
		status: row.status as AuthIdentityStatus,
		passwordHash: row.password_hash,
		totpSecretEnc: row.totp_secret_enc,
		totpLastStep: row.totp_last_step == null ? null : Number(row.totp_last_step),
		mfaEnrolledAt: row.mfa_enrolled_at == null ? null : Number(row.mfa_enrolled_at),
		createdAt: Number(row.created_at),
		updatedAt: Number(row.updated_at)
	};
}
