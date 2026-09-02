import { randomUUID } from 'node:crypto';
import type { AuthIdentity } from '@mayon/schema';
import type {
	AttemptsResponse,
	AuthIdentityDTO,
	AuthMode,
	AuthSessionResponse,
	InvitesResponse,
	SessionsResponse
} from '@mayon/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { generateSecret, generateURI, verify } from 'otplib';
import {
	clearEnrollCookie,
	clearSessionCookie,
	nextLocalMidnight,
	setEnrollCookie,
	setSessionCookie
} from './cookies';
import {
	hashPassword,
	randomToken,
	sha256Hex,
	unwrapSecret,
	verifyPassword,
	wrapSecret
} from './crypto';
import type { AuthStore } from './store';
import { createRateLimiter } from './ratelimit';

const LABEL_MAX = 64;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 1024;
const TOTP_STEP_SECONDS = 30;
const ENROLL_TTL_MS = 900_000;
const ENROLL_MAX_FAILS = 5;
const ATTEMPTS_LIST_LIMIT = 50;
const ATTEMPTS_LIST_LIMIT_MAX = 200;

interface SetupBody {
	label?: unknown;
	password?: unknown;
}

interface ConfirmBody {
	code?: unknown;
}

interface LoginBody {
	label?: unknown;
	password?: unknown;
	code?: unknown;
}

interface InviteBody {
	label?: unknown;
}

interface ModeBody {
	mode?: unknown;
	password?: unknown;
}

interface PendingEnrollment {
	label: string;
	passwordHash: string;
	secretEnc: string;
}

interface EnrollPending {
	identityId: string;
	secretEnc: string;
	expiresAt: number;
	fails: number;
}

export interface RegisterAuthDeps {
	store: AuthStore;
	getSecurityMode: () => Promise<AuthMode>;
	setSecurityMode: (mode: AuthMode) => Promise<void>;
	getAuthKey: () => Buffer;
	resolveSessionToken: (request: FastifyRequest) => string | undefined;
	resolveEnrollToken: (request: FastifyRequest) => string | undefined;
	now: () => number;
	authRateWindowMs?: number;
	authRateLadderBase?: number;
	authRateSleep?: (ms: number) => Promise<void>;
}

export function registerAuth(app: FastifyInstance, deps: RegisterAuthDeps): void {
	let pending: PendingEnrollment | undefined;
	const enrollPending = new Map<string, EnrollPending>();

	let dummyHash: Promise<string> | undefined;
	async function equalizePasswordTiming(password: unknown): Promise<void> {
		if (typeof password !== 'string') {
			return;
		}
		dummyHash ??= hashPassword(randomToken());
		await verifyPassword(await dummyHash, password).catch(() => undefined);
	}

	const loginLimiter = createRateLimiter(deps.store, {
		windowMs: deps.authRateWindowMs,
		ladderBase: deps.authRateLadderBase,
		now: deps.now,
		sleep: deps.authRateSleep
	});

	function sweepEnrollPending(): void {
		const ts = deps.now();
		for (const [token, entry] of enrollPending) {
			if (entry.expiresAt <= ts) {
				enrollPending.delete(token);
			}
		}
	}

	function registerEnrollFailure(
		reply: FastifyReply,
		token: string | undefined,
		entry: EnrollPending
	): FastifyReply {
		entry.fails += 1;
		if (entry.fails >= ENROLL_MAX_FAILS) {
			if (token) {
				enrollPending.delete(token);
			}
			clearEnrollCookie(reply);
			return reply.code(401).send({ error: 'enrollment expired' });
		}
		return reply.code(400).send({ error: 'invalid code' });
	}

	const setupClosed = async (): Promise<boolean> =>
		(await deps.getSecurityMode()) === 'locked' || (await deps.store.findActiveOwner()) !== null;

	function keyFailure(reply: FastifyReply, err: unknown): FastifyReply {
		console.error('auth: auth key unavailable —', err instanceof Error ? err.message : err);
		return reply.code(500).send({ error: 'auth key unavailable' });
	}

	function refuseInvalidCredentials(reply: FastifyReply): FastifyReply {
		return reply.code(401).send({ error: 'invalid credentials' });
	}

	async function recordFailureAndDelay(
		reply: FastifyReply,
		source: string,
		identityLabel: string | null,
		outcome: 'bad_password' | 'bad_code' | 'unknown_identity',
		delayMs: number
	): Promise<FastifyReply> {
		await deps.store.recordAttempt({
			identityLabel,
			source,
			outcome,
			at: deps.now()
		});
		if (delayMs > 0) {
			await loginLimiter.sleep(delayMs);
		}
		return refuseInvalidCredentials(reply);
	}

	function refuseForbidden(reply: FastifyReply): FastifyReply {
		return reply.code(403).send({ error: 'forbidden' });
	}

	function isOwner(request: FastifyRequest): boolean {
		return request.auth?.role === 'owner';
	}

	function deviceLabel(request: FastifyRequest): string | undefined {
		const ua = request.headers['user-agent'];
		return typeof ua === 'string' && ua.length > 0 ? ua.slice(0, 64) : undefined;
	}

	async function verifyLiveTotp(
		secret: string,
		code: string,
		lastStep: number | null
	): Promise<{ ok: true; timeStep: number } | { ok: false }> {
		if (!/^\d{6}$/.test(code)) {
			return { ok: false };
		}
		const result = await verify({
			secret,
			token: code,
			epochTolerance: TOTP_STEP_SECONDS,
			epoch: Math.floor(deps.now() / 1000)
		}).catch(() => null);
		if (!result?.valid) {
			return { ok: false };
		}
		if (lastStep !== null && result.timeStep <= lastStep) {
			return { ok: false };
		}
		return { ok: true, timeStep: result.timeStep };
	}

	app.post('/api/auth/session', async (request): Promise<AuthSessionResponse> => {
		const mode = await deps.getSecurityMode();
		const token = deps.resolveSessionToken(request);
		const found = token
			? await deps.store.findValidSessionByTokenHash(sha256Hex(token), deps.now())
			: null;
		const setupRequired = mode === 'open' && (await deps.store.countNonRevokedIdentities()) === 0;
		return {
			mode,
			setupRequired,
			authenticated: found !== null,
			identity: found ? { label: found.identity.label, role: found.identity.role } : null,
			session: found ? { expiresAt: found.session.expiresAt } : null
		};
	});

	app.post<{ Body: SetupBody }>('/api/auth/setup', async (request, reply) => {
		if (await setupClosed()) {
			return reply.code(409).send({ error: 'setup closed' });
		}
		const label = typeof request.body?.label === 'string' ? request.body.label.trim() : '';
		if (label.length < 1 || label.length > LABEL_MAX) {
			return reply.code(400).send({ error: 'invalid label' });
		}
		const password = request.body?.password;
		if (
			typeof password !== 'string' ||
			password.length < PASSWORD_MIN ||
			password.length > PASSWORD_MAX
		) {
			return reply.code(400).send({ error: 'invalid password' });
		}
		let secretEnc: string;
		const secret = generateSecret();
		try {
			secretEnc = wrapSecret(secret, deps.getAuthKey());
		} catch (err) {
			return keyFailure(reply, err);
		}
		pending = {
			label,
			passwordHash: await hashPassword(password),
			secretEnc
		};
		return {
			otpauthUri: generateURI({ issuer: 'mayon', label, secret })
		};
	});

	app.post<{ Body: ConfirmBody }>('/api/auth/setup/confirm', async (request, reply) => {
		if (await setupClosed()) {
			return reply.code(409).send({ error: 'setup closed' });
		}
		const claimed = pending;
		pending = undefined;
		if (!claimed) {
			return reply.code(409).send({ error: 'setup closed' });
		}
		const code = typeof request.body?.code === 'string' ? request.body.code.trim() : '';
		if (!/^\d{6}$/.test(code)) {
			pending ??= claimed;
			return reply.code(400).send({ error: 'invalid code' });
		}
		let secret: string;
		try {
			secret = unwrapSecret(claimed.secretEnc, deps.getAuthKey());
		} catch (err) {
			pending ??= claimed;
			return keyFailure(reply, err);
		}
		const result = await verify({
			secret,
			token: code,
			epochTolerance: TOTP_STEP_SECONDS,
			epoch: Math.floor(deps.now() / 1000)
		}).catch(() => null);
		if (!result?.valid) {
			pending ??= claimed;
			return reply.code(400).send({ error: 'invalid code' });
		}
		const now = deps.now();
		const { label, passwordHash, secretEnc } = claimed;
		const identityId = randomUUID();
		await deps.store.createIdentity({
			id: identityId,
			label,
			role: 'owner',
			status: 'active',
			passwordHash,
			totpSecretEnc: secretEnc
		});
		await deps.store.setIdentityMfa(identityId, {
			totpSecretEnc: secretEnc,
			totpLastStep: result.timeStep,
			mfaEnrolledAt: now
		});
		await deps.setSecurityMode('locked');
		const token = randomToken();
		const expiresAt = nextLocalMidnight(now);
		await deps.store.createSession({
			id: randomUUID(),
			identityId,
			tokenHash: sha256Hex(token),
			expiresAt,
			label: deviceLabel(request)
		});
		setSessionCookie(reply, token, expiresAt, now);
		const identity: AuthIdentityDTO = { label, role: 'owner' };
		return { authenticated: true, identity, session: { expiresAt } };
	});

	app.post<{ Body: LoginBody }>('/api/auth/login', async (request, reply) => {
		const source = request.ip;
		const limit = await loginLimiter.check(source);
		if (!limit.ok) {
			return reply
				.code(429)
				.send({ error: 'too many attempts', retryAfter: Math.ceil(limit.retryAfterMs / 1000) });
		}
		const body = request.body ?? {};
		const label = typeof body.label === 'string' ? body.label.trim() : '';
		let identity: AuthIdentity | null;
		if (label !== '') {
			identity = await deps.store.findIdentityByLabel(label);
		} else {
			const candidates = await deps.store.listNonRevokedIdentities();
			if (candidates.length > 1) {
				return reply.code(400).send({ error: 'label required' });
			}
			identity = candidates[0] ?? null;
		}
		const password = body.password;
		if (!identity || identity.status === 'revoked' || typeof password !== 'string') {
			await equalizePasswordTiming(password);
			return recordFailureAndDelay(
				reply,
				source,
				identity?.label ?? (label || null),
				identity ? 'bad_password' : 'unknown_identity',
				limit.delayMs
			);
		}
		let passwordOk: boolean;
		try {
			passwordOk = await verifyPassword(identity.passwordHash, password);
		} catch {
			passwordOk = false;
		}
		if (!passwordOk) {
			return recordFailureAndDelay(reply, source, identity.label, 'bad_password', limit.delayMs);
		}
		if (identity.status === 'invited') {
			const secret = generateSecret();
			let secretEnc: string;
			try {
				secretEnc = wrapSecret(secret, deps.getAuthKey());
			} catch (err) {
				return keyFailure(reply, err);
			}
			sweepEnrollPending();
			const enrollToken = randomToken();
			enrollPending.set(enrollToken, {
				identityId: identity.id,
				secretEnc,
				expiresAt: deps.now() + ENROLL_TTL_MS,
				fails: 0
			});
			setEnrollCookie(reply, enrollToken);
			return {
				status: 'mfa_enrollment_required',
				enrollToken,
				otpauthUri: generateURI({ issuer: 'mayon', label: identity.label, secret })
			};
		}
		if (identity.totpSecretEnc === null) {
			await equalizePasswordTiming(password);
			return recordFailureAndDelay(reply, source, identity.label, 'bad_code', limit.delayMs);
		}
		let secret: string;
		try {
			secret = unwrapSecret(identity.totpSecretEnc, deps.getAuthKey());
		} catch (err) {
			return keyFailure(reply, err);
		}
		const code = typeof body.code === 'string' ? body.code.trim() : '';
		const totp = await verifyLiveTotp(secret, code, identity.totpLastStep);
		if (!totp.ok) {
			return recordFailureAndDelay(reply, source, identity.label, 'bad_code', limit.delayMs);
		}
		if (!(await deps.store.advanceTotpStep(identity.id, totp.timeStep))) {
			return recordFailureAndDelay(reply, source, identity.label, 'bad_code', limit.delayMs);
		}
		const now = deps.now();
		const token = randomToken();
		const expiresAt = nextLocalMidnight(now);
		await deps.store.createSession({
			id: randomUUID(),
			identityId: identity.id,
			tokenHash: sha256Hex(token),
			expiresAt,
			label: deviceLabel(request)
		});
		setSessionCookie(reply, token, expiresAt, now);
		await deps.store.recordAttempt({
			identityLabel: identity.label,
			source,
			outcome: 'success',
			at: now
		});
		const dto: AuthIdentityDTO = { label: identity.label, role: identity.role };
		return { authenticated: true, identity: dto, session: { expiresAt } };
	});

	app.post<{ Body: ConfirmBody }>('/api/auth/enroll', async (request, reply) => {
		sweepEnrollPending();
		const token = deps.resolveEnrollToken(request);
		const entry = token ? enrollPending.get(token) : undefined;
		if (!entry || entry.expiresAt <= deps.now()) {
			if (token) {
				enrollPending.delete(token);
			}
			clearEnrollCookie(reply);
			return reply.code(401).send({ error: 'enrollment expired' });
		}
		const code = typeof request.body?.code === 'string' ? request.body.code.trim() : '';
		if (!/^\d{6}$/.test(code)) {
			return registerEnrollFailure(reply, token, entry);
		}
		let secret: string;
		try {
			secret = unwrapSecret(entry.secretEnc, deps.getAuthKey());
		} catch (err) {
			return keyFailure(reply, err);
		}
		const totp = await verifyLiveTotp(secret, code, null);
		if (!totp.ok) {
			return registerEnrollFailure(reply, token, entry);
		}
		const identity = await deps.store.findIdentityById(entry.identityId);
		if (!identity || identity.status !== 'invited') {
			enrollPending.delete(token);
			clearEnrollCookie(reply);
			return reply.code(401).send({ error: 'enrollment expired' });
		}
		const now = deps.now();
		await deps.store.setIdentityMfa(identity.id, {
			totpSecretEnc: entry.secretEnc,
			totpLastStep: totp.timeStep,
			mfaEnrolledAt: now
		});
		await deps.store.setIdentityStatus(identity.id, 'active');
		const sessionToken = randomToken();
		const expiresAt = nextLocalMidnight(now);
		await deps.store.createSession({
			id: randomUUID(),
			identityId: identity.id,
			tokenHash: sha256Hex(sessionToken),
			expiresAt,
			label: deviceLabel(request)
		});
		enrollPending.delete(token);
		clearEnrollCookie(reply);
		setSessionCookie(reply, sessionToken, expiresAt, now);
		await deps.store.recordAttempt({
			identityLabel: identity.label,
			source: request.ip,
			outcome: 'success',
			at: now
		});
		const dto: AuthIdentityDTO = { label: identity.label, role: identity.role };
		return { authenticated: true, identity: dto, session: { expiresAt } };
	});

	app.post('/api/auth/logout', async (request, reply) => {
		const token = deps.resolveSessionToken(request);
		if (token) {
			const found = await deps.store.findValidSessionByTokenHash(sha256Hex(token), deps.now());
			if (found) {
				await deps.store.revokeSession(found.session.id, deps.now());
			}
		}
		clearSessionCookie(reply);
		return reply.code(204).send();
	});

	app.post<{ Body: ModeBody }>('/api/auth/mode', async (request, reply) => {
		const token = deps.resolveSessionToken(request);
		const found = token
			? await deps.store.findValidSessionByTokenHash(sha256Hex(token), deps.now())
			: null;
		if (!found) {
			return reply.code(401).send({ error: 'unauthenticated' });
		}
		if (found.identity.role !== 'owner') {
			return refuseForbidden(reply);
		}
		const mode = request.body?.mode;
		if (mode !== 'open' && mode !== 'locked') {
			return reply.code(400).send({ error: 'invalid mode' });
		}
		if (mode === 'open') {
			const password = request.body?.password;
			if (typeof password !== 'string') {
				return refuseInvalidCredentials(reply);
			}
			const identity = await deps.store.findIdentityById(found.identity.id);
			let passwordOk = false;
			if (identity && identity.status === 'active') {
				try {
					passwordOk = await verifyPassword(identity.passwordHash, password);
				} catch {
					passwordOk = false;
				}
			}
			if (!passwordOk) {
				return refuseInvalidCredentials(reply);
			}
			await deps.setSecurityMode('open');
			await deps.store.revokeAllSessions(deps.now());
			return { mode: 'open' };
		}
		if ((await deps.store.findActiveOwner()) === null) {
			return reply.code(409).send({ error: 'setup closed' });
		}
		await deps.setSecurityMode('locked');
		return { mode: 'locked' };
	});

	app.post<{ Body: InviteBody }>('/api/auth/invites', async (request, reply) => {
		if (!isOwner(request)) {
			return refuseForbidden(reply);
		}
		const label = typeof request.body?.label === 'string' ? request.body.label.trim() : '';
		if (label.length < 1 || label.length > LABEL_MAX) {
			return reply.code(400).send({ error: 'invalid label' });
		}
		const nonRevoked = await deps.store.listNonRevokedIdentities();
		if (nonRevoked.some((identity) => identity.label === label)) {
			return reply.code(400).send({ error: 'duplicate label' });
		}
		const oneTimePassword = randomToken();
		const id = randomUUID();
		await deps.store.createIdentity({
			id,
			label,
			role: 'invitee',
			status: 'invited',
			passwordHash: await hashPassword(oneTimePassword)
		});
		return reply.code(201).send({ id, oneTimePassword });
	});

	app.get('/api/auth/invites', async (request, reply): Promise<InvitesResponse> => {
		if (!isOwner(request)) {
			return refuseForbidden(reply);
		}
		const invites = await deps.store.listInvites();
		return {
			invites: invites.map((invite) => ({
				id: invite.id,
				label: invite.label,
				status: invite.status,
				createdAt: invite.createdAt
			}))
		};
	});

	app.delete('/api/auth/invites/:id', async (request, reply) => {
		if (!isOwner(request)) {
			return refuseForbidden(reply);
		}
		const { id } = request.params as { id: string };
		const identity = await deps.store.findIdentityById(id);
		if (!identity || identity.role !== 'invitee') {
			return reply.code(404).send({ error: 'unknown invite' });
		}
		await deps.store.setIdentityStatus(identity.id, 'revoked');
		await deps.store.deleteSessionsByIdentity(identity.id);
		return reply.code(204).send();
	});

	app.get('/api/auth/sessions', async (request, reply): Promise<SessionsResponse> => {
		const auth = request.auth;
		if (!auth) {
			return refuseForbidden(reply);
		}
		const live = await deps.store.listSessions(deps.now());
		const visible =
			auth.role === 'invitee' ? live.filter((s) => s.identityId === auth.identityId) : live;
		return {
			sessions: visible.map((s) => ({
				id: s.id,
				identityLabel: s.identityLabel,
				label: s.label,
				createdAt: s.createdAt,
				expiresAt: s.expiresAt,
				lastSeenAt: s.lastSeenAt,
				current: s.id === auth.sessionId
			}))
		};
	});

	app.delete('/api/auth/sessions/:id', async (request, reply) => {
		const auth = request.auth;
		if (!auth) {
			return refuseForbidden(reply);
		}
		const { id } = request.params as { id: string };
		const session = await deps.store.getSessionById(id);
		if (!session) {
			return reply.code(404).send({ error: 'unknown session' });
		}
		if (auth.role !== 'owner' && session.identityId !== auth.identityId) {
			return refuseForbidden(reply);
		}
		await deps.store.revokeSession(session.id, deps.now());
		return reply.code(204).send();
	});

	app.post('/api/auth/sessions/revoke-all', async (request, reply) => {
		if (!isOwner(request)) {
			return refuseForbidden(reply);
		}
		await deps.store.revokeAllSessions(deps.now());
		return reply.code(204).send();
	});

	app.get('/api/auth/attempts', async (request, reply): Promise<AttemptsResponse> => {
		if (!isOwner(request)) {
			return refuseForbidden(reply);
		}
		const rawLimit = (request.query as { limit?: unknown } | undefined)?.limit;
		const parsed = typeof rawLimit === 'string' ? Number.parseInt(rawLimit, 10) : Number.NaN;
		const limit =
			Number.isFinite(parsed) && parsed >= 1
				? Math.min(parsed, ATTEMPTS_LIST_LIMIT_MAX)
				: ATTEMPTS_LIST_LIMIT;
		const attempts = await deps.store.listRecentAttempts(limit);
		return {
			attempts: attempts.map((attempt) => ({
				identityLabel: attempt.identityLabel,
				source: attempt.source,
				outcome: attempt.outcome,
				at: attempt.at
			}))
		};
	});
}
